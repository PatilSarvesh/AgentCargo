import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  AgentCargoAdapterError,
  type AdapterContext,
  type AdapterFinding,
  type DestinationInput,
  type DetectionResult,
  type HealthCheckInput,
  type HealthCheckResult,
  type HostAdapter,
  type InstallPlan,
  type InstallScope,
  type PrepareStagedPackageInput,
  type ResolvedDestination,
} from "@agentcargo/adapter-contract";

export const CLAUDE_CODE_ADAPTER_VERSION = "0.1.0";
export const CLAUDE_CODE_SKILLS_DOCUMENTATION_URL = "https://code.claude.com/docs/en/slash-commands";
export const CLAUDE_CODE_DOCUMENTATION_LAST_VERIFIED = "2026-08-13";

const SUPPORTED_SCOPES = ["project", "user"] as const satisfies readonly InstallScope[];
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ClaudeCodeAdapter implements HostAdapter {
  readonly id = "claude-code";
  readonly adapterVersion = CLAUDE_CODE_ADAPTER_VERSION;
  readonly documentationUrl = CLAUDE_CODE_SKILLS_DOCUMENTATION_URL;
  readonly documentationLastVerified = CLAUDE_CODE_DOCUMENTATION_LAST_VERIFIED;

  async detect(context: AdapterContext): Promise<DetectionResult> {
    const scopeRoots: Partial<Record<InstallScope, string>> = {};
    const notes: string[] = [];

    if (context.projectRoot) {
      try {
        scopeRoots.project = await resolveRealDirectory(
          context.projectRoot,
          "CLAUDE_CODE_PROJECT_ROOT_INVALID",
        );
      } catch (error) {
        notes.push(error instanceof Error ? error.message : "Claude Code project root is unavailable.");
      }
    }

    try {
      scopeRoots.user = await resolveRealDirectory(context.userHome, "CLAUDE_CODE_USER_HOME_INVALID");
    } catch (error) {
      notes.push(error instanceof Error ? error.message : "Claude Code user home is unavailable.");
    }

    return {
      detected: Object.keys(scopeRoots).length > 0,
      scopeRoots,
      notes,
    };
  }

  supportedScopes(): readonly InstallScope[] {
    return SUPPORTED_SCOPES;
  }

  async resolveDestination(input: DestinationInput): Promise<ResolvedDestination> {
    assertScope(input.scope);
    assertSkillName(input.package.name);

    const requestedRoot = input.scope === "project" ? input.context.projectRoot : input.context.userHome;
    if (!requestedRoot) {
      throw new AgentCargoAdapterError(
        "CLAUDE_CODE_PROJECT_ROOT_REQUIRED",
        "A project root is required for a project-scoped Claude Code installation.",
      );
    }

    const rootCode =
      input.scope === "project" ? "CLAUDE_CODE_PROJECT_ROOT_INVALID" : "CLAUDE_CODE_USER_HOME_INVALID";
    const scopeRoot = await resolveRealDirectory(requestedRoot, rootCode);
    const skillsRoot = path.join(scopeRoot, ".claude", "skills");
    const destination = path.join(skillsRoot, input.package.name);

    return {
      host: this.id,
      scope: input.scope,
      scopeRoot,
      skillsRoot,
      destination,
      relativeDestination: [".claude", "skills", input.package.name].join("/"),
    };
  }

  async validatePackage(input: DestinationInput): Promise<AdapterFinding[]> {
    const findings: AdapterFinding[] = [];
    const declared = input.package.compatibility?.[this.id];

    if (!declared) {
      findings.push({
        code: "CLAUDE_CODE_COMPATIBILITY_NOT_DECLARED",
        severity: "error",
        message: "agentcargo.yaml must declare compatibility for the Claude Code host.",
      });
    } else if (!declared.scopes.includes(input.scope)) {
      findings.push({
        code: "CLAUDE_CODE_SCOPE_NOT_DECLARED",
        severity: "error",
        message: `The package does not declare Claude Code ${input.scope} scope compatibility.`,
      });
    }

    if (!input.package.files.includes("SKILL.md")) {
      findings.push({
        code: "CLAUDE_CODE_SKILL_MD_REQUIRED",
        severity: "error",
        message: "Claude Code skills require a root SKILL.md file.",
      });
    }

    return findings;
  }

  async planInstall(input: DestinationInput): Promise<InstallPlan> {
    const destination = await this.resolveDestination(input);
    return {
      ...destination,
      packageName: input.package.name,
      mutations: [
        { kind: "ensure-directory", path: destination.skillsRoot },
        { kind: "stage-artifact", parent: destination.skillsRoot },
        { kind: "remove-package-file", relativePath: "agentcargo.yaml" },
        { kind: "atomic-rename", destination: destination.destination },
      ],
    };
  }

  async prepareStagedPackage(input: PrepareStagedPackageInput): Promise<void> {
    const stagedSkill = path.join(input.stagedPackageRoot, "SKILL.md");
    const skillStat = await lstat(stagedSkill).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new AgentCargoAdapterError(
          "CLAUDE_CODE_STAGED_SKILL_INVALID",
          "The staged Claude Code skill is missing SKILL.md.",
        );
      }
      throw error;
    });
    if (!skillStat.isFile() || skillStat.isSymbolicLink()) {
      throw new AgentCargoAdapterError(
        "CLAUDE_CODE_STAGED_SKILL_INVALID",
        "The staged Claude Code SKILL.md must be a regular file.",
      );
    }

    await rm(path.join(input.stagedPackageRoot, "agentcargo.yaml"), { force: true });
  }

  async healthCheck(input: HealthCheckInput): Promise<HealthCheckResult> {
    const placeholderPackage = {
      name: "health-check",
      version: "0.0.0",
      files: ["SKILL.md"],
    };
    try {
      await this.resolveDestination({
        scope: input.scope,
        context: input.context,
        package: placeholderPackage,
      });
      return { healthy: true, findings: [] };
    } catch (error) {
      return {
        healthy: false,
        findings: [
          {
            code: error instanceof AgentCargoAdapterError ? error.code : "CLAUDE_CODE_HEALTH_CHECK_FAILED",
            severity: "error",
            message: error instanceof Error ? error.message : "Claude Code health check failed.",
          },
        ],
      };
    }
  }
}

function assertScope(scope: InstallScope): void {
  if (!SUPPORTED_SCOPES.includes(scope)) {
    throw new AgentCargoAdapterError(
      "CLAUDE_CODE_SCOPE_UNSUPPORTED",
      `Claude Code does not support the '${scope}' installation scope.`,
    );
  }
}

function assertSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name) || name.length > 64) {
    throw new AgentCargoAdapterError("CLAUDE_CODE_SKILL_NAME_INVALID", "Claude Code skill name is invalid.");
  }
}

async function resolveRealDirectory(input: string, code: string): Promise<string> {
  const resolved = path.resolve(input);
  const canonical = await realpath(resolved).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new AgentCargoAdapterError(code, `Directory does not exist: ${resolved}`);
    }
    throw error;
  });
  const directoryStat = await lstat(canonical);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new AgentCargoAdapterError(code, `Path is not a real directory: ${resolved}`);
  }
  return canonical;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
