import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readRollbackState,
  validateRollbackState,
  writeRollbackStateAtomic,
  type AgentCargoRollbackState,
} from "./rollback-state.js";
import type { AgentCargoLockEntry } from "./types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("rollback state", () => {
  it("writes, permission-restricts, reads, and validates retained receipts", async () => {
    const root = await createTemporaryDirectory();
    const statePath = path.join(root, ".agentcargo-rollback.json");
    const state = fixtureState();

    await writeRollbackStateAtomic(statePath, state);

    expect(await readRollbackState(statePath)).toEqual(state);
    expect((await readFile(statePath, "utf8"))).not.toContain("undefined");
    if (process.platform !== "win32") {
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects identity mismatches and backup traversal", () => {
    const state = fixtureState();
    const record = state.packages[0]!;
    expect(() => validateRollbackState({
      ...state,
      packages: [{ ...record, backup_destination: "../outside" }],
    })).toThrowError(expect.objectContaining({ code: "ROLLBACK_STATE_DESTINATION_INVALID" }));

    expect(() => validateRollbackState({
      ...state,
      packages: [{
        ...record,
        previous: { ...record.previous, package: "other-skill" },
      }],
    })).toThrowError(expect.objectContaining({ code: "ROLLBACK_STATE_IDENTITY_MISMATCH" }));
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked state file", async () => {
    const root = await createTemporaryDirectory();
    const target = path.join(root, "target.json");
    const statePath = path.join(root, ".agentcargo-rollback.json");
    await writeRollbackStateAtomic(target, fixtureState());
    await symlink(target, statePath, "file");

    await expect(readRollbackState(statePath)).rejects.toMatchObject({
      code: "ROLLBACK_STATE_NOT_REGULAR_FILE",
    });
  });
});

function fixtureState(): AgentCargoRollbackState {
  const previous = entry("1.0.0", "a");
  const current = entry("2.0.0", "b");
  return {
    rollback_state_version: 1,
    packages: [{
      backup_destination: ".agents/skills/.agentcargo-rollback-test",
      created_at: "2026-08-19T00:00:00.000Z",
      previous,
      current,
    }],
  };
}

function entry(version: string, digestCharacter: string): AgentCargoLockEntry {
  const digest = `sha256:${digestCharacter.repeat(64)}`;
  return {
    package: "review-skill",
    version,
    digest,
    agent: "codex",
    adapter_version: "0.1.0",
    scope: "project",
    destination: ".agents/skills/review-skill",
    installed_at: "2026-08-19T00:00:00.000Z",
    files_digest: digest,
    files: [{ path: "SKILL.md", digest, bytes: 10, mode: 0o644 }],
    source: { type: "local" },
  };
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "agentcargo-rollback-state-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
