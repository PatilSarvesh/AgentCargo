import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import type {
  AgentCargoLockEntry,
  AgentCargoLockfile,
  InstalledFileRecord,
} from "./types.js";
import { normalizeArtifactPath } from "./archive.js";

const MAX_LOCKFILE_BYTES = 1024 * 1024;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PACKAGE_COORDINATE_PATTERN = /^@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class AgentCargoLockfileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentCargoLockfileError";
  }
}

export function emptyLockfile(): AgentCargoLockfile {
  return { lockfile_version: 1, packages: [] };
}

export async function readLockfile(lockfilePath: string): Promise<AgentCargoLockfile> {
  const resolved = path.resolve(lockfilePath);
  let fileStat: Awaited<ReturnType<typeof lstat>>;
  try {
    fileStat = await lstat(resolved);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return emptyLockfile();
    throw error;
  }

  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_NOT_REGULAR_FILE",
      `Lockfile must be a regular file: ${resolved}`,
    );
  }
  if (fileStat.size > MAX_LOCKFILE_BYTES) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_TOO_LARGE",
      `Lockfile exceeds the ${MAX_LOCKFILE_BYTES} byte limit.`,
    );
  }

  const handle = await open(resolved, "r");
  let contents: string;
  try {
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.dev !== fileStat.dev ||
      openedStat.ino !== fileStat.ino ||
      openedStat.size !== fileStat.size ||
      openedStat.mtimeMs !== fileStat.mtimeMs ||
      openedStat.ctimeMs !== fileStat.ctimeMs
    ) {
      throw new AgentCargoLockfileError(
        "LOCKFILE_CHANGED_DURING_READ",
        "Lockfile changed while it was being opened.",
      );
    }
    contents = await handle.readFile("utf8");
    const afterReadStat = await handle.stat();
    if (
      afterReadStat.size !== openedStat.size ||
      afterReadStat.mtimeMs !== openedStat.mtimeMs ||
      afterReadStat.ctimeMs !== openedStat.ctimeMs
    ) {
      throw new AgentCargoLockfileError(
        "LOCKFILE_CHANGED_DURING_READ",
        "Lockfile changed while it was being read.",
      );
    }
  } finally {
    await handle.close();
  }

  let parsed: unknown;
  try {
    parsed = parse(contents, { maxAliasCount: 20 });
  } catch (error) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_INVALID_YAML",
      error instanceof Error ? error.message : "Lockfile contains invalid YAML.",
    );
  }
  return validateLockfile(parsed);
}

export async function writeLockfileAtomic(
  lockfilePath: string,
  lockfile: AgentCargoLockfile,
): Promise<void> {
  const validated = validateLockfile(lockfile);
  const resolved = path.resolve(lockfilePath);
  const parent = path.dirname(resolved);
  await mkdir(parent, { recursive: true });

  const temporaryPath = path.join(
    parent,
    `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const contents = stringify(validated, { lineWidth: 0, sortMapEntries: false });
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, resolved);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function validateLockfile(value: unknown): AgentCargoLockfile {
  const root = expectRecord(value, "LOCKFILE_INVALID", "Lockfile must be a YAML object.");
  expectExactKeys(root, ["lockfile_version", "packages"], "LOCKFILE_UNKNOWN_FIELD");
  if (root.lockfile_version !== 1) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_VERSION_UNSUPPORTED",
      "lockfile_version must be 1.",
    );
  }
  if (!Array.isArray(root.packages)) {
    throw new AgentCargoLockfileError("LOCKFILE_PACKAGES_INVALID", "packages must be an array.");
  }

  const packages = root.packages.map((entry, index) => validateEntry(entry, index));
  const identities = new Set<string>();
  for (const entry of packages) {
    const identity = `${entry.agent}\0${entry.scope}\0${entry.package}`;
    if (identities.has(identity)) {
      throw new AgentCargoLockfileError(
        "LOCKFILE_PACKAGE_DUPLICATE",
        `Lockfile contains a duplicate installation for ${entry.package}.`,
      );
    }
    identities.add(identity);
  }

  packages.sort(compareLockEntries);
  return { lockfile_version: 1, packages };
}

function validateEntry(value: unknown, index: number): AgentCargoLockEntry {
  const label = `packages[${index}]`;
  const entry = expectRecord(value, "LOCKFILE_ENTRY_INVALID", `${label} must be an object.`);
  expectExactKeys(
    entry,
    [
      "package",
      "version",
      "digest",
      "agent",
      "adapter_version",
      "scope",
      "destination",
      "installed_at",
      "files_digest",
      "files",
      "source",
    ],
    "LOCKFILE_ENTRY_UNKNOWN_FIELD",
  );

  const packageName = expectString(entry.package, "LOCKFILE_PACKAGE_INVALID", `${label}.package`);
  if (
    (!SKILL_NAME_PATTERN.test(packageName) && !PACKAGE_COORDINATE_PATTERN.test(packageName)) ||
    packageName.length > 130
  ) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_PACKAGE_INVALID",
      `${label}.package must be a local skill name or scoped package coordinate.`,
    );
  }

  const version = expectString(entry.version, "LOCKFILE_VERSION_INVALID", `${label}.version`);
  if (!SEMVER_PATTERN.test(version)) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_VERSION_INVALID",
      `${label}.version must be semantic versioning.`,
    );
  }

  const digest = validateDigest(entry.digest, `${label}.digest`);
  const agent = expectString(entry.agent, "LOCKFILE_AGENT_INVALID", `${label}.agent`);
  if (!SKILL_NAME_PATTERN.test(agent)) {
    throw new AgentCargoLockfileError("LOCKFILE_AGENT_INVALID", `${label}.agent is invalid.`);
  }
  const adapterVersion = expectString(
    entry.adapter_version,
    "LOCKFILE_ADAPTER_VERSION_INVALID",
    `${label}.adapter_version`,
  );
  if (!SEMVER_PATTERN.test(adapterVersion)) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_ADAPTER_VERSION_INVALID",
      `${label}.adapter_version must be semantic versioning.`,
    );
  }

  if (entry.scope !== "project" && entry.scope !== "user") {
    throw new AgentCargoLockfileError(
      "LOCKFILE_SCOPE_INVALID",
      `${label}.scope must be project or user.`,
    );
  }
  const destination = normalizeArtifactPath(
    expectString(entry.destination, "LOCKFILE_DESTINATION_INVALID", `${label}.destination`),
  );
  const installedAt = expectString(
    entry.installed_at,
    "LOCKFILE_INSTALLED_AT_INVALID",
    `${label}.installed_at`,
  );
  if (!isCanonicalIsoDate(installedAt)) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_INSTALLED_AT_INVALID",
      `${label}.installed_at must be a canonical ISO-8601 timestamp.`,
    );
  }
  const filesDigest = validateDigest(entry.files_digest, `${label}.files_digest`);

  if (!Array.isArray(entry.files) || entry.files.length === 0) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_FILES_INVALID",
      `${label}.files must be a non-empty array.`,
    );
  }
  const files = entry.files.map((file, fileIndex) =>
    validateFileRecord(file, `${label}.files[${fileIndex}]`),
  );
  files.sort((left, right) => compareUtf8(left.path, right.path));
  const fileKeys = new Set<string>();
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (fileKeys.has(key)) {
      throw new AgentCargoLockfileError(
        "LOCKFILE_FILE_DUPLICATE",
        `${label}.files contains a duplicate or case-insensitive collision.`,
      );
    }
    fileKeys.add(key);
  }

  const source = expectRecord(entry.source, "LOCKFILE_SOURCE_INVALID", `${label}.source is invalid.`);
  expectExactKeys(source, ["type"], "LOCKFILE_SOURCE_UNKNOWN_FIELD");
  if (source.type !== "local" && source.type !== "registry") {
    throw new AgentCargoLockfileError(
      "LOCKFILE_SOURCE_INVALID",
      `${label}.source.type must be local or registry.`,
    );
  }

  return {
    package: packageName,
    version,
    digest,
    agent,
    adapter_version: adapterVersion,
    scope: entry.scope,
    destination,
    installed_at: installedAt,
    files_digest: filesDigest,
    files,
    source: { type: source.type },
  };
}

function validateFileRecord(value: unknown, label: string): InstalledFileRecord {
  const record = expectRecord(value, "LOCKFILE_FILE_INVALID", `${label} must be an object.`);
  expectExactKeys(record, ["path", "digest", "bytes", "mode"], "LOCKFILE_FILE_UNKNOWN_FIELD");
  const filePath = normalizeArtifactPath(
    expectString(record.path, "LOCKFILE_FILE_PATH_INVALID", `${label}.path`),
  );
  const digest = validateDigest(record.digest, `${label}.digest`);
  if (!Number.isSafeInteger(record.bytes) || (record.bytes as number) < 0) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_FILE_BYTES_INVALID",
      `${label}.bytes must be a non-negative integer.`,
    );
  }
  if (record.mode !== 0o644 && record.mode !== 0o755) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_FILE_MODE_INVALID",
      `${label}.mode must be 420 or 493.`,
    );
  }
  return { path: filePath, digest, bytes: record.bytes as number, mode: record.mode };
}

function validateDigest(value: unknown, label: string): string {
  const digest = expectString(value, "LOCKFILE_DIGEST_INVALID", label);
  if (!DIGEST_PATTERN.test(digest)) {
    throw new AgentCargoLockfileError(
      "LOCKFILE_DIGEST_INVALID",
      `${label} must be sha256:<64 lowercase hexadecimal characters>.`,
    );
  }
  return digest;
}

function expectRecord(value: unknown, code: string, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentCargoLockfileError(code, message);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, code: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AgentCargoLockfileError(code, `${label} must be a non-empty string.`);
  }
  return value;
}

function expectExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) {
    throw new AgentCargoLockfileError(
      code,
      `Unexpected or missing lockfile fields: ${[...unknown, ...missing].join(", ")}.`,
    );
  }
}

function isCanonicalIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function compareLockEntries(left: AgentCargoLockEntry, right: AgentCargoLockEntry): number {
  return (
    left.agent.localeCompare(right.agent) ||
    left.scope.localeCompare(right.scope) ||
    compareUtf8(left.package, right.package)
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
