import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAdapter } from "@agentcargo/adapter-codex";
import { createSkillTemplate } from "./skill.js";
import { installLocalSkill } from "./install.js";
import { doctorInstallations, removeInstallation } from "./lifecycle.js";
import { readLockfile } from "./lockfile.js";
import { readRollbackState } from "./rollback-state.js";
import {
  previewInstallationUpdate,
  rollbackInstallation,
  updateInstallation,
} from "./update.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("previewInstallationUpdate", () => {
  it("prepares host-ready files and reports changes without mutating the installation", async () => {
    const fixture = await createUpdateFixture();
    const beforeSkill = await readFile(path.join(fixture.destination, "SKILL.md"), "utf8");
    const beforeLock = await readFile(path.join(fixture.projectRoot, "agentcargo.lock"), "utf8");

    const result = await previewInstallationUpdate({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: fixture.targetSkill,
      currentDeclared: {
        capabilities: { filesystem: { read: true, write: false } },
        dependencies: ["git>=2.40"],
      },
      targetDeclared: {
        capabilities: { filesystem: { read: true, write: true } },
        dependencies: ["git>=2.40", "node>=22"],
      },
      currentFindings: [],
      targetFindings: [finding("AGENTCARGO-SCRIPT-FILE", "scripts/check.sh")],
    });

    expect(result.installation.state).toBe("clean");
    expect(result.preview).toMatchObject({
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      files: {
        added: [{ path: "scripts/check.sh" }],
        removed: [],
        modified: [{ path: "SKILL.md" }],
      },
      scripts: { added: ["scripts/check.sh"], removed: [], modified: [] },
      capabilities: [{ path: "filesystem.write", before: false, after: true }],
      dependencies: { added: ["node>=22"], removed: [] },
      findings: { added: [{ ruleId: "AGENTCARGO-SCRIPT-FILE" }] },
    });
    expect(await readFile(path.join(fixture.destination, "SKILL.md"), "utf8")).toBe(beforeSkill);
    expect(await readFile(path.join(fixture.projectRoot, "agentcargo.lock"), "utf8")).toBe(beforeLock);
    await expect(readFile(path.join(fixture.destination, "agentcargo.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a digest mismatch without mutating the installation", async () => {
    const fixture = await createUpdateFixture();
    await expect(previewInstallationUpdate({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: fixture.targetSkill,
      expectedDigest: `sha256:${"f".repeat(64)}`,
    })).rejects.toMatchObject({ code: "UPDATE_ARTIFACT_DIGEST_MISMATCH" });
    expect(await readFile(path.join(fixture.destination, "SKILL.md"), "utf8")).toContain("Version one");
  });

  it("rejects a source for a different package", async () => {
    const fixture = await createUpdateFixture();
    const other = await writeSkill(path.join(fixture.root, "other", "other-skill"), "other-skill", "2.0.0", "Other");
    await expect(previewInstallationUpdate({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: other,
    })).rejects.toMatchObject({ code: "UPDATE_PACKAGE_MISMATCH" });
  });
});

describe("updateInstallation and rollbackInstallation", () => {
  it("atomically applies a clean update and retains a verified rollback version", async () => {
    const fixture = await createUpdateFixture();

    const updated = await updateInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: fixture.targetSkill,
      now: () => new Date("2026-08-19T01:00:00.000Z"),
    });

    expect(updated.preview).toMatchObject({ fromVersion: "1.0.0", toVersion: "2.0.0" });
    expect(await readFile(path.join(fixture.destination, "SKILL.md"), "utf8")).toContain("Version two");
    expect(await readFile(path.join(fixture.destination, "scripts", "check.sh"), "utf8")).toContain("checked");
    await expect(readFile(path.join(fixture.destination, "agentcargo.yaml"))).rejects.toMatchObject({ code: "ENOENT" });

    const lockfile = await readLockfile(path.join(fixture.projectRoot, "agentcargo.lock"));
    expect(lockfile.packages[0]).toMatchObject({
      package: "review-skill",
      version: "2.0.0",
      installed_at: "2026-08-19T01:00:00.000Z",
    });
    const state = await readRollbackState(updated.rollbackStatePath);
    expect(state.packages[0]).toMatchObject({
      previous: { version: "1.0.0" },
      current: { version: "2.0.0" },
    });
    const backup = path.resolve(fixture.projectRoot, ...state.packages[0]!.backup_destination.split("/"));
    expect(await readFile(path.join(backup, "SKILL.md"), "utf8")).toContain("Version one");
    expect((await doctorInstallations(fixture.lifecycle)).healthy).toBe(true);
  });

  it("refuses to overwrite a locally modified installation", async () => {
    const fixture = await createUpdateFixture();
    const lockBefore = await readFile(path.join(fixture.projectRoot, "agentcargo.lock"), "utf8");
    await writeFile(path.join(fixture.destination, "SKILL.md"), "locally changed\n");

    await expect(updateInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: fixture.targetSkill,
    })).rejects.toMatchObject({ code: "UPDATE_DRIFT_DETECTED" });

    expect(await readFile(path.join(fixture.destination, "SKILL.md"), "utf8")).toBe("locally changed\n");
    expect(await readFile(path.join(fixture.projectRoot, "agentcargo.lock"), "utf8")).toBe(lockBefore);
  });

  it("restores the prior version and retains the replaced version for a reversible rollback", async () => {
    const fixture = await createUpdateFixture();
    const updated = await updateInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: fixture.targetSkill,
      now: () => new Date("2026-08-19T01:00:00.000Z"),
    });

    const rolledBack = await rollbackInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      now: () => new Date("2026-08-19T02:00:00.000Z"),
    });

    expect(rolledBack).toMatchObject({ fromVersion: "2.0.0", toVersion: "1.0.0" });
    expect(await readFile(path.join(fixture.destination, "SKILL.md"), "utf8")).toContain("Version one");
    await expect(readFile(path.join(fixture.destination, "scripts", "check.sh"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readLockfile(path.join(fixture.projectRoot, "agentcargo.lock"))).packages[0]).toMatchObject({
      version: "1.0.0",
      installed_at: "2026-08-19T02:00:00.000Z",
    });
    const state = await readRollbackState(updated.rollbackStatePath);
    expect(state.packages[0]).toMatchObject({
      previous: { version: "2.0.0" },
      current: { version: "1.0.0" },
    });

    const rolledForward = await rollbackInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      now: () => new Date("2026-08-19T03:00:00.000Z"),
    });
    expect(rolledForward).toMatchObject({ fromVersion: "1.0.0", toVersion: "2.0.0" });
    expect(await readFile(path.join(fixture.destination, "SKILL.md"), "utf8")).toContain("Version two");
    expect((await readdir(path.dirname(fixture.destination))).filter((name) => name.startsWith(".agentcargo-update-"))).toEqual([]);
  });

  it("refuses rollback when the active installation or retained backup has drift", async () => {
    const fixture = await createUpdateFixture();
    const updated = await updateInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: fixture.targetSkill,
    });
    const activeContents = await readFile(path.join(fixture.destination, "SKILL.md"), "utf8");
    await writeFile(path.join(fixture.destination, "SKILL.md"), "active drift\n");
    await expect(rollbackInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
    })).rejects.toMatchObject({ code: "ROLLBACK_DRIFT_DETECTED" });

    const state = await readRollbackState(updated.rollbackStatePath);
    const backup = path.resolve(fixture.projectRoot, ...state.packages[0]!.backup_destination.split("/"));
    await writeFile(path.join(fixture.destination, "SKILL.md"), activeContents);
    await writeFile(path.join(backup, "SKILL.md"), "backup drift\n");
    await expect(rollbackInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
    })).rejects.toMatchObject({ code: "ROLLBACK_BACKUP_MODIFIED" });
  });

  it("replaces the prior rollback snapshot on a later successful update", async () => {
    const fixture = await createUpdateFixture();
    const first = await updateInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: fixture.targetSkill,
    });
    const firstState = await readRollbackState(first.rollbackStatePath!);
    const firstBackup = path.resolve(
      fixture.projectRoot,
      ...firstState.packages[0]!.backup_destination.split("/"),
    );
    const thirdSkill = await writeSkill(
      path.join(fixture.root, "third", "review-skill"),
      "review-skill",
      "3.0.0",
      "Version three",
    );

    const second = await updateInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: thirdSkill,
    });

    expect(second.cleanupPending).toBeUndefined();
    await expect(readFile(path.join(firstBackup, "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readRollbackState(second.rollbackStatePath!)).packages[0]).toMatchObject({
      previous: { version: "2.0.0" },
      current: { version: "3.0.0" },
    });
  });

  it("removes retained rollback metadata and files with the active installation", async () => {
    const fixture = await createUpdateFixture();
    const updated = await updateInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: fixture.targetSkill,
    });
    const state = await readRollbackState(updated.rollbackStatePath!);
    const backup = path.resolve(fixture.projectRoot, ...state.packages[0]!.backup_destination.split("/"));

    await removeInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
    });

    await expect(readFile(path.join(fixture.destination, "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(backup, "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(updated.rollbackStatePath!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes update and rollback with the shared scope operation lock", async () => {
    const fixture = await createUpdateFixture();
    const lockPath = path.join(fixture.projectRoot, ".agentcargo-operation.lock");
    const activeLock = `${JSON.stringify({
      pid: process.pid,
      started_at: "2026-08-19T00:00:00.000Z",
    })}\n`;
    await writeFile(lockPath, activeLock, { mode: 0o600 });

    await expect(updateInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: fixture.targetSkill,
    })).rejects.toMatchObject({ code: "UPDATE_OPERATION_LOCKED" });
    expect(await readFile(path.join(fixture.destination, "SKILL.md"), "utf8")).toContain("Version one");

    await unlink(lockPath);
    await updateInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
      sourcePath: fixture.targetSkill,
    });
    await writeFile(lockPath, activeLock, { mode: 0o600 });
    await expect(rollbackInstallation({
      ...fixture.lifecycle,
      package: "review-skill",
    })).rejects.toMatchObject({ code: "ROLLBACK_OPERATION_LOCKED" });
    expect(await readFile(path.join(fixture.destination, "SKILL.md"), "utf8")).toContain("Version two");
  });
});

async function createUpdateFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agentcargo-update-test-"));
  temporaryDirectories.push(root);
  const projectRoot = path.join(root, "project");
  const userHome = path.join(root, "home");
  await mkdir(projectRoot);
  await mkdir(userHome);
  const currentSkill = await writeSkill(path.join(root, "current", "review-skill"), "review-skill", "1.0.0", "Version one");
  const targetSkill = await writeSkill(path.join(root, "target", "review-skill"), "review-skill", "2.0.0", "Version two", true);
  const adapter = new CodexAdapter();
  const lifecycle = {
    adapter,
    scope: "project" as const,
    context: { projectRoot, userHome },
  };
  const install = await installLocalSkill({ ...lifecycle, sourcePath: currentSkill });
  return { root, projectRoot, targetSkill, destination: install.destination, lifecycle };
}

async function writeSkill(
  skillRoot: string,
  name: string,
  version: string,
  instructions: string,
  script = false,
): Promise<string> {
  await mkdir(skillRoot, { recursive: true });
  const template = createSkillTemplate(name, `${name} fixture.`);
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    template.skillMarkdown.replace("Describe the workflow the AI agent should follow.", instructions),
  );
  await writeFile(
    path.join(skillRoot, "agentcargo.yaml"),
    template.manifestYaml.replace('version: 0.1.0', `version: ${version}`),
  );
  if (script) {
    await mkdir(path.join(skillRoot, "scripts"));
    await writeFile(path.join(skillRoot, "scripts", "check.sh"), "#!/bin/sh\necho checked\n", { mode: 0o755 });
  }
  return skillRoot;
}

function finding(ruleId: string, findingPath: string) {
  return {
    ruleId,
    ruleVersion: "1",
    severity: "info" as const,
    path: findingPath,
    message: "Script file.",
    explanation: "Script-like content is present.",
    remediation: "Review the script.",
  };
}
