#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import { AgentCargoAdapterError, type HostAdapter, type InstallScope } from "@agentcargo/adapter-contract";
import { ClaudeCodeAdapter } from "@agentcargo/adapter-claude-code";
import { CodexAdapter } from "@agentcargo/adapter-codex";
import {
  AGENTCARGO_ARTIFACT_MEDIA_TYPE,
  formatPackageCoordinate,
  formatReleaseCoordinate,
  type RegistryReleaseCompletionRequest,
  type RegistryPackageSummary,
  type RegistryRelease,
  type RegistrySearchResponse,
} from "@agentcargo/registry-contract";
import {
  FileRegistryCredentialStore,
  GitHubOAuthClient,
  GitHubOAuthError,
  RegistryClient,
  RegistryClientError,
  RegistryCredentialStoreError,
} from "@agentcargo/registry-client";
import {
  AgentCargoInstallError,
  AgentCargoLifecycleError,
  AgentCargoLockfileError,
  AgentCargoFilesystemError,
  AgentCargoOperationLockError,
  AgentCargoRollbackStateError,
  AgentCargoUpdateError,
  AgentCargoUpdatePreviewError,
  auditInstallations,
  createSkillTemplate,
  doctorInstallations,
  extractArtifact,
  inventoryRegularTree,
  listInstallations,
  readLockfile,
  normalizeSkillName,
  installLocalSkill,
  packSkillDirectory,
  previewInstallationUpdate,
  rollbackInstallation,
  removeInstallation,
  scanSkillDirectory,
  type StaticScanFinding,
  validateSkillDirectory,
  AgentCargoArtifactError,
  type DoctorResult,
  type Finding,
  type InstallationInspection,
  type InstallationListResult,
  type InstallationUpdatePreviewResult,
  type InstallationUpdateResult,
  type InstallationAuditResult,
  updateInstallation,
} from "@agentcargo/core";

export const program = new Command();

program
  .name("agentcargo")
  .description("Create, validate, and manage portable AI-agent skills.")
  .version("0.1.0");

program
  .command("search")
  .description("Search public packages in a registry.")
  .argument("<query>", "package name, description, or tag query")
  .option("--registry <url>", "registry base URL (or set AGENTCARGO_REGISTRY_URL)")
  .option("--host <host>", "filter by compatible host")
  .option("--scope <scope>", "filter by installation scope: project or user")
  .option("--cursor <cursor>", "continue from a previous result cursor")
  .option("--limit <number>", "maximum results (1-100)")
  .option("--json", "print machine-readable output")
  .action(async (query: string, options: RegistrySearchOptions) => {
    try {
      const request = {
        query,
        ...(options.host ? { host: options.host } : {}),
        ...(options.scope ? { scope: parseSingleScope(options.scope) } : {}),
        ...(options.cursor ? { cursor: options.cursor } : {}),
        ...(options.limit !== undefined ? { limit: parseRegistryLimit(options.limit) } : {}),
      };
      const response = await createRegistryClient(options.registry).search(request);
      if (options.json) printJson({ ok: true, ...response });
      else printRegistrySearch(response);
    } catch (error) {
      handleError(error, options.json);
    }
  });

program
  .command("inspect")
  .description("Inspect a public package or exact release in a registry.")
  .argument("<package>", "@namespace/name or @namespace/name@version")
  .option("--registry <url>", "registry base URL (or set AGENTCARGO_REGISTRY_URL)")
  .option("--json", "print machine-readable output")
  .action(async (reference: string, options: RegistryInspectOptions) => {
    try {
      const coordinate = parsePackageReference(reference);
      const client = createRegistryClient(options.registry);
      if ("version" in coordinate) {
        const response = await client.getRelease(coordinate);
        if (options.json) printJson({ ok: true, ...response });
        else printRegistryRelease(response.release);
      } else {
        const summary = await client.getPackage(coordinate);
        if (options.json) printJson({ ok: true, package: summary });
        else printRegistryPackage(summary);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

program
  .command("publish")
  .description("Publish a validated local skill through an authenticated registry.")
  .argument("[path]", "skill directory", ".")
  .requiredOption("--namespace <namespace>", "publisher namespace")
  .option("--registry <url>", "registry base URL (or set AGENTCARGO_REGISTRY_URL)")
  .option("--idempotency-key <key>", "stable retry key for this publication")
  .option("--source-repository <url>", "HTTPS source repository URL (defaults to agentcargo.yaml repository)")
  .option("--source-commit <commit>", "source commit identifier")
  .option("--json", "print machine-readable output")
  .action(async (inputPath: string, options: PublishOptions) => {
    try {
      const registry = requireRegistryUrl(options.registry);
      const credential = await requirePublishCredential(registry);
      const result = await publishLocalSkill(inputPath, options, credential, registry);
      if (options.json) printJson({ ok: true, ...result });
      else {
        console.log(`Published ${formatReleaseCoordinate(result.coordinate)}`);
        console.log(`Release: ${result.releaseId}`);
        console.log(`Status: ${result.status}`);
        console.log(`Digest: ${result.digest}`);
        console.log(`Artifact bytes: ${result.bytes}`);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

const authCommand = program
  .command("auth")
  .description("Inspect or remove the local registry authentication credential.");

authCommand
  .command("status")
  .description("Show authentication status without printing credentials.")
  .option("--registry <url>", "registry base URL (or set AGENTCARGO_REGISTRY_URL)")
  .option("--json", "print machine-readable output")
  .action(async (options: AuthOptions) => {
    try {
      const registry = requireRegistryUrl(options.registry);
      const status = await new FileRegistryCredentialStore().getStatus(registry);
      if (options.json) printJson({ ok: true, ...status });
      else printAuthStatus(status);
    } catch (error) {
      handleError(error, options.json);
    }
  });

authCommand
  .command("login")
  .description("Sign in with GitHub using the device authorization flow.")
  .option("--registry <url>", "registry base URL (or set AGENTCARGO_REGISTRY_URL)")
  .option("--client-id <id>", "GitHub OAuth client ID (or set AGENTCARGO_GITHUB_CLIENT_ID)")
  .option("--scope <scope...>", "optional GitHub OAuth scopes")
  .option("--json", "print machine-readable output")
  .action(async (options: AuthLoginOptions) => {
    try {
      ensureInteractiveAuthAllowed();
      const registry = requireRegistryUrl(options.registry);
      const client = new GitHubOAuthClient({
        clientId: requireGitHubClientId(options.clientId),
        ...(process.env.AGENTCARGO_GITHUB_CLIENT_SECRET ? { clientSecret: process.env.AGENTCARGO_GITHUB_CLIENT_SECRET } : {}),
      });
      const device = await client.requestDeviceCode(options.scope ? { scopes: options.scope } : {});
      if (!options.json) {
        console.error("Open GitHub to authorize AgentCargo:");
        console.error(`  ${device.verificationUri}`);
        console.error(`Enter code: ${device.userCode}`);
        if (device.verificationUriComplete) console.error(`Direct link: ${device.verificationUriComplete}`);
      }
      const credential = await client.pollDeviceToken(device);
      const identity = await client.getAuthenticatedIdentity(credential.accessToken);
      const store = new FileRegistryCredentialStore();
      await store.set(registry, credential);
      const status = await store.getStatus(registry);
      if (options.json) {
        printJson({ ok: true, ...status, identity });
      } else {
        console.log(`Authenticated: ${status.registry}`);
        console.log(`GitHub: ${identity.login ?? identity.subject}`);
        if (status.expiresAt) console.log(`Expires: ${status.expiresAt}`);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

authCommand
  .command("refresh")
  .description("Refresh the stored GitHub credential without printing it.")
  .option("--registry <url>", "registry base URL (or set AGENTCARGO_REGISTRY_URL)")
  .option("--client-id <id>", "GitHub OAuth client ID (or set AGENTCARGO_GITHUB_CLIENT_ID)")
  .option("--json", "print machine-readable output")
  .action(async (options: AuthRefreshOptions) => {
    try {
      const registry = requireRegistryUrl(options.registry);
      const store = new FileRegistryCredentialStore();
      const current = await store.get(registry);
      if (!current) throw new CliError("AUTH_NOT_AUTHENTICATED", `No local credential exists for ${registry}.`);
      const client = new GitHubOAuthClient({
        clientId: requireGitHubClientId(options.clientId),
        ...(process.env.AGENTCARGO_GITHUB_CLIENT_SECRET ? { clientSecret: process.env.AGENTCARGO_GITHUB_CLIENT_SECRET } : {}),
      });
      const credential = await client.refreshAccessToken(current);
      const identity = await client.getAuthenticatedIdentity(credential.accessToken);
      await store.set(registry, credential);
      const status = await store.getStatus(registry);
      if (options.json) printJson({ ok: true, ...status, identity });
      else {
        console.log(`Refreshed: ${status.registry}`);
        console.log(`GitHub: ${identity.login ?? identity.subject}`);
        if (status.expiresAt) console.log(`Expires: ${status.expiresAt}`);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

authCommand
  .command("logout")
  .description("Remove the local credential for a registry without printing it.")
  .option("--registry <url>", "registry base URL (or set AGENTCARGO_REGISTRY_URL)")
  .option("--json", "print machine-readable output")
  .action(async (options: AuthOptions) => {
    try {
      const registry = requireRegistryUrl(options.registry);
      const removed = await new FileRegistryCredentialStore().remove(registry);
      if (options.json) printJson({ ok: true, registry: registry.endsWith("/") ? registry : `${registry}/`, removed });
      else console.log(removed ? `Removed local credential for ${registry}` : `No local credential for ${registry}`);
    } catch (error) {
      handleError(error, options.json);
    }
  });

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
  .description("Install a local or public registry skill into a supported AI agent.")
  .argument("<path-or-package>", "local skill directory or @namespace/name[@version]")
  .requiredOption("--agent <host>", "target AI agent (codex or claude-code)")
  .requiredOption("--scope <scope>", "installation scope: project or user")
  .option("--registry <url>", "registry base URL for @namespace/name installs (or set AGENTCARGO_REGISTRY_URL)")
  .option("--project-root <path>", "project root for project scope", ".")
  .option("--json", "print machine-readable output")
  .action(async (inputPath: string, options: AddOptions) => {
    try {
      const scope = parseSingleScope(options.scope);
      const result = inputPath.startsWith("@")
        ? await installRegistrySkill(inputPath, options, scope)
        : await installLocalSkill({
            sourcePath: inputPath,
            adapter: resolveAdapter(options.agent),
            scope,
            context: {
              userHome: homedir(),
              ...(scope === "project" ? { projectRoot: path.resolve(options.projectRoot) } : {}),
            },
          });

      if (options.json) {
        printJson({ ok: true, ...result });
      } else {
        console.log(`Installed ${result.package}@${result.version}`);
        console.log(`Agent: ${result.agent} (${result.scope})`);
        if ("source" in result) console.log(`Source: ${result.source}`);
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
  .command("scan")
  .description("Run versioned static observations without executing package files.")
  .argument("[path]", "skill directory", ".")
  .option("--json", "print machine-readable output")
  .action(async (inputPath: string, options: JsonOptions) => {
    try {
      const result = await scanSkillDirectory(inputPath);
      if (options.json) {
        printJson({ ok: result.valid, ...result });
      } else {
        printStaticScanResult(result);
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
  .command("update")
  .description("Preview or apply compatible registry updates for managed skills.")
  .argument("[package]", "installed @namespace/name or explicit @namespace/name@version target")
  .option("--agent <host>", "target AI agent", "codex")
  .option("--scope <scope>", "installation scope: project or user", "project")
  .option("--registry <url>", "registry base URL (or set AGENTCARGO_REGISTRY_URL)")
  .option("--project-root <path>", "project root for project scope", ".")
  .option("--dry-run", "show verified changes without modifying files or the lockfile")
  .option("--yes", "confirm applying the update")
  .option("--json", "print machine-readable output")
  .action(async (reference: string | undefined, options: UpdateOptions) => {
    try {
      if (!options.dryRun && !options.yes) {
        throw new CliError(
          "UPDATE_CONFIRMATION_REQUIRED",
          "Applying updates requires explicit confirmation. Review with --dry-run, then repeat with --yes.",
        );
      }
      const scope = parseSingleScope(options.scope);
      const updates = await processRegistryUpdates(reference, options, scope, options.dryRun !== true);
      if (options.json) {
        printJson({ ok: true, dryRun: options.dryRun === true, updates });
      } else {
        if (options.dryRun) printUpdatePreviews(updates);
        else printAppliedUpdates(updates as InstallationUpdateResult[]);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

program
  .command("rollback")
  .description("Atomically restore the retained previous version of a managed skill.")
  .argument("<package>", "installed local name or @namespace/name")
  .option("--agent <host>", "target AI agent", "codex")
  .option("--scope <scope>", "installation scope: project or user", "project")
  .option("--project-root <path>", "project root for project scope", ".")
  .option("--yes", "confirm replacing the active installation")
  .option("--json", "print machine-readable output")
  .action(async (packageName: string, options: RollbackOptions) => {
    try {
      if (!options.yes) {
        throw new CliError(
          "ROLLBACK_CONFIRMATION_REQUIRED",
          "Rollback requires explicit confirmation. Inspect the installation, then repeat with --yes.",
        );
      }
      const scope = parseSingleScope(options.scope);
      const result = await rollbackInstallation({
        package: packageName,
        adapter: resolveAdapter(options.agent),
        scope,
        context: {
          projectRoot: path.resolve(options.projectRoot),
          userHome: homedir(),
        },
      });
      if (options.json) {
        printJson({ ok: true, ...result });
      } else {
        console.log(`Rolled back ${result.package}: ${result.fromVersion} -> ${result.toVersion}`);
        console.log(`Agent: ${result.agent} (${result.scope})`);
        console.log(`Destination: ${result.destination}`);
        console.log(`Digest: ${result.fromDigest} -> ${result.toDigest}`);
        console.log(`Lockfile: ${result.lockfilePath}`);
      }
    } catch (error) {
      handleError(error, options.json);
    }
  });

program
  .command("remove")
  .description("Remove a managed skill without deleting untracked local files.")
  .argument("<package>", "installed package name")
  .requiredOption("--agent <host>", "target AI agent (codex or claude-code)")
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
  .command("audit")
  .description("Audit local receipt integrity, drift, paths, recovery state, and static findings.")
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
        scopes.map((scope) => auditInstallations({ adapter, scope, context })),
      );
      const passed = results.every((result) => result.passed);
      if (options.json) {
        printJson({ ok: passed, audits: results });
      } else {
        printAuditResults(results);
      }
      if (!passed) process.exitCode = 1;
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

interface RegistrySearchOptions extends JsonOptions {
  registry: string;
  host?: string;
  scope?: string;
  cursor?: string;
  limit?: string;
}

interface RegistryInspectOptions extends JsonOptions {
  registry: string;
}

interface PublishOptions extends JsonOptions {
  namespace: string;
  registry?: string;
  idempotencyKey?: string;
  sourceRepository?: string;
  sourceCommit?: string;
}

interface AuthOptions extends JsonOptions {
  registry?: string;
}

interface AuthLoginOptions extends AuthOptions {
  clientId?: string;
  scope?: string[];
}

interface AuthRefreshOptions extends AuthOptions {
  clientId?: string;
}

interface AddOptions extends JsonOptions {
  agent: string;
  scope: InstallScope | string;
  projectRoot: string;
  registry?: string;
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

interface UpdateOptions extends JsonOptions {
  agent: string;
  scope: string;
  registry?: string;
  projectRoot: string;
  dryRun?: boolean;
  yes?: boolean;
}

interface RollbackOptions extends JsonOptions {
  agent: string;
  scope: string;
  projectRoot: string;
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

function printStaticScanResult(result: Awaited<ReturnType<typeof scanSkillDirectory>>): void {
  console.log(`${result.valid ? "SCAN COMPLETE" : "SCAN BLOCKED"} (${result.scannerVersion})`);
  console.log(`Completed: ${result.completedAt}`);
  if (result.findings.length === 0) {
    console.log("No observations.");
    return;
  }
  console.log(`Observations: ${result.findings.length}`);
  for (const finding of result.findings) printStaticFinding(finding);
}

function printStaticFinding(finding: StaticScanFinding): void {
  const location = finding.path ? ` ${finding.path}` : "";
  console.log(`${finding.severity.toUpperCase()} ${finding.ruleId}${location}`);
  console.log(`  ${finding.message}`);
  if (finding.evidence) console.log(`  Evidence: ${finding.evidence}`);
  console.log(`  Why: ${finding.explanation}`);
  console.log(`  Remediation: ${finding.remediation}`);
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

function printAuditResults(results: InstallationAuditResult[]): void {
  for (const [index, result] of results.entries()) {
    if (index > 0) console.log("");
    console.log(`${result.passed ? "PASS" : "ATTENTION"}: ${result.agent} ${result.scope} audit`);
    console.log(`Lockfile: ${result.lockfilePath}`);
    console.log(`Summary: ${result.summary.clean} clean, ${result.summary.drifted} drifted, ${result.summary.errors} errors, ${result.summary.warnings} warnings`);
    for (const installation of result.installations) {
      console.log(`${installation.package}@${installation.version}  ${installation.state.toUpperCase()}`);
      console.log(`  Artifact digest (recorded): ${installation.artifactIntegrity.digest}`);
      console.log(`  Installed receipt: ${installation.receiptIntegrity.status.toUpperCase()}`);
      console.log(`  Static scan: ${installation.scanner.status.toUpperCase()} (${installation.scanner.findings.length} findings)`);
      if (installation.scanner.reason) console.log(`  ${installation.scanner.reason}`);
      for (const finding of installation.findings) printAuditFinding(finding);
    }
    for (const finding of result.findings) printAuditFinding(finding);
    if (result.installations.length === 0 && result.findings.length === 0) {
      console.log("No managed skills or audit findings.");
    }
  }
}

function printAuditFinding(finding: InstallationAuditResult["findings"][number]): void {
  const location = finding.path ? ` ${finding.path}` : "";
  console.log(`  ${finding.severity.toUpperCase()} ${finding.code}${location}`);
  console.log(`    ${finding.message}`);
  if (finding.evidence) console.log(`    Evidence: ${finding.evidence}`);
  console.log(`    Remediation: ${finding.remediation}`);
}

function printUpdatePreviews(results: InstallationUpdatePreviewResult[]): void {
  if (results.length === 0) {
    console.log("No registry installations are available to update.");
    return;
  }
  for (const [index, result] of results.entries()) {
    if (index > 0) console.log("");
    const preview = result.preview;
    console.log(`Update preview ${preview.package}: ${preview.fromVersion} -> ${preview.toVersion}`);
    console.log(`Installation: ${result.installation.state.toUpperCase()} (${result.installation.destination})`);
    console.log(`Artifact: ${preview.fromDigest} -> ${preview.toDigest}`);
    printPaths("Files added", preview.files.added.map((file) => file.path));
    printPaths("Files removed", preview.files.removed.map((file) => file.path));
    printPaths("Files modified", preview.files.modified.map((file) => file.path));
    printPaths("Scripts added", preview.scripts.added);
    printPaths("Scripts removed", preview.scripts.removed);
    printPaths("Scripts modified", preview.scripts.modified);
    for (const change of preview.capabilities) {
      console.log(`Capability ${change.path}: ${formatChangeValue(change.before)} -> ${formatChangeValue(change.after)}`);
    }
    printPaths("Dependencies added", preview.dependencies.added);
    printPaths("Dependencies removed", preview.dependencies.removed);
    for (const change of preview.manifest) console.log(`Manifest changed: ${change.field}`);
    for (const finding of preview.findings.added) {
      console.log(`Finding added: ${finding.severity.toUpperCase()} ${finding.ruleId}${finding.path ? ` ${finding.path}` : ""}`);
    }
    for (const finding of preview.findings.resolved) {
      console.log(`Finding resolved: ${finding.ruleId}${finding.path ? ` ${finding.path}` : ""}`);
    }
    for (const finding of preview.findings.changed) {
      console.log(`Finding changed: ${finding.ruleId}${finding.path ? ` ${finding.path}` : ""} (${finding.before.severity} -> ${finding.after.severity})`);
    }
    if (!preview.changed) console.log("No update changes detected.");
  }
}

function printAppliedUpdates(results: InstallationUpdateResult[]): void {
  printUpdatePreviews(results);
  for (const result of results) {
    console.log(result.applied
      ? `Applied ${result.package}@${result.preview.toVersion} atomically. Rollback is available.`
      : `${result.package} is already current; no files or metadata changed.`);
    if (result.cleanupPending) {
      console.log(`Cleanup pending: ${result.cleanupPending}. Inspect with agentcargo doctor.`);
    }
  }
}

function printPaths(label: string, values: readonly string[]): void {
  if (values.length > 0) console.log(`${label}: ${values.join(", ")}`);
}

function formatChangeValue(value: unknown): string {
  return value === undefined ? "not declared" : JSON.stringify(value);
}

async function installRegistrySkill(
  reference: string,
  options: AddOptions,
  scope: InstallScope,
): Promise<Awaited<ReturnType<typeof installLocalSkill>> & { source: "registry" }> {
  const client = createRegistryClient(options.registry);
  const requested = parsePackageReference(reference);
  const coordinate = "version" in requested
    ? requested
    : await resolveLatestReleaseCoordinate(client, requested);
  const response = await client.getRelease(coordinate);
  const release = response.release;
  const compatibility = release.declared.compatibility[options.agent];
  if (!compatibility || !compatibility.scopes.includes(scope)) {
    throw new CliError(
      "REGISTRY_COMPATIBILITY_UNSUPPORTED",
      `Release ${formatReleaseCoordinate(release.coordinate)} does not declare compatibility with ${options.agent} ${scope}.`,
    );
  }

  const bytes = await client.downloadArtifact(release.artifact.download);
  if (bytes.byteLength !== release.artifact.bytes) {
    throw new CliError(
      "REGISTRY_ARTIFACT_SIZE_MISMATCH",
      `Downloaded artifact has ${bytes.byteLength} bytes; the registry declared ${release.artifact.bytes}.`,
    );
  }

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "agentcargo-registry-"));
  try {
    const artifactPath = path.join(temporaryRoot, `${release.coordinate.name}-${release.coordinate.version}.agentcargo`);
    const sourceRoot = path.join(temporaryRoot, release.coordinate.name);
    await writeFile(artifactPath, bytes, { flag: "wx" });
    await extractArtifact(artifactPath, sourceRoot, { expectedDigest: release.artifact.digest });

    const validation = await validateSkillDirectory(sourceRoot);
    if (validation.manifest && (validation.manifest.name !== release.coordinate.name || validation.manifest.version !== release.coordinate.version)) {
      throw new CliError(
        "REGISTRY_ARTIFACT_COORDINATE_MISMATCH",
        `Artifact metadata is ${validation.manifest.name}@${validation.manifest.version}, expected ${formatReleaseCoordinate(release.coordinate)}.`,
      );
    }

    const result = await installLocalSkill({
      sourcePath: sourceRoot,
      adapter: resolveAdapter(options.agent),
      scope,
      sourceType: "registry",
      packageIdentity: formatPackageCoordinate(release.coordinate),
      expectedDigest: release.artifact.digest,
      context: {
        userHome: homedir(),
        ...(scope === "project" ? { projectRoot: path.resolve(options.projectRoot) } : {}),
      },
    });
    return { ...result, source: "registry" };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function processRegistryUpdates(
  reference: string | undefined,
  options: UpdateOptions,
  scope: InstallScope,
  apply: boolean,
): Promise<Array<InstallationUpdatePreviewResult | InstallationUpdateResult>> {
  const adapter = resolveAdapter(options.agent);
  const context = {
    projectRoot: path.resolve(options.projectRoot),
    userHome: homedir(),
  };
  const installations = await listInstallations({ adapter, scope, context });
  const lockfile = await readLockfile(installations.lockfilePath);
  const scopedEntries = lockfile.packages.filter((entry) =>
    entry.agent === adapter.id && entry.scope === scope
  );
  let requestedVersion: string | undefined;
  let entries = scopedEntries.filter((entry) => entry.source.type === "registry");
  if (reference) {
    const requested = parsePackageReference(reference);
    const identity = formatPackageCoordinate(requested);
    requestedVersion = "version" in requested ? requested.version : undefined;
    const entry = scopedEntries.find((candidate) => candidate.package === identity);
    if (!entry) {
      throw new CliError(
        "UPDATE_NOT_INSTALLED",
        `${identity} is not installed for ${adapter.id} ${scope} scope.`,
      );
    }
    if (entry.source.type !== "registry") {
      throw new CliError(
        "UPDATE_SOURCE_UNSUPPORTED",
        `${identity} was installed from a local path and has no registry update source.`,
      );
    }
    entries = [entry];
  }

  for (const entry of entries) {
    if (!entry.package.startsWith("@")) {
      throw new CliError(
        "UPDATE_REGISTRY_COORDINATE_REQUIRED",
        `The registry installation '${entry.package}' predates scoped lockfile identities. Reinstall it with @namespace/name before updating.`,
      );
    }
  }

  const client = createRegistryClient(options.registry);
  const results: Array<InstallationUpdatePreviewResult | InstallationUpdateResult> = [];
  for (const entry of entries) {
    const installedCoordinate = parsePackageReference(entry.package);
    if ("version" in installedCoordinate) {
      throw new CliError("UPDATE_LOCKFILE_PACKAGE_INVALID", `Installed package identity must not contain a version: ${entry.package}.`);
    }
    const currentCoordinate = { ...installedCoordinate, version: entry.version };
    const currentRelease = (await client.getRelease(currentCoordinate)).release;
    const targetCoordinate = requestedVersion
      ? { ...installedCoordinate, version: requestedVersion }
      : await resolveLatestReleaseCoordinate(client, installedCoordinate);
    const targetRelease = targetCoordinate.version === currentCoordinate.version
      ? currentRelease
      : (await client.getRelease(targetCoordinate)).release;
    assertReleaseCompatibility(targetRelease, adapter.id, scope);

    const result = await withRegistryReleaseSource(client, targetRelease, async (sourceRoot) => {
      const updateInput = {
        package: entry.package,
        sourcePath: sourceRoot,
        expectedDigest: targetRelease.artifact.digest,
        adapter,
        scope,
        context,
        currentDeclared: currentRelease.declared,
        targetDeclared: targetRelease.declared,
        currentFindings: currentRelease.scan.findings,
        targetFindings: targetRelease.scan.findings,
      };
      return apply
        ? updateInstallation(updateInput)
        : previewInstallationUpdate(updateInput);
    });
    results.push(result);
  }
  return results;
}

async function withRegistryReleaseSource<T>(
  client: RegistryClient,
  release: RegistryRelease,
  action: (sourceRoot: string) => Promise<T>,
): Promise<T> {
  const bytes = await client.downloadArtifact(release.artifact.download);
  if (bytes.byteLength !== release.artifact.bytes) {
    throw new CliError(
      "REGISTRY_ARTIFACT_SIZE_MISMATCH",
      `Downloaded artifact has ${bytes.byteLength} bytes; the registry declared ${release.artifact.bytes}.`,
    );
  }
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "agentcargo-registry-update-"));
  try {
    const artifactPath = path.join(temporaryRoot, `${release.coordinate.name}-${release.coordinate.version}.agentcargo`);
    const sourceRoot = path.join(temporaryRoot, release.coordinate.name);
    await writeFile(artifactPath, bytes, { flag: "wx" });
    await extractArtifact(artifactPath, sourceRoot, { expectedDigest: release.artifact.digest });
    const validation = await validateSkillDirectory(sourceRoot);
    if (
      !validation.valid
      || !validation.manifest
      || validation.manifest.name !== release.coordinate.name
      || validation.manifest.version !== release.coordinate.version
    ) {
      throw new CliError(
        "REGISTRY_ARTIFACT_COORDINATE_MISMATCH",
        `Artifact metadata does not match ${formatReleaseCoordinate(release.coordinate)}.`,
      );
    }
    return await action(sourceRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function assertReleaseCompatibility(
  release: RegistryRelease,
  agent: string,
  scope: InstallScope,
): void {
  const compatibility = release.declared.compatibility[agent];
  if (!compatibility || !compatibility.scopes.includes(scope)) {
    throw new CliError(
      "REGISTRY_COMPATIBILITY_UNSUPPORTED",
      `Release ${formatReleaseCoordinate(release.coordinate)} does not declare compatibility with ${agent} ${scope}.`,
    );
  }
}

interface PublishResult {
  releaseId: string;
  coordinate: { namespace: string; name: string; version: string };
  status: "scanning";
  digest: string;
  bytes: number;
  idempotencyKey: string;
}

async function publishLocalSkill(
  inputPath: string,
  options: PublishOptions,
  credential: { accessToken: string },
  registry: string,
): Promise<PublishResult> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.namespace) || options.namespace.length > 64) {
    throw new CliError("PUBLISH_NAMESPACE_INVALID", "Namespace must use lowercase letters, numbers, and single hyphens.");
  }
  const root = path.resolve(inputPath);
  const validation = await validateSkillDirectory(root);
  if (!validation.valid || !validation.manifest) {
    throw new CliError("PUBLISH_VALIDATION_FAILED", "Skill validation must pass before publication.");
  }
  const scan = await scanSkillDirectory(root);
  if (!scan.valid) {
    throw new CliError("PUBLISH_SCAN_BLOCKED", "Static scanning found blocking package errors.");
  }
  const inventory = await inventoryRegularTree(root);
  const files = inventory.files.map((file) => ({
    path: file.path,
    bytes: file.bytes,
    executable: file.mode === 0o755,
    scriptLike: file.mode === 0o755 || /\.(?:bash|bat|cjs|cmd|fish|js|mjs|php|pl|ps1|py|rb|sh|ts|zsh)$/i.test(file.path),
  }));
  const manifest = validation.manifest;
  const declared = {
    description: manifest.description,
    ...(manifest.license ? { license: manifest.license } : {}),
    ...(manifest.repository ? { repositoryUrl: manifest.repository } : {}),
    tags: manifest.tags ?? [],
    compatibility: manifest.compatibility ?? {},
    ...(manifest.capabilities ? { capabilities: manifest.capabilities as Readonly<Record<string, unknown>> } : {}),
    ...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}),
  };
  const sourceRepository = options.sourceRepository ?? manifest.repository;
  if (sourceRepository !== undefined && (!/^https:\/\//.test(sourceRepository) || sourceRepository.length > 2048)) {
    throw new CliError("PUBLISH_SOURCE_INVALID", "Source repository must be an HTTPS URL.");
  }
  const source = {
    ...(sourceRepository ? { repositoryUrl: sourceRepository } : {}),
    ...(options.sourceCommit ? { commit: options.sourceCommit } : {}),
  };
  const completionBase: Omit<RegistryReleaseCompletionRequest, "artifact"> = {
    declared,
    files,
    scan: { scannerVersion: scan.scannerVersion, completedAt: scan.completedAt, findings: scan.findings },
    source,
  };
  const idempotencyKey = options.idempotencyKey ?? randomUUID();
  if (!/^[\u0021-\u007e]{1,128}$/.test(idempotencyKey)) {
    throw new CliError("PUBLISH_IDEMPOTENCY_INVALID", "Idempotency key must be 1-128 printable characters.");
  }

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "agentcargo-publish-"));
  try {
    const artifactPath = path.join(temporaryRoot, `${manifest.name}-${manifest.version}.agentcargo`);
    const packed = await packSkillDirectory(root, artifactPath);
    const bytes = await readFile(packed.artifactPath);
    const client = createRegistryClient(registry);
    const coordinate = { namespace: options.namespace, name: manifest.name, version: manifest.version };
    const reservation = await client.reserveRelease(coordinate, { version: manifest.version, idempotencyKey }, credential);
    if (
      reservation.coordinate.namespace !== coordinate.namespace ||
      reservation.coordinate.name !== coordinate.name ||
      reservation.coordinate.version !== coordinate.version
    ) {
      throw new CliError(
        "PUBLISH_RESERVATION_MISMATCH",
        `The registry reserved ${formatReleaseCoordinate(reservation.coordinate)}, expected ${formatReleaseCoordinate(coordinate)}.`,
      );
    }
    const upload = await client.createArtifactUpload(reservation.releaseId, { digest: packed.digest as `sha256:${string}`, bytes: bytes.byteLength }, credential);
    if (upload.digest !== packed.digest || upload.bytes !== bytes.byteLength) {
      throw new CliError("REGISTRY_UPLOAD_METADATA_MISMATCH", "The registry returned upload metadata that does not match the local artifact.");
    }
    await client.uploadArtifact(upload.uploadUrl, bytes, { digest: packed.digest as `sha256:${string}` });
    const completion = await client.completeRelease(reservation.releaseId, {
      artifact: {
        format: packed.format,
        mediaType: AGENTCARGO_ARTIFACT_MEDIA_TYPE,
        digest: packed.digest as `sha256:${string}`,
        bytes: bytes.byteLength,
      },
      ...completionBase,
    }, credential);
    return {
      releaseId: completion.releaseId,
      coordinate: completion.coordinate,
      status: completion.status,
      digest: completion.artifact.digest,
      bytes: completion.artifact.bytes,
      idempotencyKey,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function resolveLatestReleaseCoordinate(
  client: RegistryClient,
  coordinate: { namespace: string; name: string },
): Promise<{ namespace: string; name: string; version: string }> {
  const summary = await client.getPackage(coordinate);
  if (!summary.latestVersion) {
    throw new CliError(
      "REGISTRY_LATEST_VERSION_MISSING",
      `Package ${formatPackageCoordinate(coordinate)} does not have an active release.`,
    );
  }
  return { ...coordinate, version: summary.latestVersion };
}

function resolveAdapter(agent: string): HostAdapter {
  if (agent === "codex") return new CodexAdapter();
  if (agent === "claude-code") return new ClaudeCodeAdapter();
  throw new CliError(
    "HOST_UNSUPPORTED",
    `Host '${agent}' is not supported. Supported hosts: codex, claude-code.`,
  );
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
    error instanceof AgentCargoRollbackStateError ||
    error instanceof AgentCargoUpdateError ||
    error instanceof AgentCargoUpdatePreviewError ||
    error instanceof AgentCargoAdapterError ||
    error instanceof RegistryClientError ||
    error instanceof RegistryCredentialStoreError ||
    error instanceof GitHubOAuthError
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

function createRegistryClient(registry: string | undefined): RegistryClient {
  return new RegistryClient({ baseUrl: requireRegistryUrl(registry) });
}

function requireRegistryUrl(registry: string | undefined): string {
  const baseUrl = registry ?? process.env.AGENTCARGO_REGISTRY_URL;
  if (!baseUrl) {
    throw new CliError(
      "REGISTRY_URL_REQUIRED",
      "A registry URL is required. Pass --registry or set AGENTCARGO_REGISTRY_URL.",
    );
  }
  return baseUrl;
}

async function requirePublishCredential(registry: string): Promise<{ accessToken: string }> {
  const credential = await new FileRegistryCredentialStore().get(registry);
  if (!credential || (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now())) {
    throw new CliError(
      "AUTH_NOT_AUTHENTICATED",
      `No active registry credential exists for ${registry}. Run agentcargo auth login or auth refresh first.`,
    );
  }
  return { accessToken: credential.accessToken };
}

function requireGitHubClientId(clientId: string | undefined): string {
  const value = clientId ?? process.env.AGENTCARGO_GITHUB_CLIENT_ID;
  if (!value) throw new CliError("GITHUB_CLIENT_ID_REQUIRED", "A GitHub OAuth client ID is required. Pass --client-id or set AGENTCARGO_GITHUB_CLIENT_ID.");
  return value;
}

function ensureInteractiveAuthAllowed(): void {
  if (process.env.CI === "true" || process.env.CI === "1") {
    throw new CliError("AUTH_INTERACTIVE_DISABLED", "GitHub device login is interactive and is disabled in CI.");
  }
}

function printAuthStatus(status: Awaited<ReturnType<FileRegistryCredentialStore["getStatus"]>>): void {
  if (!status.authenticated) {
    console.log(`Not authenticated: ${status.registry}`);
    if (status.expired) console.log(`Credential expired: ${status.expiresAt}`);
  } else {
    console.log(`Authenticated: ${status.registry}`);
    if (status.provider) console.log(`Provider: ${status.provider}`);
    if (status.expiresAt) console.log(`Expires: ${status.expiresAt}`);
  }
  console.log(`Refresh available: ${status.refreshable ? "yes" : "no"}`);
  if (status.refreshTokenExpired) console.log(`Refresh credential expired: ${status.refreshTokenExpiresAt}`);
}

function parseRegistryLimit(value: string): number {
  if (!/^\d+$/.test(value)) throw new CliError("REGISTRY_LIMIT_INVALID", "Registry limit must be an integer from 1 to 100.");
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new CliError("REGISTRY_LIMIT_INVALID", "Registry limit must be an integer from 1 to 100.");
  }
  return limit;
}

type PackageReference =
  | { namespace: string; name: string }
  | { namespace: string; name: string; version: string };

function parsePackageReference(value: string): PackageReference {
  const match = /^@([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:@([^@/]+))?$/.exec(value);
  if (!match) {
    throw new CliError("REGISTRY_PACKAGE_REFERENCE_INVALID", "Package reference must be @namespace/name or @namespace/name@version.");
  }
  const coordinate = { namespace: match[1]!, name: match[2]! };
  return match[3] ? { ...coordinate, version: match[3] } : coordinate;
}

function printRegistrySearch(response: RegistrySearchResponse): void {
  if (response.items.length === 0) {
    console.log("No packages found.");
    return;
  }
  console.log(`Found ${response.items.length} package${response.items.length === 1 ? "" : "s"}`);
  for (const item of response.items) {
    const version = item.latestVersion ? `@${item.latestVersion}` : "";
    console.log(`${formatPackageCoordinate(item.package)}${version}  ${item.description}`);
    console.log(`  Hosts: ${formatCompatibility(item)}`);
  }
  if (response.nextCursor) console.log(`Next cursor: ${response.nextCursor}`);
}

function printRegistryPackage(summary: RegistryPackageSummary): void {
  console.log(`Package ${formatPackageCoordinate(summary.package)}`);
  console.log(`Description: ${summary.description}`);
  if (summary.latestVersion) console.log(`Latest: ${summary.latestVersion}`);
  console.log(`Status: ${summary.status}`);
  console.log(`Hosts: ${formatCompatibility(summary)}`);
  console.log(`Tags: ${summary.tags.length > 0 ? summary.tags.join(", ") : "none"}`);
  console.log(`Scripts: ${summary.hasScripts ? "present" : "none observed"}`);
}

function printRegistryRelease(release: RegistryRelease): void {
  console.log(`Release ${formatReleaseCoordinate(release.coordinate)}`);
  console.log(`Description: ${release.declared.description}`);
  console.log(`Status: ${release.status}`);
  console.log(`Published: ${release.publishedAt}`);
  console.log(`Digest: ${release.artifact.digest}`);
  console.log(`Artifact bytes: ${release.artifact.bytes}`);
  console.log(`Files: ${release.files.length}`);
  console.log(`Hosts: ${formatCompatibility(release.declared)}`);
  console.log(`Tags: ${release.declared.tags.length > 0 ? release.declared.tags.join(", ") : "none"}`);
  console.log(`Findings: ${release.scan.findings.length}`);
  if (release.source.repositoryUrl) console.log(`Source: ${release.source.repositoryUrl}`);
}

function formatCompatibility(value: { compatibility: Readonly<Record<string, { scopes: readonly InstallScope[] }>> }): string {
  const hosts = Object.entries(value.compatibility);
  return hosts.length === 0 ? "none declared" : hosts.map(([host, declaration]) => `${host} (${declaration.scopes.join(", ")})`).join(", ");
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
