import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

export const OPERATION_LOCK_NAME = ".agentcargo-operation.lock";

export interface OperationLockStatus {
  path: string;
  state: "absent" | "active" | "stale" | "invalid";
  pid?: number;
  startedAt?: string;
  reason?: string;
}

export class AgentCargoOperationLockError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentCargoOperationLockError";
  }
}

export async function acquireOperationLock(
  parent: string,
  lockedCode = "OPERATION_LOCKED",
): Promise<{ path: string; release(): Promise<void> }> {
  await mkdir(parent, { recursive: true });
  const lockPath = path.join(parent, OPERATION_LOCK_NAME);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new AgentCargoOperationLockError(
        lockedCode,
        `Another AgentCargo operation is active for this scope: ${parent}`,
      );
    }
    throw error;
  }

  try {
    await handle.chmod(0o600);
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
      "utf8",
    );
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }

  return {
    path: lockPath,
    async release(): Promise<void> {
      const openedStat = await handle.stat();
      await handle.close();
      const currentStat = await lstat(lockPath).catch((error: unknown) => {
        if (isNodeError(error) && error.code === "ENOENT") return undefined;
        throw error;
      });
      if (
        currentStat &&
        currentStat.isFile() &&
        !currentStat.isSymbolicLink() &&
        currentStat.dev === openedStat.dev &&
        currentStat.ino === openedStat.ino
      ) {
        await unlink(lockPath);
      }
    },
  };
}

export async function inspectOperationLock(parent: string): Promise<OperationLockStatus> {
  const lockPath = path.join(parent, OPERATION_LOCK_NAME);
  const fileStat = await lstat(lockPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!fileStat) return { path: lockPath, state: "absent" };
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    return { path: lockPath, state: "invalid", reason: "Operation lock is not a regular file." };
  }

  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
    if (!isRecord(value) || !Number.isSafeInteger(value.pid) || typeof value.started_at !== "string") {
      return { path: lockPath, state: "invalid", reason: "Operation lock metadata is invalid." };
    }
    const pid = value.pid as number;
    const startedAt = value.started_at;
    if (pid <= 0 || !isCanonicalIsoDate(startedAt)) {
      return { path: lockPath, state: "invalid", reason: "Operation lock metadata is invalid." };
    }
    return processIsAlive(pid)
      ? { path: lockPath, state: "active", pid, startedAt }
      : { path: lockPath, state: "stale", pid, startedAt };
  } catch (error) {
    return {
      path: lockPath,
      state: "invalid",
      reason: error instanceof Error ? error.message : "Operation lock could not be read.",
    };
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isCanonicalIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
