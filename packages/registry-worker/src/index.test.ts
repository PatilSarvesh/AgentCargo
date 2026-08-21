import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSkillTemplate,
  inventoryRegularTree,
  packSkillDirectory,
  validateSkillDirectory,
} from "@agentcargo/core";
import type { RegistryRelease, RegistryReleaseCompletionRequest, RegistryScanSummary } from "@agentcargo/registry-contract";
import type {
  RegistryReleaseScanRepository,
  RegistryScanJob,
  RegistryScanJobRepository,
  RegistryScanRelease,
} from "@agentcargo/registry-db";
import { RegistryReleaseWorker, RegistryReleaseWorkerScheduler, type RegistryArtifactFetcher } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("RegistryReleaseWorker", () => {
  it("claims, verifies, scans, and activates a canonical release", async () => {
    const fixture = await createFixture();
    const jobs = new FakeJobs();
    const releases = new FakeReleases(fixture.input);
    const artifacts: RegistryArtifactFetcher = { download: async () => fixture.body };
    const worker = new RegistryReleaseWorker(jobs, releases, artifacts, {
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      denylist: { isDigestDenylisted: async () => false },
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ claimed: true, outcome: "activated", releaseId: "release-1" });
    expect(releases.activated).toHaveLength(1);
    expect(releases.rejected).toHaveLength(0);
    expect(jobs.succeeded).toHaveLength(1);
    expect(jobs.succeeded[0]!.scan.scannerVersion).toBe("rules-1");
  });

  it("rejects an artifact whose bytes do not match the reserved digest", async () => {
    const fixture = await createFixture();
    const jobs = new FakeJobs();
    const releases = new FakeReleases(fixture.input);
    const artifacts: RegistryArtifactFetcher = { download: async () => new TextEncoder().encode("tampered") };
    const worker = new RegistryReleaseWorker(jobs, releases, artifacts, {
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      denylist: { isDigestDenylisted: async () => false },
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ claimed: true, outcome: "rejected" });
    expect(releases.activated).toHaveLength(0);
    expect(releases.rejected).toHaveLength(1);
    expect(releases.rejected[0]!.scan.findings[0]!.ruleId).toBe("AGENTCARGO-WORKER-REJECTED");
    expect(jobs.succeeded).toHaveLength(1);
  });

  it("rejects a digest that is emergency-denylisted before downloading or activating", async () => {
    const fixture = await createFixture();
    const jobs = new FakeJobs();
    const releases = new FakeReleases(fixture.input);
    let downloaded = false;
    const worker = new RegistryReleaseWorker(jobs, releases, {
      download: async () => {
        downloaded = true;
        return fixture.body;
      },
    }, {
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      denylist: { isDigestDenylisted: async () => true },
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ claimed: true, outcome: "rejected" });
    expect(downloaded).toBe(false);
    expect(releases.activated).toHaveLength(0);
    expect(releases.rejected[0]!.reason).toBe("DIGEST_DENYLISTED");
  });

  it("keeps denylist enforcement on the scheduled worker path", async () => {
    const fixture = await createFixture();
    const jobs = new FakeJobs();
    const releases = new FakeReleases(fixture.input);
    let downloaded = false;
    const worker = new RegistryReleaseWorker(jobs, releases, {
      download: async () => {
        downloaded = true;
        return fixture.body;
      },
    }, {
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      denylist: { isDigestDenylisted: async () => true },
    });
    const scheduler = new RegistryReleaseWorkerScheduler(worker, { now: () => new Date("2026-08-15T00:00:00.000Z") });

    await expect(scheduler.runNow()).resolves.toMatchObject({ claimed: true, outcome: "rejected" });
    expect(downloaded).toBe(false);
    expect(releases.rejected[0]!.reason).toBe("DIGEST_DENYLISTED");
    expect(scheduler.health(new Date("2026-08-15T00:00:00.000Z"))).toMatchObject({ totalRuns: 1, claimedJobs: 1, lastOutcome: "rejected" });
    await scheduler.stop();
  });

  it("requires a denylist reader before a worker can be constructed", async () => {
    const fixture = await createFixture();
    expect(() => new RegistryReleaseWorker(
      new FakeJobs(),
      new FakeReleases(fixture.input),
      { download: async () => fixture.body },
      {} as never,
    )).toThrow("A digest denylist reader is required");
  });

  it("fails closed when the denylist reader is unavailable", async () => {
    const fixture = await createFixture();
    const jobs = new FakeJobs();
    const releases = new FakeReleases(fixture.input);
    let downloaded = false;
    const worker = new RegistryReleaseWorker(jobs, releases, {
      download: async () => {
        downloaded = true;
        return fixture.body;
      },
    }, {
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      denylist: {
        isDigestDenylisted: async () => {
          throw new Error("denylist unavailable");
        },
      },
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ claimed: true, outcome: "failed" });
    expect(downloaded).toBe(false);
    expect(releases.activated).toHaveLength(0);
    expect(jobs.failed[0]!.message).toBe("denylist unavailable");
  });
});

class FakeJobs implements RegistryScanJobRepository {
  private claimed = false;
  readonly succeeded: Array<{ jobId: string; scan: RegistryScanSummary }> = [];
  readonly failed: Array<{ jobId: string; message: string }> = [];

  async enqueuePending(): Promise<number> {
    return this.claimed ? 0 : 1;
  }

  async claim(): Promise<RegistryScanJob | null> {
    if (this.claimed) return null;
    this.claimed = true;
    return { jobId: "job-1", releaseId: "release-1", status: "running", attempts: 1, leaseUntil: "2026-08-15T00:05:00.000Z" };
  }

  async succeed(jobId: string, scan: RegistryScanSummary): Promise<void> {
    this.succeeded.push({ jobId, scan });
  }

  async fail(jobId: string, message: string): Promise<void> {
    this.failed.push({ jobId, message });
  }
}

class FakeReleases implements RegistryReleaseScanRepository {
  readonly activated: Array<{ releaseId: string; release: RegistryRelease }> = [];
  readonly rejected: Array<{ releaseId: string; scan: RegistryScanSummary; reason: string }> = [];

  constructor(private readonly input: RegistryScanRelease) {}

  async getForScan(): Promise<RegistryScanRelease> {
    return this.input;
  }

  async activate(releaseId: string, release: RegistryRelease): Promise<void> {
    this.activated.push({ releaseId, release });
  }

  async reject(releaseId: string, scan: RegistryScanSummary, reason: string): Promise<void> {
    this.rejected.push({ releaseId, scan, reason });
  }
}

async function createFixture(): Promise<{ input: RegistryScanRelease; body: Uint8Array }> {
  const parent = await mkdtemp(path.join(tmpdir(), "agentcargo-worker-fixture-"));
  temporaryDirectories.push(parent);
  const root = path.join(parent, "worker-skill");
  await mkdir(root);
  const template = createSkillTemplate("worker-skill", "Worker fixture.");
  await writeFile(path.join(root, "SKILL.md"), template.skillMarkdown);
  await writeFile(path.join(root, "agentcargo.yaml"), template.manifestYaml);
  const packed = await packSkillDirectory(root, path.join(parent, "worker.agentcargo"));
  const body = await readFile(packed.artifactPath);
  const validation = await validateSkillDirectory(root);
  const inventory = await inventoryRegularTree(root);
  const declared = {
    description: validation.manifest!.description,
    tags: validation.manifest!.tags ?? [],
    compatibility: validation.manifest!.compatibility ?? {},
    capabilities: validation.manifest!.capabilities,
  } satisfies RegistryReleaseCompletionRequest["declared"];
  const files = inventory.files.map((file) => ({
    path: file.path,
    bytes: file.bytes,
    executable: file.mode === 0o755,
    scriptLike: file.mode === 0o755 || /\.(?:bash|bat|cjs|cmd|fish|js|mjs|php|pl|ps1|py|rb|sh|ts|zsh)$/i.test(file.path),
  }));
  const input: RegistryScanRelease = {
    releaseId: "release-1",
    coordinate: { namespace: "acme", name: "worker-skill", version: "0.1.0" },
    artifactKey: "artifacts/sha256/placeholder.agentcargo",
    completion: {
      artifact: {
        format: "agentcargo-ustar-v1",
        mediaType: "application/vnd.agentcargo.ustar-v1",
        digest: packed.digest as `sha256:${string}`,
        bytes: body.byteLength,
      },
      declared,
      files,
      scan: { scannerVersion: "client", completedAt: "2026-08-14T00:00:00.000Z", findings: [] },
      source: {},
    },
  };
  return { input, body };
}
