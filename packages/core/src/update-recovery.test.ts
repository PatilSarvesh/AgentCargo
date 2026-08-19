import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "@agentcargo/adapter-codex";
import { createSkillTemplate } from "./skill.js";
import { installLocalSkill } from "./install.js";
import { readLockfile } from "./lockfile.js";

const rollbackWriter = vi.hoisted(() => ({ calls: 0, failOnCall: 0 }));

vi.mock("./rollback-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rollback-state.js")>();
  return {
    ...actual,
    async writeRollbackStateAtomic(...args: Parameters<typeof actual.writeRollbackStateAtomic>) {
      rollbackWriter.calls += 1;
      if (rollbackWriter.calls === rollbackWriter.failOnCall) {
        throw Object.assign(new Error("injected rollback-state commit failure"), { code: "EIO" });
      }
      return actual.writeRollbackStateAtomic(...args);
    },
  };
});

const { rollbackInstallation, updateInstallation } = await import("./update.js");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  rollbackWriter.calls = 0;
  rollbackWriter.failOnCall = 0;
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("update transaction recovery", () => {
  it("restores the prior directory and lockfile when rollback-state commit fails", async () => {
    const fixture = await createFixture();
    const beforeLockfile = await readFile(fixture.lockfilePath, "utf8");
    rollbackWriter.failOnCall = 1;

    await expect(updateInstallation({
      ...fixture.lifecycle,
      package: "recovery-skill",
      sourcePath: fixture.targetSkill,
    })).rejects.toMatchObject({ code: "UPDATE_COMMIT_FAILED" });

    expect(await readFile(path.join(fixture.destination, "SKILL.md"), "utf8")).toContain("Version one");
    expect(await readFile(fixture.lockfilePath, "utf8")).toBe(beforeLockfile);
    expect((await readLockfile(fixture.lockfilePath)).packages[0]?.version).toBe("1.0.0");
    await expect(stat(path.join(fixture.projectRoot, ".agentcargo-operation.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores the current directory, lockfile, and rollback record when rollback commit fails", async () => {
    const fixture = await createFixture();
    await updateInstallation({
      ...fixture.lifecycle,
      package: "recovery-skill",
      sourcePath: fixture.targetSkill,
    });
    const beforeLockfile = await readFile(fixture.lockfilePath, "utf8");
    rollbackWriter.failOnCall = rollbackWriter.calls + 1;

    await expect(rollbackInstallation({
      ...fixture.lifecycle,
      package: "recovery-skill",
    })).rejects.toMatchObject({ code: "ROLLBACK_COMMIT_FAILED" });

    expect(await readFile(path.join(fixture.destination, "SKILL.md"), "utf8")).toContain("Version two");
    expect(await readFile(fixture.lockfilePath, "utf8")).toBe(beforeLockfile);
    expect((await readLockfile(fixture.lockfilePath)).packages[0]?.version).toBe("2.0.0");
    await expect(stat(path.join(fixture.projectRoot, ".agentcargo-operation.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agentcargo-update-recovery-test-"));
  temporaryDirectories.push(root);
  const projectRoot = path.join(root, "project");
  const userHome = path.join(root, "home");
  await Promise.all([mkdir(projectRoot), mkdir(userHome)]);
  const currentSkill = await writeSkill(path.join(root, "current", "recovery-skill"), "1.0.0", "Version one");
  const targetSkill = await writeSkill(path.join(root, "target", "recovery-skill"), "2.0.0", "Version two");
  const lifecycle = {
    adapter: new CodexAdapter(),
    scope: "project" as const,
    context: { projectRoot, userHome },
  };
  const installed = await installLocalSkill({ ...lifecycle, sourcePath: currentSkill });
  return {
    projectRoot,
    targetSkill,
    destination: installed.destination,
    lockfilePath: installed.lockfilePath,
    lifecycle,
  };
}

async function writeSkill(root: string, version: string, instructions: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const template = createSkillTemplate("recovery-skill", "Recovery fixture.");
  await writeFile(
    path.join(root, "SKILL.md"),
    template.skillMarkdown.replace("Describe the workflow the AI agent should follow.", instructions),
  );
  await writeFile(
    path.join(root, "agentcargo.yaml"),
    template.manifestYaml.replace("version: 0.1.0", `version: ${version}`),
  );
  return root;
}
