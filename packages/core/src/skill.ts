import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import type {
  AgentCargoCapabilities,
  AgentCargoHostCompatibility,
  AgentCargoManifest,
  Finding,
  SkillTemplate,
  SkillValidationResult,
} from "./types.js";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_COMPATIBILITY_LENGTH = 500;
const MAX_FILE_COUNT = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

interface ParsedSkillMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
  lineCount: number;
}

interface FileInventory {
  files: string[];
  totalBytes: number;
  findings: Finding[];
}

export function normalizeSkillName(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_SKILL_NAME_LENGTH)
    .replace(/-+$/g, "");
}

export function createSkillTemplate(
  nameInput: string,
  descriptionInput?: string,
): SkillTemplate {
  const name = normalizeSkillName(nameInput);
  if (!name || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error("The directory name cannot be converted into a valid skill name.");
  }

  const description =
    descriptionInput?.trim() ||
    `Explain what ${name} does and when an AI agent should use it.`;

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }

  const frontmatter = stringify({ name, description }, { lineWidth: 0 }).trimEnd();

  const skillMarkdown = `---
${frontmatter}
---

# ${toTitleCase(name)}

## Instructions

Describe the workflow the AI agent should follow.
`;

  const manifest: AgentCargoManifest = {
    schema_version: 1,
    name,
    version: "0.1.0",
    description,
    compatibility: {
      codex: {
        scopes: ["project", "user"],
      },
      "claude-code": {
        scopes: ["project", "user"],
      },
    },
    capabilities: {
      filesystem: {
        read: true,
        write: false,
      },
      shell: false,
      network: false,
      environment: [],
    },
    dependencies: [],
    tags: [],
  };

  return {
    name,
    description,
    skillMarkdown,
    manifestYaml: stringify(manifest, { lineWidth: 0 }),
  };
}

export async function validateSkillDirectory(
  inputPath: string,
): Promise<SkillValidationResult> {
  const root = path.resolve(inputPath);
  const findings: Finding[] = [];
  let inventory: FileInventory = { files: [], totalBytes: 0, findings: [] };

  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch {
    return buildResult(root, inventory, [
      finding("SKILL_DIRECTORY_NOT_FOUND", "error", "Skill directory does not exist."),
    ]);
  }

  if (!rootStat.isDirectory()) {
    return buildResult(root, inventory, [
      finding("SKILL_PATH_NOT_DIRECTORY", "error", "Skill path must be a directory."),
    ]);
  }

  inventory = await inventoryFiles(root);
  findings.push(...inventory.findings);

  const skillMarkdownPath = path.join(root, "SKILL.md");
  let parsedSkill: ParsedSkillMarkdown | undefined;

  try {
    const contents = await readFile(skillMarkdownPath, "utf8");
    parsedSkill = parseSkillMarkdown(contents);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      findings.push(
        finding("SKILL_MD_MISSING", "error", "A root SKILL.md file is required.", "SKILL.md"),
      );
    } else {
      findings.push(
        finding(
          "SKILL_MD_INVALID",
          "error",
          error instanceof Error ? error.message : "SKILL.md could not be parsed.",
          "SKILL.md",
        ),
      );
    }
  }

  let skillName: string | undefined;
  if (parsedSkill) {
    skillName = validateSkillFrontmatter(root, parsedSkill, findings);
  }

  const manifest = await validateAgentCargoManifest(root, skillName, findings);

  return buildResult(root, inventory, findings, skillName, manifest);
}

function parseSkillMarkdown(contents: string): ParsedSkillMarkdown {
  const normalized = contents.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines[0]?.trim() !== "---") {
    throw new Error("SKILL.md must begin with YAML frontmatter delimited by ---. ");
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    throw new Error("SKILL.md frontmatter is missing its closing --- delimiter.");
  }

  const source = lines.slice(1, closingIndex).join("\n");
  const parsed = parse(source, { maxAliasCount: 20 });
  if (!isRecord(parsed)) {
    throw new Error("SKILL.md frontmatter must be a YAML object.");
  }

  return {
    frontmatter: parsed,
    body: lines.slice(closingIndex + 1).join("\n").trim(),
    lineCount: lines.length,
  };
}

function validateSkillFrontmatter(
  root: string,
  parsed: ParsedSkillMarkdown,
  findings: Finding[],
): string | undefined {
  const { frontmatter } = parsed;
  const name = readString(frontmatter, "name");
  const description = readString(frontmatter, "description");

  if (!name) {
    findings.push(finding("SKILL_NAME_MISSING", "error", "Frontmatter name is required.", "SKILL.md"));
  } else {
    if (name.length > MAX_SKILL_NAME_LENGTH || !SKILL_NAME_PATTERN.test(name)) {
      findings.push(
        finding(
          "SKILL_NAME_INVALID",
          "error",
          "Skill name must be 1-64 characters using lowercase letters, numbers, and single hyphens.",
          "SKILL.md",
        ),
      );
    }

    if (path.basename(root) !== name) {
      findings.push(
        finding(
          "SKILL_DIRECTORY_NAME_MISMATCH",
          "error",
          `Skill name '${name}' must match its parent directory '${path.basename(root)}'.`,
          "SKILL.md",
        ),
      );
    }
  }

  if (!description) {
    findings.push(
      finding("SKILL_DESCRIPTION_MISSING", "error", "Frontmatter description is required.", "SKILL.md"),
    );
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    findings.push(
      finding(
        "SKILL_DESCRIPTION_TOO_LONG",
        "error",
        `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
        "SKILL.md",
      ),
    );
  }

  const compatibility = frontmatter.compatibility;
  if (
    compatibility !== undefined &&
    (typeof compatibility !== "string" ||
      compatibility.length === 0 ||
      compatibility.length > MAX_COMPATIBILITY_LENGTH)
  ) {
    findings.push(
      finding(
        "SKILL_COMPATIBILITY_INVALID",
        "error",
        `Compatibility must be a non-empty string up to ${MAX_COMPATIBILITY_LENGTH} characters.`,
        "SKILL.md",
      ),
    );
  }

  if (frontmatter.metadata !== undefined) {
    if (!isRecord(frontmatter.metadata)) {
      findings.push(
        finding("SKILL_METADATA_INVALID", "error", "Metadata must be a string-to-string map.", "SKILL.md"),
      );
    } else if (Object.values(frontmatter.metadata).some((value) => typeof value !== "string")) {
      findings.push(
        finding(
          "SKILL_METADATA_VALUE_INVALID",
          "error",
          "Every metadata value must be a string.",
          "SKILL.md",
        ),
      );
    }
  }

  if (frontmatter["allowed-tools"] !== undefined && typeof frontmatter["allowed-tools"] !== "string") {
    findings.push(
      finding("SKILL_ALLOWED_TOOLS_INVALID", "error", "allowed-tools must be a string.", "SKILL.md"),
    );
  }

  if (!parsed.body) {
    findings.push(
      finding("SKILL_BODY_EMPTY", "warning", "SKILL.md has no instruction body.", "SKILL.md"),
    );
  }

  if (parsed.lineCount > 500) {
    findings.push(
      finding(
        "SKILL_MD_LONG",
        "warning",
        "SKILL.md exceeds the Agent Skills recommendation of 500 lines.",
        "SKILL.md",
      ),
    );
  }

  return name;
}

async function validateAgentCargoManifest(
  root: string,
  skillName: string | undefined,
  findings: Finding[],
): Promise<AgentCargoManifest | undefined> {
  const manifestPath = path.join(root, "agentcargo.yaml");
  let value: unknown;

  try {
    value = parse(await readFile(manifestPath, "utf8"), { maxAliasCount: 20 });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      findings.push(
        finding(
          "AGENTCARGO_MANIFEST_MISSING",
          "warning",
          "agentcargo.yaml is required for publishing but not for native skill use.",
          "agentcargo.yaml",
        ),
      );
      return undefined;
    }

    findings.push(
      finding(
        "AGENTCARGO_MANIFEST_INVALID_YAML",
        "error",
        error instanceof Error ? error.message : "agentcargo.yaml contains invalid YAML.",
        "agentcargo.yaml",
      ),
    );
    return undefined;
  }

  if (!isRecord(value)) {
    findings.push(
      finding("AGENTCARGO_MANIFEST_INVALID", "error", "Manifest must be a YAML object.", "agentcargo.yaml"),
    );
    return undefined;
  }

  const schemaVersion = value.schema_version;
  const name = readString(value, "name");
  const version = readString(value, "version");
  const description = readString(value, "description");

  if (schemaVersion !== 1) {
    findings.push(
      finding(
        "AGENTCARGO_SCHEMA_VERSION_UNSUPPORTED",
        "error",
        "schema_version must be 1.",
        "agentcargo.yaml",
      ),
    );
  }

  if (!name || !SKILL_NAME_PATTERN.test(name) || name.length > MAX_SKILL_NAME_LENGTH) {
    findings.push(
      finding("AGENTCARGO_NAME_INVALID", "error", "Manifest name is invalid.", "agentcargo.yaml"),
    );
  } else if (skillName && name !== skillName) {
    findings.push(
      finding(
        "AGENTCARGO_SKILL_NAME_MISMATCH",
        "error",
        `Manifest name '${name}' does not match SKILL.md name '${skillName}'.`,
        "agentcargo.yaml",
      ),
    );
  }

  if (!version || !SEMVER_PATTERN.test(version)) {
    findings.push(
      finding(
        "AGENTCARGO_VERSION_INVALID",
        "error",
        "Manifest version must be a valid semantic version such as 1.0.0.",
        "agentcargo.yaml",
      ),
    );
  }

  if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
    findings.push(
      finding(
        "AGENTCARGO_DESCRIPTION_INVALID",
        "error",
        `Manifest description must be 1-${MAX_DESCRIPTION_LENGTH} characters.`,
        "agentcargo.yaml",
      ),
    );
  }

  const compatibility = validateCompatibility(value.compatibility, findings);
  const capabilities = validateCapabilities(value.capabilities, findings);
  const dependencies = validateDependencies(value.dependencies, findings);
  const tags = validateStringArray(value.tags, "tags", findings);

  if (findings.some((item) => item.severity === "error" && item.path === "agentcargo.yaml")) {
    return undefined;
  }

  const manifest: AgentCargoManifest = {
    schema_version: 1,
    name: name!,
    version: version!,
    description: description!,
  };

  const license = readString(value, "license");
  const repository = readString(value, "repository");
  if (license) manifest.license = license;
  if (repository) manifest.repository = repository;
  if (compatibility) manifest.compatibility = compatibility;
  if (capabilities) manifest.capabilities = capabilities;
  if (dependencies) manifest.dependencies = dependencies;
  if (tags) manifest.tags = tags;

  return manifest;
}

function validateDependencies(
  value: unknown,
  findings: Finding[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value)
    || value.length > 64
    || value.some((entry) =>
      typeof entry !== "string"
      || entry.length === 0
      || entry.length > 128
      || /[\u0000-\u001f\u007f]/.test(entry)
    )
    || new Set(value).size !== value.length
  ) {
    findings.push(
      finding(
        "AGENTCARGO_DEPENDENCIES_INVALID",
        "error",
        "dependencies must be a unique array of at most 64 printable strings, each at most 128 characters.",
        "agentcargo.yaml",
      ),
    );
    return undefined;
  }
  return [...value];
}

function validateCompatibility(
  value: unknown,
  findings: Finding[],
): Record<string, AgentCargoHostCompatibility> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    findings.push(
      finding(
        "AGENTCARGO_COMPATIBILITY_INVALID",
        "error",
        "compatibility must be a map of host identifiers.",
        "agentcargo.yaml",
      ),
    );
    return undefined;
  }

  const result: Record<string, AgentCargoHostCompatibility> = {};
  for (const [host, settings] of Object.entries(value)) {
    if (!SKILL_NAME_PATTERN.test(host) || !isRecord(settings)) {
      findings.push(
        finding(
          "AGENTCARGO_HOST_INVALID",
          "error",
          `Compatibility entry '${host}' is invalid.`,
          "agentcargo.yaml",
        ),
      );
      continue;
    }

    const scopes = settings.scopes;
    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      scopes.some((scope) => scope !== "project" && scope !== "user")
    ) {
      findings.push(
        finding(
          "AGENTCARGO_SCOPES_INVALID",
          "error",
          `Host '${host}' scopes must contain project and/or user.`,
          "agentcargo.yaml",
        ),
      );
      continue;
    }

    result[host] = { scopes: [...new Set(scopes)] as Array<"project" | "user"> };
  }

  return result;
}

function validateCapabilities(
  value: unknown,
  findings: Finding[],
): AgentCargoCapabilities | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    findings.push(
      finding(
        "AGENTCARGO_CAPABILITIES_INVALID",
        "error",
        "capabilities must be a map.",
        "agentcargo.yaml",
      ),
    );
    return undefined;
  }

  const result: AgentCargoCapabilities = {};
  if (value.filesystem !== undefined) {
    if (!isRecord(value.filesystem)) {
      findings.push(
        finding(
          "AGENTCARGO_FILESYSTEM_CAPABILITY_INVALID",
          "error",
          "capabilities.filesystem must be a map.",
          "agentcargo.yaml",
        ),
      );
    } else {
      const read = optionalBoolean(value.filesystem.read);
      const write = optionalBoolean(value.filesystem.write);
      if (read === null || write === null) {
        findings.push(
          finding(
            "AGENTCARGO_FILESYSTEM_FLAG_INVALID",
            "error",
            "Filesystem read/write declarations must be booleans.",
            "agentcargo.yaml",
          ),
        );
      } else {
        result.filesystem = {};
        if (read !== undefined) result.filesystem.read = read;
        if (write !== undefined) result.filesystem.write = write;
      }
    }
  }

  for (const key of ["shell", "network"] as const) {
    const parsed = optionalBoolean(value[key]);
    if (parsed === null) {
      findings.push(
        finding(
          "AGENTCARGO_CAPABILITY_FLAG_INVALID",
          "error",
          `capabilities.${key} must be a boolean.`,
          "agentcargo.yaml",
        ),
      );
    } else if (parsed !== undefined) {
      result[key] = parsed;
    }
  }

  const environment = validateStringArray(value.environment, "capabilities.environment", findings);
  if (environment) result.environment = environment;

  return result;
}

function validateStringArray(
  value: unknown,
  fieldName: string,
  findings: Finding[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    findings.push(
      finding(
        "AGENTCARGO_STRING_ARRAY_INVALID",
        "error",
        `${fieldName} must be an array of strings.`,
        "agentcargo.yaml",
      ),
    );
    return undefined;
  }
  return [...new Set(value)];
}

async function inventoryFiles(root: string): Promise<FileInventory> {
  const files: string[] = [];
  const findings: Finding[] = [];
  let totalBytes = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      const stat = await lstat(absolutePath);

      if (stat.isSymbolicLink()) {
        findings.push(
          finding(
            "PACKAGE_SYMLINK_UNSUPPORTED",
            "error",
            "Symlinks are not supported in AgentCargo MVP packages.",
            relativePath,
          ),
        );
        continue;
      }

      if (stat.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (!stat.isFile()) {
        findings.push(
          finding("PACKAGE_SPECIAL_FILE", "error", "Special files are not supported.", relativePath),
        );
        continue;
      }

      files.push(relativePath);
      totalBytes += stat.size;

      if (stat.size > MAX_FILE_BYTES) {
        findings.push(
          finding(
            "PACKAGE_FILE_TOO_LARGE",
            "error",
            `File exceeds the ${MAX_FILE_BYTES} byte MVP limit.`,
            relativePath,
          ),
        );
      }

      if (relativePath.startsWith("scripts/")) {
        findings.push(
          finding(
            "PACKAGE_SCRIPT_PRESENT",
            "info",
            "Package contains a script. Scripts are never executed during validation.",
            relativePath,
          ),
        );
      }
    }
  }

  try {
    await visit(root);
  } catch (error) {
    findings.push(
      finding(
        "PACKAGE_INVENTORY_FAILED",
        "error",
        error instanceof Error ? error.message : "Could not inspect package files.",
      ),
    );
  }

  if (files.length > MAX_FILE_COUNT) {
    findings.push(
      finding(
        "PACKAGE_TOO_MANY_FILES",
        "error",
        `Package contains ${files.length} files; the MVP limit is ${MAX_FILE_COUNT}.`,
      ),
    );
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    findings.push(
      finding(
        "PACKAGE_TOO_LARGE",
        "error",
        `Package expands to ${totalBytes} bytes; the MVP limit is ${MAX_TOTAL_BYTES}.`,
      ),
    );
  }

  return { files, totalBytes, findings };
}

function buildResult(
  root: string,
  inventory: FileInventory,
  findings: Finding[],
  skillName?: string,
  manifest?: AgentCargoManifest,
): SkillValidationResult {
  const result: SkillValidationResult = {
    valid: !findings.some((item) => item.severity === "error"),
    root,
    files: inventory.files,
    totalBytes: inventory.totalBytes,
    findings,
  };
  if (skillName) result.skillName = skillName;
  if (manifest) result.manifest = manifest;
  return result;
}

function finding(
  code: string,
  severity: Finding["severity"],
  message: string,
  findingPath?: string,
): Finding {
  const result: Finding = { code, severity, message };
  if (findingPath) result.path = findingPath;
  return result;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function toTitleCase(name: string): string {
  return name
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
