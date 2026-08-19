import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAdapter } from "@agentcargo/adapter-codex";
import type { PrepareStagedPackageInput } from "@agentcargo/adapter-contract";
import { createSkillTemplate } from "./skill.js";
import { defaultUserDataRoot, installLocalSkill } from "./install.js";
import { readLockfile } from "./lockfile.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("installLocalSkill", () => {
  it("atomically installs a local skill into Codex project scope and records ownership", async () => {
    const root = await createTemporaryDirectory();
    const projectRoot = path.join(root, "project");
    const userHome = path.join(root, "home");
    await Promise.all([mkdir(projectRoot), mkdir(userHome)]);
    const skill = await createSkillFixture(path.join(root, "source", "hello-skill"));

    const result = await installLocalSkill({
      sourcePath: skill,
      adapter: new CodexAdapter(),
      scope: "project",
      context: { projectRoot, userHome },
      now: () => new Date("2026-08-13T00:00:00.000Z"),
    });

    expect(result.destination).toBe(path.join(await realpath(projectRoot), ".agents", "skills", "hello-skill"));
    expect(await readFile(path.join(result.destination, "SKILL.md"), "utf8")).toContain("hello-skill");
    await expect(readFile(path.join(result.destination, "agentcargo.yaml"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(result.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "references/guide.md",
      "scripts/run.sh",
    ]);
    const lockfile = await readLockfile(path.join(projectRoot, "agentcargo.lock"));
    expect(lockfile.packages).toHaveLength(1);
    expect(lockfile.packages[0]).toMatchObject({
      package: "hello-skill",
      agent: "codex",
      scope: "project",
      destination: ".agents/skills/hello-skill",
      files_digest: result.filesDigest,
      source: { type: "local" },
    });
    expect((await readdir(path.join(projectRoot, ".agents", "skills"))).sort()).toEqual([
      "hello-skill",
    ]);
  });

  it("installs user scope into the documented home location with a separate lockfile", async () => {
    const root = await createTemporaryDirectory();
    const userHome = path.join(root, "home");
    const userDataRoot = path.join(userHome, "agentcargo-data");
    await mkdir(userHome);
    const skill = await createSkillFixture(path.join(root, "source", "user-skill"));

    const result = await installLocalSkill({
      sourcePath: skill,
      adapter: new CodexAdapter(),
      scope: "user",
      context: { userHome },
      userDataRoot,
    });

    expect(result.destination).toBe(path.join(await realpath(userHome), ".agents", "skills", "user-skill"));
    expect(result.lockfilePath).toBe(path.join(await realpath(userDataRoot), "agentcargo.lock"));
    expect((await readLockfile(result.lockfilePath)).packages[0]?.scope).toBe("user");
  });

  it("rejects an artifact when the expected registry digest does not match", async () => {
    const root = await createTemporaryDirectory();
    const projectRoot = path.join(root, "project");
    const userHome = path.join(root, "home");
    await Promise.all([mkdir(projectRoot), mkdir(userHome)]);
    const skill = await createSkillFixture(path.join(root, "source", "digest-skill"));

    await expect(
      installLocalSkill({
        sourcePath: skill,
        adapter: new CodexAdapter(),
        scope: "project",
        context: { projectRoot, userHome },
        sourceType: "registry",
        expectedDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "INSTALL_ARTIFACT_DIGEST_MISMATCH" });
    await expect(stat(path.join(projectRoot, ".agents", "skills", "digest-skill"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses to overwrite an unmanaged destination", async () => {
    const root = await createTemporaryDirectory();
    const projectRoot = path.join(root, "project");
    const userHome = path.join(root, "home");
    const destination = path.join(projectRoot, ".agents", "skills", "conflict-skill");
    await Promise.all([mkdir(destination, { recursive: true }), mkdir(userHome)]);
    await writeFile(path.join(destination, "keep.txt"), "do not replace");
    const skill = await createSkillFixture(path.join(root, "source", "conflict-skill"));

    await expect(
      installLocalSkill({
        sourcePath: skill,
        adapter: new CodexAdapter(),
        scope: "project",
        context: { projectRoot, userHome },
      }),
    ).rejects.toMatchObject({ code: "INSTALL_DESTINATION_EXISTS" });
    expect(await readFile(path.join(destination, "keep.txt"), "utf8")).toBe("do not replace");
    await expect(stat(path.join(projectRoot, "agentcargo.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked host directory that escapes the project root",
    async () => {
      const root = await createTemporaryDirectory();
      const projectRoot = path.join(root, "project");
      const userHome = path.join(root, "home");
      const outside = path.join(root, "outside");
      await Promise.all([mkdir(projectRoot), mkdir(userHome), mkdir(outside)]);
      await symlink(outside, path.join(projectRoot, ".agents"), "dir");
      const skill = await createSkillFixture(path.join(root, "source", "escape-skill"));

      await expect(
        installLocalSkill({
          sourcePath: skill,
          adapter: new CodexAdapter(),
          scope: "project",
          context: { projectRoot, userHome },
        }),
      ).rejects.toMatchObject({ code: "INSTALL_DIRECTORY_NOT_REAL" });
      expect(await readdir(outside)).toEqual([]);
    },
  );

  it("blocks an undeclared Codex scope before creating host directories", async () => {
    const root = await createTemporaryDirectory();
    const projectRoot = path.join(root, "project");
    const userHome = path.join(root, "home");
    await Promise.all([mkdir(projectRoot), mkdir(userHome)]);
    const skill = await createSkillFixture(path.join(root, "source", "project-only"), ["project"]);

    await expect(
      installLocalSkill({
        sourcePath: skill,
        adapter: new CodexAdapter(),
        scope: "user",
        context: { projectRoot, userHome },
      }),
    ).rejects.toMatchObject({ code: "CODEX_SCOPE_NOT_DECLARED" });
    await expect(stat(path.join(userHome, ".agents"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back the active destination when the lockfile commit fails", async () => {
    const root = await createTemporaryDirectory();
    const projectRoot = path.join(root, "project");
    const userHome = path.join(root, "home");
    await Promise.all([mkdir(projectRoot), mkdir(userHome)]);
    const skill = await createSkillFixture(path.join(root, "source", "rollback-skill"));

    class LockfileFailureAdapter extends CodexAdapter {
      override async prepareStagedPackage(input: PrepareStagedPackageInput): Promise<void> {
        await super.prepareStagedPackage(input);
        await mkdir(path.join(input.plan.scopeRoot, "agentcargo.lock"));
      }
    }

    await expect(
      installLocalSkill({
        sourcePath: skill,
        adapter: new LockfileFailureAdapter(),
        scope: "project",
        context: { projectRoot, userHome },
      }),
    ).rejects.toBeInstanceOf(Error);

    await expect(
      stat(path.join(projectRoot, ".agents", "skills", "rollback-skill")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(path.join(projectRoot, ".agents", "skills"))).toEqual([]);
    await expect(stat(path.join(projectRoot, ".agentcargo-operation.lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("defaultUserDataRoot", () => {
  it("uses platform-specific locations beneath the user home", () => {
    expect(defaultUserDataRoot("/home/test", "linux")).toBe(
      path.resolve("/home/test/.local/share/agentcargo"),
    );
    expect(defaultUserDataRoot("/Users/test", "darwin")).toBe(
      path.resolve("/Users/test/Library/Application Support/AgentCargo"),
    );
    expect(defaultUserDataRoot("C:\\Users\\test", "win32")).toContain(
      path.join("AppData", "Local", "AgentCargo"),
    );
  });
});

async function createSkillFixture(
  skillPath: string,
  scopes: Array<"project" | "user"> = ["project", "user"],
): Promise<string> {
  await mkdir(skillPath, { recursive: true });
  const name = path.basename(skillPath);
  const template = createSkillTemplate(name, "A fixture for safe local installation tests.");
  const manifest = template.manifestYaml.replace(
    /    scopes:\n(?:      - (?:project|user)\n)+/,
    `    scopes:\n${scopes.map((scope) => `      - ${scope}`).join("\n")}\n`,
  );
  await writeFile(path.join(skillPath, "SKILL.md"), template.skillMarkdown);
  await writeFile(path.join(skillPath, "agentcargo.yaml"), manifest);
  await mkdir(path.join(skillPath, "references"));
  await writeFile(path.join(skillPath, "references", "guide.md"), "# Guide\n");
  await mkdir(path.join(skillPath, "scripts"));
  await writeFile(path.join(skillPath, "scripts", "run.sh"), "#!/bin/sh\nprintf 'test\\n'\n");
  return skillPath;
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "agentcargo-install-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
