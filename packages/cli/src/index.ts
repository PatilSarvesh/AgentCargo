#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import { AgentCargoAdapterError, type InstallScope } from "@agentcargo/adapter-contract";
import { CodexAdapter } from "@agentcargo/adapter-codex";
import {
  AgentCargoInstallError,
  AgentCargoLifecycleError,
  AgentCargoLockfileError,
  AgentCargoFilesystemError,
  AgentCargoOperationLockError,
  createSkillTemplate,
  doctorInstallations,
  listInstallations,
  normalizeSkillName,
  installLocalSkill,
  packSkillDirectory,
  removeInstallation,
  validateSkillDirectory,
  AgentCargoArtifactError,
  type DoctorResult,
  type Finding,
  type InstallationInspection,
  type InstallationListResult,
} from "@agentcargo/core";

export const program = new Command();

program
  .name("agentcargo")
  .description("Create, validate, and manage portable AI-agent skills.")
  .version("0.1.0");

program
  .command("init")
  .description("Create SKILL.md and agentcargo.yaml in a skill directory.")
  .argument("[path]", "skill directory", ".")
  .option("--name <name>", "skill name; defaults to the directory name")
  .option("--description <description>", "what the skill does and when to use it")
  .option("--json", "print machine-readable output")
  .action(async (inputPath: string, options: InitOptions) => {
    const root = path.resolve(inputPath);
    const requestedName = options.name ?? path.basename(root);
    const normalizedName = normalizeSkillName(requestedName);

    try {
      if (path.basename(root) !== normalizedName) {
        throw new CliError(
          "DIRECTORY_NAME_MISMATCH",
          `Skill directory must be named '${normalizedName}' to match the Agent Skills specification.`,
        );
      }

      await mkdir(root, { recursive: true });
      const template = createSkillTemplate(normalizedName, options.description);
      const skillPath = path.join(root, "SKILL.md");
      const manifestPath = path.join(root, "agentcargo.yaml");

      const existing = await existingPaths([skillPath, manifestPath]);
      if (existing.length > 0) {
        throw new CliError(
          "FILES_ALREADY_EXIST",
          `Refusing to overwrite: ${existing.map((item) => path.basename(item)).join(", ")}`,
        );
      }

      await writeFile(skillPath, template.skillMarkdown, { encoding: "utf8", flag: "wx" });
      await writeFile(manifestPath, template.manifestYaml, { encoding: "utf8", flag: "wx" });

      if (options.json) {
        printJson({
          ok: true,
          name: template.name,
          root,
          files: [skillPath, manifestPath],
        });
      } else {
        console.log(`Created skill '${template.name}'`);
        console.log(`  ${skillPath}`);
        console.log(`  ${manifestPath}`);
        console.log(`\nNext: agentcargo validate ${quoteIfNeeded(root)}`);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

program
  .command("add")
  .description("Install a local skill directory into a supported AI agent.")
  .argument("<path>", "local skill directory")
  .requiredOption("--agent <host>", "target AI agent (currently: codex)")
  .requiredOption("--scope <scope>", "installation scope: project or user")
  .option("--project-root <path>", "project root for project scope", ".")
  .option("--json", "print machine-readable output")
  .action(async (inputPath: string, options: AddOptions) => {
    try {
      if (options.agent !== "codex") {
        throw new CliError(
          "HOST_UNSUPPORTED",
          `Host '${options.agent}' is not supported. The current adapter is 'codex'.`,
        );
      }
      if (options.scope !== "project" && options.scope !== "user") {
        throw new CliError(
          "SCOPE_INVALID",
          "Installation scope must be 'project' or 'user'.",
        );
      }

      const result = await installLocalSkill({
        sourcePath: inputPath,
        adapter: new CodexAdapter(),
        scope: options.scope,
        context: {
          userHome: homedir(),
          ...(options.scope === "project"
            ? { projectRoot: path.resolve(options.projectRoot) }
            : {}),
        },
      });

      if (options.json) {
        printJson({ ok: true, ...result });
      } else {
        console.log(`Installed ${result.package}@${result.version}`);
        console.log(`Agent: ${result.agent} (${result.scope})`);
        console.log(`Destination: ${result.destination}`);
        console.log(`Digest: ${result.digest}`);
        console.log(`Lockfile: ${result.lockfilePath}`);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

program
  .command("validate")
  .description("Validate a local Agent Skills directory and AgentCargo metadata.")
  .argument("[path]", "skill directory", ".")
  .option("--json", "print machine-readable output")
  .action(async (inputPath: string, options: JsonOptions) => {
    try {
      const result = await validateSkillDirectory(inputPath);
      if (options.json) {
        printJson(result);
      } else {
        printValidationResult(result);
      }

      if (!result.valid) process.exitCode = 1;
    } catch (error) {
      handleError(error, options.json);
    }
  });

program
  .command("list")
  .description("List managed skills and report local installation drift.")
  .option("--agent <host>", "target AI agent", "codex")
  .option("--scope <scope>", "installation scope: project, user, or all", "project")
  .option("--project-root <path>", "project root for project scope", ".")
  .option("--json", "print machine-readable output")
  .action(async (options: ScopeOptions) => {
    try {
      const adapter = resolveAdapter(options.agent);
      const scopes = parseScopes(options.scope);
      const context = {
        projectRoot: path.resolve(options.projectRoot),
        userHome: homedir(),
      };
      const results = await Promise.all(
        scopes.map((scope) => listInstallations({ adapter, scope, context })),
      );
      if (options.json) {
        printJson({ ok: true, installations: results });
      } else {
        printInstallationLists(results);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

program
  .command("remove")
  .description("Remove a managed skill without deleting untracked local files.")
  .argument("<package>", "installed package name")
  .requiredOption("--agent <host>", "target AI agent (currently: codex)")
  .requiredOption("--scope <scope>", "installation scope: project or user")
  .option("--project-root <path>", "project root for project scope", ".")
  .option("--force", "allow removal when managed files are missing or modified")
  .option("--yes", "confirm the destructive operation")
  .option("--json", "print machine-readable output")
  .action(async (packageName: string, options: RemoveOptions) => {
    try {
      if (!options.yes) {
        throw new CliError(
          "REMOVE_CONFIRMATION_REQUIRED",
          "Removal requires explicit confirmation. Review agentcargo list, then repeat with --yes.",
        );
      }
      const adapter = resolveAdapter(options.agent);
      const scope = parseSingleScope(options.scope);
      const result = await removeInstallation({
        package: packageName,
        adapter,
        scope,
        context: {
          projectRoot: path.resolve(options.projectRoot),
          userHome: homedir(),
        },
        force: options.force === true,
      });
      if (options.json) {
        printJson({ ok: true, ...result });
      } else {
        console.log(`Removed ${result.package}@${result.version}`);
        console.log(`Agent: ${result.agent} (${result.scope})`);
        if (result.preservedUntracked) {
          console.log(`Preserved unmanaged content at: ${result.destination}`);
          for (const preserved of result.preservedPaths) console.log(`  ${preserved}`);
        }
        console.log(`Lockfile: ${result.lockfilePath}`);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

program
  .command("doctor")
  .description("Diagnose host paths, lockfiles, drift, and interrupted operations.")
  .option("--agent <host>", "target AI agent", "codex")
  .option("--scope <scope>", "installation scope: project, user, or all", "all")
  .option("--project-root <path>", "project root for project scope", ".")
  .option("--json", "print machine-readable output")
  .action(async (options: ScopeOptions) => {
    try {
      const adapter = resolveAdapter(options.agent);
      const scopes = parseScopes(options.scope);
      const context = {
        projectRoot: path.resolve(options.projectRoot),
        userHome: homedir(),
      };
      const results = await Promise.all(
        scopes.map((scope) => doctorInstallations({ adapter, scope, context })),
      );
      if (options.json) {
        printJson({ ok: results.every((result) => result.healthy), diagnostics: results });
      } else {
        printDoctorResults(results);
      }
      if (results.some((result) => !result.healthy)) process.exitCode = 1;
    } catch (error) {
      handleError(error, options.json);
    }
  });

program
  .command("pack")
  .description("Create a deterministic, digest-addressed AgentCargo artifact.")
  .argument("[path]", "skill directory", ".")
  .option("-o, --output <path>", "artifact output path")
  .option("--json", "print machine-readable output")
  .action(async (inputPath: string, options: PackOptions) => {
    try {
      const result = await packSkillDirectory(inputPath, options.output);
      if (options.json) {
        printJson({ ok: true, ...result });
      } else {
        console.log(`Packed ${result.name}@${result.version}`);
        console.log(`Artifact: ${result.artifactPath}`);
        console.log(`Digest: ${result.digest}`);
        console.log(`Files: ${result.files.length} (${result.expandedBytes} bytes expanded)`);
        console.log(`Artifact bytes: ${result.artifactBytes}`);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

program.showHelpAfterError();

interface JsonOptions {
  json?: boolean;
}

interface InitOptions extends JsonOptions {
  name?: string;
  description?: string;
}

interface PackOptions extends JsonOptions {
  output?: string;
}

interface AddOptions extends JsonOptions {
  agent: string;
  scope: InstallScope | string;
  projectRoot: string;
}

interface ScopeOptions extends JsonOptions {
  agent: string;
  scope: string;
  projectRoot: string;
}

interface RemoveOptions extends JsonOptions {
  agent: string;
  scope: string;
  projectRoot: string;
  force?: boolean;
  yes?: boolean;
}

class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

function printValidationResult(result: Awaited<ReturnType<typeof validateSkillDirectory>>): void {
  const status = result.valid ? "VALID" : "INVALID";
  console.log(`${status}: ${result.root}`);
  if (result.skillName) console.log(`Skill: ${result.skillName}`);
  if (result.manifest) console.log(`Version: ${result.manifest.version}`);
  console.log(`Files: ${result.files.length} (${result.totalBytes} bytes)`);

  if (result.findings.length === 0) {
    console.log("No findings.");
    return;
  }

  console.log("");
  for (const item of sortFindings(result.findings)) {
    const location = item.path ? ` ${item.path}` : "";
    console.log(`${severityLabel(item.severity)} ${item.code}${location}`);
    console.log(`  ${item.message}`);
  }
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (left, right) => severityRank(left.severity) - severityRank(right.severity),
  );
}

function severityRank(severity: Finding["severity"]): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function severityLabel(severity: Finding["severity"]): string {
  if (severity === "error") return "ERROR";
  if (severity === "warning") return "WARN ";
  return "INFO ";
}

function printInstallationLists(results: InstallationListResult[]): void {
  for (const [index, result] of results.entries()) {
    if (index > 0) console.log("");
    console.log(`${result.agent} ${result.scope} installations`);
    console.log(`Lockfile: ${result.lockfilePath}`);
    if (result.packages.length === 0) {
      console.log("No managed skills.");
      continue;
    }
    for (const installation of result.packages) printInstallation(installation);
  }
}

function printInstallation(installation: InstallationInspection): void {
  console.log(`${installation.package}@${installation.version}  ${installation.state.toUpperCase()}`);
  console.log(`  ${installation.destination}`);
  if (installation.missingFiles.length > 0) {
    console.log(`  Missing: ${installation.missingFiles.join(", ")}`);
  }
  if (installation.modifiedFiles.length > 0) {
    console.log(`  Modified: ${installation.modifiedFiles.join(", ")}`);
  }
  if (installation.untrackedPaths.length > 0) {
    console.log(`  Untracked: ${installation.untrackedPaths.join(", ")}`);
  }
  for (const invalid of installation.invalidPaths) {
    console.log(`  Invalid ${invalid.path}: ${invalid.reason}`);
  }
}

function printDoctorResults(results: DoctorResult[]): void {
  for (const [index, result] of results.entries()) {
    if (index > 0) console.log("");
    console.log(`${result.healthy ? "HEALTHY" : "ATTENTION"}: ${result.agent} ${result.scope}`);
    if (result.findings.length === 0) {
      console.log("No findings.");
      continue;
    }
    for (const finding of result.findings) {
      const location = finding.path ? ` ${finding.path}` : "";
      console.log(`${finding.severity === "error" ? "ERROR" : "WARN "} ${finding.code}${location}`);
      console.log(`  ${finding.message}`);
    }
  }
}

function resolveAdapter(agent: string): CodexAdapter {
  if (agent !== "codex") {
    throw new CliError(
      "HOST_UNSUPPORTED",
      `Host '${agent}' is not supported. The current adapter is 'codex'.`,
    );
  }
  return new CodexAdapter();
}

function parseScopes(scope: string): InstallScope[] {
  if (scope === "all") return ["project", "user"];
  return [parseSingleScope(scope)];
}

function parseSingleScope(scope: string): InstallScope {
  if (scope !== "project" && scope !== "user") {
    throw new CliError("SCOPE_INVALID", "Installation scope must be 'project' or 'user'.");
  }
  return scope;
}

async function existingPaths(paths: string[]): Promise<string[]> {
  const results = await Promise.all(
    paths.map(async (candidate) => {
      try {
        await access(candidate);
        return candidate;
      } catch {
        return undefined;
      }
    }),
  );
  return results.filter((candidate): candidate is string => candidate !== undefined);
}

function handleError(error: unknown, json = false): void {
  const code =
    error instanceof CliError ||
    error instanceof AgentCargoArtifactError ||
    error instanceof AgentCargoFilesystemError ||
    error instanceof AgentCargoInstallError ||
    error instanceof AgentCargoLifecycleError ||
    error instanceof AgentCargoLockfileError ||
    error instanceof AgentCargoOperationLockError ||
    error instanceof AgentCargoAdapterError
      ? error.code
      : "UNEXPECTED_ERROR";
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";

  if (json) {
    printJson({ ok: false, error: { code, message } });
  } else {
    console.error(`ERROR ${code}`);
    console.error(`  ${message}`);
  }
  process.exitCode = 1;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function isExecutedDirectly(): boolean {
  const executablePath = process.argv[1];
  if (!executablePath) return false;

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(executablePath);
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  await program.parseAsync(process.argv);
}
