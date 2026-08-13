import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAdapter } from "@agentcargo/adapter-codex";
import { installLocalSkill } from "./install.js";
import {
  doctorInstallations,
  listInstallations,
  removeInstallation,
} from "./lifecycle.js";
import { OPERATION_LOCK_NAME } from "./operation-lock.js";
import { readLockfile } from "./lockfile.js";
import { createSkillTemplate } from "./skill.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("installation inspection", () => {
  it("lists a clean project installation from its ownership receipts", async () => {
    const fixture = await createInstalledFixture("clean-skill");

    const result = await listInstallations(fixture.lifecycleInput);

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]).toMatchObject({
      package: "clean-skill",
      state: "clean",
      missingFiles: [],
      modifiedFiles: [],
      untrackedPaths: [],
      invalidPaths: [],
      actualFilesDigest: fixture.install.filesDigest,
    });
  });

  it("lists a user installation from its separate user-data lockfile", async () => {
    const root = await createTemporaryDirectory();
    const userHome = path.join(root, "home");
    const userDataRoot = path.join(userHome, "agentcargo-data");
    await mkdir(userHome);
    const source = await createSkillFixture(path.join(root, "source", "user-list-skill"));
    const adapter = new CodexAdapter();
    const install = await installLocalSkill({
      sourcePath: source,
      adapter,
      scope: "user",
      context: { userHome },
      userDataRoot,
    });

    const result = await listInstallations({
      adapter,
      scope: "user",
      context: { userHome },
      userDataRoot,
    });

    expect(result.lockfilePath).toBe(install.lockfilePath);
    expect(result.packages[0]).toMatchObject({ package: "user-list-skill", state: "clean" });
  });

  it("classifies missing, modified, and untracked paths without mutating them", async () => {
    const fixture = await createInstalledFixture("drift-skill");
    await writeFile(path.join(fixture.install.destination, "SKILL.md"), "locally changed\n");
    await rm(path.join(fixture.install.destination, "scripts", "run.sh"));
    await writeFile(path.join(fixture.install.destination, "references", "local.md"), "keep\n");
    await mkdir(path.join(fixture.install.destination, "empty-local"));

    const installation = (await listInstallations(fixture.lifecycleInput)).packages[0];

    expect(installation).toMatchObject({
      state: "modified",
      missingFiles: ["scripts/run.sh"],
      modifiedFiles: ["SKILL.md"],
    });
    expect(installation?.untrackedPaths).toEqual(["empty-local/", "references/local.md"]);
    expect(await readFile(path.join(fixture.install.destination, "references", "local.md"), "utf8"))
      .toBe("keep\n");
  });

  it.skipIf(process.platform === "win32")(
    "marks links invalid and never follows them",
    async () => {
      const fixture = await createInstalledFixture("linked-skill");
      const outside = path.join(fixture.root, "outside.txt");
      await writeFile(outside, "outside\n");
      await symlink(outside, path.join(fixture.install.destination, "local-link"), "file");

      const installation = (await listInstallations(fixture.lifecycleInput)).packages[0];

      expect(installation?.state).toBe("invalid");
      expect(installation?.invalidPaths).toContainEqual({
        path: "local-link",
        reason: "Symbolic links are not managed.",
      });
      expect(await readFile(outside, "utf8")).toBe("outside\n");
    },
  );
});

describe("removeInstallation", () => {
  it("removes an unchanged managed destination and its now-empty lockfile", async () => {
    const fixture = await createInstalledFixture("remove-skill");

    const result = await removeInstallation({
      ...fixture.lifecycleInput,
      package: "remove-skill",
    });

    expect(result).toMatchObject({
      package: "remove-skill",
      previousState: "clean",
      preservedUntracked: false,
    });
    await expect(stat(fixture.install.destination)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(fixture.install.lockfilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically retains other package receipts when removing one installation", async () => {
    const fixture = await createInstalledFixture("first-skill");
    const secondSource = await createSkillFixture(path.join(fixture.root, "source", "second-skill"));
    const second = await installLocalSkill({
      sourcePath: secondSource,
      ...fixture.lifecycleInput,
    });

    await removeInstallation({ ...fixture.lifecycleInput, package: "first-skill" });

    const lockfile = await readLockfile(fixture.install.lockfilePath);
    expect(lockfile.packages.map((entry) => entry.package)).toEqual(["second-skill"]);
    expect(await readFile(path.join(second.destination, "SKILL.md"), "utf8")).toContain("second-skill");
  });

  it("refuses drift by default and forced removal preserves every untracked path", async () => {
    const fixture = await createInstalledFixture("preserve-skill");
    const localFile = path.join(fixture.install.destination, "references", "local.md");
    await writeFile(path.join(fixture.install.destination, "SKILL.md"), "modified\n");
    await writeFile(localFile, "preserve me\n");

    await expect(
      removeInstallation({ ...fixture.lifecycleInput, package: "preserve-skill" }),
    ).rejects.toMatchObject({ code: "REMOVE_DRIFT_DETECTED" });
    expect(await readFile(localFile, "utf8")).toBe("preserve me\n");

    const result = await removeInstallation({
      ...fixture.lifecycleInput,
      package: "preserve-skill",
      force: true,
    });

    expect(result.preservedUntracked).toBe(true);
    expect(result.preservedPaths).toContain("references/local.md");
    expect(await readFile(localFile, "utf8")).toBe("preserve me\n");
    await expect(readFile(path.join(fixture.install.destination, "SKILL.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(fixture.install.lockfilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires force to forget an installation whose destination is missing", async () => {
    const fixture = await createInstalledFixture("missing-skill");
    await rm(fixture.install.destination, { recursive: true });

    await expect(
      removeInstallation({ ...fixture.lifecycleInput, package: "missing-skill" }),
    ).rejects.toMatchObject({ code: "REMOVE_DRIFT_DETECTED" });

    const result = await removeInstallation({
      ...fixture.lifecycleInput,
      package: "missing-skill",
      force: true,
    });
    expect(result.previousState).toBe("missing");
    await expect(stat(fixture.install.lockfilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.skipIf(process.platform === "win32")(
    "refuses invalid linked content even when force is requested",
    async () => {
      const fixture = await createInstalledFixture("unsafe-skill");
      const outside = path.join(fixture.root, "outside.txt");
      await writeFile(outside, "outside\n");
      await symlink(outside, path.join(fixture.install.destination, "link"), "file");

      await expect(
        removeInstallation({
          ...fixture.lifecycleInput,
          package: "unsafe-skill",
          force: true,
        }),
      ).rejects.toMatchObject({ code: "REMOVE_INVALID_DESTINATION" });
      expect(await readFile(outside, "utf8")).toBe("outside\n");
      expect(await stat(fixture.install.lockfilePath)).toBeDefined();
    },
  );
});

describe("doctorInstallations", () => {
  it("reports stale operation locks and abandoned install/removal staging paths", async () => {
    const fixture = await createInstalledFixture("doctor-skill");
    await writeFile(
      path.join(fixture.projectRoot, OPERATION_LOCK_NAME),
      `${JSON.stringify({ pid: 2_147_483_647, started_at: "2026-08-13T00:00:00.000Z" })}\n`,
    );
    const skillsRoot = path.dirname(fixture.install.destination);
    await mkdir(path.join(skillsRoot, ".agentcargo-stage-interrupted"));
    await mkdir(path.join(skillsRoot, ".agentcargo-remove-interrupted"));

    const result = await doctorInstallations(fixture.lifecycleInput);

    expect(result.healthy).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "DOCTOR_STALE_OPERATION_LOCK",
      "DOCTOR_ABANDONED_INSTALL",
      "DOCTOR_ABANDONED_REMOVAL",
    ]));
    expect(result.installations[0]?.state).toBe("clean");
  });
});

async function createInstalledFixture(name: string): Promise<{
  root: string;
  projectRoot: string;
  lifecycleInput: {
    adapter: CodexAdapter;
    scope: "project";
    context: { projectRoot: string; userHome: string };
  };
  install: Awaited<ReturnType<typeof installLocalSkill>>;
}> {
  const root = await createTemporaryDirectory();
  const projectRoot = path.join(root, "project");
  const userHome = path.join(root, "home");
  await Promise.all([mkdir(projectRoot), mkdir(userHome)]);
  const source = await createSkillFixture(path.join(root, "source", name));
  const adapter = new CodexAdapter();
  const context = { projectRoot, userHome };
  const install = await installLocalSkill({
    sourcePath: source,
    adapter,
    scope: "project",
    context,
    now: () => new Date("2026-08-13T00:00:00.000Z"),
  });
  return {
    root,
    projectRoot,
    lifecycleInput: { adapter, scope: "project", context },
    install,
  };
}

async function createSkillFixture(skillPath: string): Promise<string> {
  await mkdir(skillPath, { recursive: true });
  const name = path.basename(skillPath);
  const template = createSkillTemplate(name, "A fixture for lifecycle safety tests.");
  await writeFile(path.join(skillPath, "SKILL.md"), template.skillMarkdown);
  await writeFile(path.join(skillPath, "agentcargo.yaml"), template.manifestYaml);
  await mkdir(path.join(skillPath, "references"));
  await writeFile(path.join(skillPath, "references", "guide.md"), "# Guide\n");
  await mkdir(path.join(skillPath, "scripts"));
  await writeFile(path.join(skillPath, "scripts", "run.sh"), "#!/bin/sh\nprintf 'test\\n'\n");
  return skillPath;
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "agentcargo-lifecycle-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
