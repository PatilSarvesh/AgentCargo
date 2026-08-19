import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineAdapterContractTests } from "@agentcargo/adapter-contract/test-suite";
import { CodexAdapter } from "./index.js";

const temporaryDirectories: string[] = [];

defineAdapterContractTests({
  createAdapter: () => new CodexAdapter(),
  expectedSkillsDirectory: ".agents/skills",
  compatibilityNotDeclaredCode: "CODEX_COMPATIBILITY_NOT_DECLARED",
  scopeNotDeclaredCode: "CODEX_SCOPE_NOT_DECLARED",
  skillRequiredCode: "CODEX_SKILL_MD_REQUIRED",
  stagedSkillInvalidCode: "CODEX_STAGED_SKILL_INVALID",
  projectRootInvalidCode: "CODEX_PROJECT_ROOT_INVALID",
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CodexAdapter", () => {
  it("resolves the documented project and user skill locations", async () => {
    const root = await createTemporaryDirectory();
    const projectRoot = path.join(root, "project");
    const userHome = path.join(root, "home");
    await Promise.all([mkdir(projectRoot), mkdir(userHome)]);
    const adapter = new CodexAdapter();
    const packageMetadata = {
      name: "hello-skill",
      version: "0.1.0",
      files: ["SKILL.md"],
      compatibility: { codex: { scopes: ["project", "user"] as const } },
    };

    const project = await adapter.resolveDestination({
      scope: "project",
      context: { projectRoot, userHome },
      package: packageMetadata,
    });
    const user = await adapter.resolveDestination({
      scope: "user",
      context: { projectRoot, userHome },
      package: packageMetadata,
    });

    expect(project.destination).toBe(path.join(await realpath(projectRoot), ".agents", "skills", "hello-skill"));
    expect(project.relativeDestination).toBe(".agents/skills/hello-skill");
    expect(user.destination).toBe(path.join(await realpath(userHome), ".agents", "skills", "hello-skill"));
    expect(user.relativeDestination).toBe(".agents/skills/hello-skill");
  });

  it("blocks a scope the publisher did not declare", async () => {
    const root = await createTemporaryDirectory();
    const adapter = new CodexAdapter();
    const findings = await adapter.validatePackage({
      scope: "user",
      context: { userHome: root },
      package: {
        name: "project-only",
        version: "1.0.0",
        files: ["SKILL.md"],
        compatibility: { codex: { scopes: ["project"] } },
      },
    });

    expect(findings).toContainEqual(expect.objectContaining({ code: "CODEX_SCOPE_NOT_DECLARED" }));
  });

  it("removes registry-only metadata from a staged Codex skill", async () => {
    const root = await createTemporaryDirectory();
    const staged = path.join(root, "staged");
    await mkdir(staged);
    await writeFile(path.join(staged, "SKILL.md"), "skill");
    await writeFile(path.join(staged, "agentcargo.yaml"), "manifest");
    const adapter = new CodexAdapter();
    const packageMetadata = { name: "hello-skill", version: "0.1.0", files: ["SKILL.md"] };
    const plan = await adapter.planInstall({
      scope: "user",
      context: { userHome: root },
      package: packageMetadata,
    });

    await adapter.prepareStagedPackage({ plan, stagedPackageRoot: staged, package: packageMetadata });

    expect(await readFile(path.join(staged, "SKILL.md"), "utf8")).toBe("skill");
    await expect(readFile(path.join(staged, "agentcargo.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "agentcargo-codex-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
