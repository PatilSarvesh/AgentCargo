import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { normalizeArtifactPath } from "./archive.js";
import { validateLockfile } from "./lockfile.js";
import type { AgentCargoLockEntry } from "./types.js";

export const ROLLBACK_STATE_NAME = ".agentcargo-rollback.json";
const MAX_ROLLBACK_STATE_BYTES = 2 * 1024 * 1024;

export interface AgentCargoRollbackRecord {
  backup_destination: string;
  created_at: string;
  previous: AgentCargoLockEntry;
  current: AgentCargoLockEntry;
}

export interface AgentCargoRollbackState {
  rollback_state_version: 1;
  packages: AgentCargoRollbackRecord[];
}

export class AgentCargoRollbackStateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentCargoRollbackStateError";
  }
}

export function rollbackStatePath(lockfilePath: string): string {
  return path.join(path.dirname(path.resolve(lockfilePath)), ROLLBACK_STATE_NAME);
}

export function emptyRollbackState(): AgentCargoRollbackState {
  return { rollback_state_version: 1, packages: [] };
}

export async function readRollbackState(statePath: string): Promise<AgentCargoRollbackState> {
  const resolved = path.resolve(statePath);
  const before = await lstat(resolved).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!before) return emptyRollbackState();
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_NOT_REGULAR_FILE",
      `Rollback state must be a regular file: ${resolved}`,
    );
  }
  if (before.size > MAX_ROLLBACK_STATE_BYTES) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_TOO_LARGE",
      `Rollback state exceeds the ${MAX_ROLLBACK_STATE_BYTES} byte limit.`,
    );
  }

  const handle = await open(resolved, "r");
  let contents: string;
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size
      || opened.mtimeMs !== before.mtimeMs
      || opened.ctimeMs !== before.ctimeMs
    ) {
      throw new AgentCargoRollbackStateError(
        "ROLLBACK_STATE_CHANGED_DURING_READ",
        "Rollback state changed while it was being opened.",
      );
    }
    contents = await handle.readFile("utf8");
    const after = await handle.stat();
    if (
      after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs
      || after.ctimeMs !== opened.ctimeMs
    ) {
      throw new AgentCargoRollbackStateError(
        "ROLLBACK_STATE_CHANGED_DURING_READ",
        "Rollback state changed while it was being read.",
      );
    }
  } finally {
    await handle.close();
  }

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_INVALID_JSON",
      error instanceof Error ? error.message : "Rollback state contains invalid JSON.",
    );
  }
  return validateRollbackState(value);
}

export async function writeRollbackStateAtomic(
  statePath: string,
  state: AgentCargoRollbackState,
): Promise<void> {
  const validated = validateRollbackState(state);
  const resolved = path.resolve(statePath);
  if (validated.packages.length === 0) {
    await removeRollbackState(resolved);
    return;
  }

  const parent = path.dirname(resolved);
  await mkdir(parent, { recursive: true });
  const temporaryPath = path.join(
    parent,
    `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const contents = `${JSON.stringify(validated, null, 2)}\n`;
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

export async function removeRollbackState(statePath: string): Promise<void> {
  const resolved = path.resolve(statePath);
  const fileStat = await lstat(resolved).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!fileStat) return;
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_NOT_REGULAR_FILE",
      `Rollback state must be a regular file: ${resolved}`,
    );
  }
  await unlink(resolved);
}

export function validateRollbackState(value: unknown): AgentCargoRollbackState {
  const root = expectRecord(value, "ROLLBACK_STATE_INVALID", "Rollback state must be an object.");
  expectExactKeys(root, ["rollback_state_version", "packages"]);
  if (root.rollback_state_version !== 1) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_VERSION_UNSUPPORTED",
      "rollback_state_version must be 1.",
    );
  }
  if (!Array.isArray(root.packages)) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_PACKAGES_INVALID",
      "Rollback state packages must be an array.",
    );
  }

  const identities = new Set<string>();
  const packages = root.packages.map((value, index) => {
    const record = validateRecord(value, index);
    const identity = rollbackRecordIdentity(record);
    if (identities.has(identity)) {
      throw new AgentCargoRollbackStateError(
        "ROLLBACK_STATE_PACKAGE_DUPLICATE",
        `Rollback state contains a duplicate record for ${record.current.package}.`,
      );
    }
    identities.add(identity);
    return record;
  });
  packages.sort((left, right) => rollbackRecordIdentity(left).localeCompare(rollbackRecordIdentity(right)));
  return { rollback_state_version: 1, packages };
}

export function lockEntriesEqual(
  left: AgentCargoLockEntry,
  right: AgentCargoLockEntry,
): boolean {
  return JSON.stringify(normalizeEntry(left)) === JSON.stringify(normalizeEntry(right));
}

export function rollbackRecordIdentity(record: AgentCargoRollbackRecord): string {
  return `${record.current.agent}\0${record.current.scope}\0${record.current.package}`;
}

function validateRecord(value: unknown, index: number): AgentCargoRollbackRecord {
  const label = `packages[${index}]`;
  const record = expectRecord(value, "ROLLBACK_STATE_RECORD_INVALID", `${label} must be an object.`);
  expectExactKeys(record, ["backup_destination", "created_at", "previous", "current"]);
  if (typeof record.backup_destination !== "string" || record.backup_destination.length === 0) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_DESTINATION_INVALID",
      `${label}.backup_destination must be a non-empty portable path.`,
    );
  }
  let backupDestination: string;
  try {
    backupDestination = normalizeArtifactPath(record.backup_destination);
  } catch (error) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_DESTINATION_INVALID",
      error instanceof Error ? error.message : `${label}.backup_destination is invalid.`,
    );
  }
  if (typeof record.created_at !== "string" || !isCanonicalIsoDate(record.created_at)) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_CREATED_AT_INVALID",
      `${label}.created_at must be a canonical ISO-8601 timestamp.`,
    );
  }
  const previous = normalizeEntry(record.previous);
  const current = normalizeEntry(record.current);
  if (
    previous.package !== current.package
    || previous.agent !== current.agent
    || previous.scope !== current.scope
    || previous.destination !== current.destination
  ) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_IDENTITY_MISMATCH",
      `${label} entries must describe the same package, host, scope, and active destination.`,
    );
  }
  return {
    backup_destination: backupDestination,
    created_at: record.created_at,
    previous,
    current,
  };
}

function normalizeEntry(value: unknown): AgentCargoLockEntry {
  try {
    const entry = validateLockfile({ lockfile_version: 1, packages: [value] }).packages[0];
    if (!entry) throw new Error("Rollback state entry is missing.");
    return entry;
  } catch (error) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_ENTRY_INVALID",
      error instanceof Error ? error.message : "Rollback state contains an invalid lock entry.",
    );
  }
}

function expectRecord(value: unknown, code: string, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentCargoRollbackStateError(code, message);
  }
  return value as Record<string, unknown>;
}

function expectExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const expectedSet = new Set(expected);
  const unexpected = Object.keys(value).filter((key) => !expectedSet.has(key));
  const missing = expected.filter((key) => !(key in value));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new AgentCargoRollbackStateError(
      "ROLLBACK_STATE_UNKNOWN_FIELD",
      `Unexpected or missing rollback-state fields: ${[...unexpected, ...missing].join(", ")}.`,
    );
  }
}

function isCanonicalIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
