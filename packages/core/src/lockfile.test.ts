import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLockfile, validateLockfile, writeLockfileAtomic } from "./lockfile.js";
import type { AgentCargoLockfile } from "./types.js";

const temporaryDirectories: string[] = [];
const digest = `sha256:${"a".repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("AgentCargo lockfile", () => {
  it("writes and reads schema version 1 atomically", async () => {
    const root = await createTemporaryDirectory();
    const lockfilePath = path.join(root, "agentcargo.lock");
    const lockfile = fixtureLockfile();

    await writeLockfileAtomic(lockfilePath, lockfile);
    const firstBytes = await readFile(lockfilePath);
    await writeLockfileAtomic(lockfilePath, lockfile);

    expect(await readFile(lockfilePath)).toEqual(firstBytes);
    expect(await readLockfile(lockfilePath)).toEqual(lockfile);
  });

  it("rejects traversal destinations and unknown fields", () => {
    const lockfile = fixtureLockfile() as unknown as Record<string, unknown>;
    const packages = lockfile.packages as Array<Record<string, unknown>>;
    packages[0]!.destination = "../outside";
    packages[0]!.extra = true;

    expect(() => validateLockfile(lockfile)).toThrowError(
      expect.objectContaining({ code: "LOCKFILE_ENTRY_UNKNOWN_FIELD" }),
    );
  });

  it("accepts a scoped coordinate for a future registry-backed entry", () => {
    const lockfile = fixtureLockfile();
    lockfile.packages[0]!.package = "@acme/hello-skill";
    lockfile.packages[0]!.source = { type: "registry" };

    expect(validateLockfile(lockfile).packages[0]).toMatchObject({
      package: "@acme/hello-skill",
      source: { type: "registry" },
    });
  });

  it.skipIf(process.platform === "win32")("refuses a symlinked lockfile", async () => {
    const root = await createTemporaryDirectory();
    const target = path.join(root, "target.yaml");
    const lockfilePath = path.join(root, "agentcargo.lock");
    await writeFile(target, "lockfile_version: 1\npackages: []\n");
    await symlink(target, lockfilePath);

    await expect(readLockfile(lockfilePath)).rejects.toMatchObject({
      code: "LOCKFILE_NOT_REGULAR_FILE",
    });
  });
});

function fixtureLockfile(): AgentCargoLockfile {
  return {
    lockfile_version: 1,
    packages: [
      {
        package: "hello-skill",
        version: "0.1.0",
        digest,
        agent: "codex",
        adapter_version: "0.1.0",
        scope: "project",
        destination: ".agents/skills/hello-skill",
        installed_at: "2026-08-13T00:00:00.000Z",
        files_digest: digest,
        files: [{ path: "SKILL.md", digest, bytes: 12, mode: 0o644 }],
        source: { type: "local" },
      },
    ],
  };
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "agentcargo-lockfile-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
