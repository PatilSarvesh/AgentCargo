import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HostAdapter } from "./index.js";

export interface AdapterContractTestOptions {
  createAdapter: () => HostAdapter;
  expectedSkillsDirectory: string;
  compatibilityNotDeclaredCode: string;
  scopeNotDeclaredCode: string;
  skillRequiredCode: string;
  stagedSkillInvalidCode: string;
  projectRootInvalidCode: string;
}

export function defineAdapterContractTests(options: AdapterContractTestOptions): void {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  describe(`${options.createAdapter().id} HostAdapter contract`, () => {
    it("resolves project and user destinations below their canonical roots", async () => {
      const root = await createTemporaryDirectory(temporaryDirectories);
      const projectRoot = path.join(root, "project");
      const userHome = path.join(root, "home");
      await Promise.all([mkdir(projectRoot), mkdir(userHome)]);
      const canonicalProjectRoot = await realpath(projectRoot);
      const canonicalUserHome = await realpath(userHome);
      const adapter = options.createAdapter();
      const packageMetadata = {
        name: "contract-skill",
        version: "0.1.0",
        files: ["SKILL.md"],
        compatibility: { [adapter.id]: { scopes: ["project", "user"] as const } },
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

      expect(project.scopeRoot).toBe(canonicalProjectRoot);
      expect(project.skillsRoot).toBe(path.join(canonicalProjectRoot, options.expectedSkillsDirectory));
      expect(project.destination).toBe(
        path.join(canonicalProjectRoot, options.expectedSkillsDirectory, "contract-skill"),
      );
      expect(project.relativeDestination).toBe(`${options.expectedSkillsDirectory}/contract-skill`);
      expect(user.scopeRoot).toBe(canonicalUserHome);
      expect(user.skillsRoot).toBe(path.join(canonicalUserHome, options.expectedSkillsDirectory));
      expect(user.relativeDestination).toBe(`${options.expectedSkillsDirectory}/contract-skill`);
    });

    it("detects both available scope roots without starting a host process", async () => {
      const root = await createTemporaryDirectory(temporaryDirectories);
      const projectRoot = path.join(root, "project");
      const userHome = path.join(root, "home");
      await Promise.all([mkdir(projectRoot), mkdir(userHome)]);
      const canonicalProjectRoot = await realpath(projectRoot);
      const canonicalUserHome = await realpath(userHome);

      const result = await options.createAdapter().detect({ projectRoot, userHome });

      expect(result.detected).toBe(true);
      expect(result.scopeRoots).toEqual({ project: canonicalProjectRoot, user: canonicalUserHome });
      expect(result.notes).toEqual([]);
    });

    it("rejects an undeclared host and scope", async () => {
      const root = await createTemporaryDirectory(temporaryDirectories);
      const adapter = options.createAdapter();
      const hostMissing = await adapter.validatePackage({
        scope: "project",
        context: { userHome: root },
        package: { name: "contract-skill", version: "0.1.0", files: ["SKILL.md"] },
      });
      const scopeMissing = await adapter.validatePackage({
        scope: "user",
        context: { userHome: root },
        package: {
          name: "contract-skill",
          version: "0.1.0",
          files: ["SKILL.md"],
          compatibility: { [adapter.id]: { scopes: ["project"] } },
        },
      });

      expect(hostMissing).toContainEqual(expect.objectContaining({ code: options.compatibilityNotDeclaredCode }));
      expect(scopeMissing).toContainEqual(expect.objectContaining({ code: options.scopeNotDeclaredCode }));
    });

    it("requires a root SKILL.md", async () => {
      const root = await createTemporaryDirectory(temporaryDirectories);
      const adapter = options.createAdapter();
      const findings = await adapter.validatePackage({
        scope: "project",
        context: { projectRoot: root, userHome: root },
        package: {
          name: "contract-skill",
          version: "0.1.0",
          files: [],
          compatibility: { [adapter.id]: { scopes: ["project"] } },
        },
      });

      expect(findings).toContainEqual(expect.objectContaining({ code: options.skillRequiredCode }));
    });

    it("removes only registry metadata from a staged package", async () => {
      const root = await createTemporaryDirectory(temporaryDirectories);
      const staged = path.join(root, "staged");
      await mkdir(staged);
      await writeFile(path.join(staged, "SKILL.md"), "skill");
      await writeFile(path.join(staged, "agentcargo.yaml"), "manifest");
      const adapter = options.createAdapter();
      const packageMetadata = { name: "contract-skill", version: "0.1.0", files: ["SKILL.md"] };
      const plan = await adapter.planInstall({
        scope: "user",
        context: { userHome: root },
        package: packageMetadata,
      });

      await adapter.prepareStagedPackage({ plan, stagedPackageRoot: staged, package: packageMetadata });

      expect(await readFile(path.join(staged, "SKILL.md"), "utf8")).toBe("skill");
      await expect(readFile(path.join(staged, "agentcargo.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects a staged package without a regular SKILL.md", async () => {
      const root = await createTemporaryDirectory(temporaryDirectories);
      const staged = path.join(root, "staged");
      await mkdir(staged);
      const adapter = options.createAdapter();
      const packageMetadata = { name: "contract-skill", version: "0.1.0", files: ["SKILL.md"] };
      const plan = await adapter.planInstall({
        scope: "user",
        context: { userHome: root },
        package: packageMetadata,
      });

      await expect(
        adapter.prepareStagedPackage({ plan, stagedPackageRoot: staged, package: packageMetadata }),
      ).rejects.toMatchObject({ code: options.stagedSkillInvalidCode });
    });

    it("reports a healthy existing scope and a stable finding for a missing scope", async () => {
      const root = await createTemporaryDirectory(temporaryDirectories);
      const adapter = options.createAdapter();
      const healthy = await adapter.healthCheck({
        scope: "user",
        context: { userHome: root },
      });
      const unhealthy = await adapter.healthCheck({
        scope: "project",
        context: { projectRoot: path.join(root, "missing"), userHome: root },
      });

      expect(healthy).toEqual({ healthy: true, findings: [] });
      expect(unhealthy.healthy).toBe(false);
      expect(unhealthy.findings[0]).toMatchObject({ code: options.projectRootInvalidCode, severity: "error" });
    });
  });
}

async function createTemporaryDirectory(registry: string[]): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "agentcargo-adapter-contract-"));
  registry.push(directory);
  return directory;
}
