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
  AgentCargoLockfileError,
  createSkillTemplate,
  normalizeSkillName,
  installLocalSkill,
  packSkillDirectory,
  validateSkillDirectory,
  AgentCargoArtifactError,
  type Finding,
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
    error instanceof AgentCargoInstallError ||
    error instanceof AgentCargoLockfileError ||
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
