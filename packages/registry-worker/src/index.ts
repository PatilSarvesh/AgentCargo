import {
  STATIC_SCANNER_VERSION,
  extractArtifact,
  inventoryRegularTree,
  scanSkillDirectory,
  validateSkillDirectory,
} from "@agentcargo/core";
import type { AgentCargoManifest } from "@agentcargo/core";
import type {
  RegistryDeclaredMetadata,
  RegistryFileSummary,
  RegistryRelease,
  RegistryScanSummary,
} from "@agentcargo/registry-contract";
import type {
  RegistryReleaseScanRepository,
  RegistryDigestDenylistReader,
  RegistryScanJob,
  RegistryScanQueueStats,
  RegistryScanJobRepository,
  RegistryScanRelease,
} from "@agentcargo/registry-db";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface RegistryArtifactFetcher {
  download(input: RegistryScanRelease): Promise<Uint8Array>;
}

export interface RegistryWorkerOptions {
  now?: () => Date;
  retryDelayMs?: number;
  tempDirectory?: string;
  /** Required: activation must never run without an emergency denylist check. */
  denylist: RegistryDigestDenylistReader;
}

export interface RegistryWorkerRunResult {
  enqueued: number;
  claimed: boolean;
  outcome?: "activated" | "rejected" | "failed";
  releaseId?: string;
}

/**
 * Claims one durable release job, verifies and unpacks its artifact, performs
 * the shared static scan, and only then calls the public activation boundary.
 * Uploaded files are treated as data: no package script is ever executed.
 */
export class RegistryReleaseWorker {
  readonly #now: () => Date;
  readonly #retryDelayMs: number;
  readonly #tempDirectory: string | undefined;
  readonly #denylist: RegistryDigestDenylistReader;

  constructor(
    private readonly jobs: RegistryScanJobRepository,
    private readonly releases: RegistryReleaseScanRepository,
    private readonly artifacts: RegistryArtifactFetcher,
    options: RegistryWorkerOptions,
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#retryDelayMs = options.retryDelayMs ?? 30_000;
    if (!Number.isSafeInteger(this.#retryDelayMs) || this.#retryDelayMs < 0) {
      throw new RangeError("retryDelayMs must be a non-negative safe integer.");
    }
    this.#tempDirectory = options.tempDirectory;
    this.#denylist = options.denylist;
    if (!this.#denylist || typeof this.#denylist.isDigestDenylisted !== "function") {
      throw new TypeError("A digest denylist reader is required for worker activation.");
    }
  }

  async runOnce(): Promise<RegistryWorkerRunResult> {
    const now = this.#now();
    const enqueued = await this.jobs.enqueuePending(now);
    const job = await this.jobs.claim(now);
    if (!job) return { enqueued, claimed: false };

    try {
      const release = await this.releases.getForScan(job.releaseId);
      if (!release) {
        await this.jobs.fail(job.jobId, "The scanning release was not found.", this.retryAt(now));
        return { enqueued, claimed: true, outcome: "failed", releaseId: job.releaseId };
      }
      const result = await this.process(job, release, now);
      return { enqueued, claimed: true, outcome: result, releaseId: job.releaseId };
    } catch (error) {
      await this.jobs.fail(job.jobId, errorMessage(error), this.retryAt(now), now);
      return { enqueued, claimed: true, outcome: "failed", releaseId: job.releaseId };
    }
  }

  /** Return queue-only operational counters when the repository supports them. */
  async queueStats(now = this.#now()): Promise<RegistryScanQueueStats | null> {
    if (typeof this.jobs.getQueueStats !== "function") return null;
    return this.jobs.getQueueStats(now);
  }

  private async process(
    job: RegistryScanJob,
    input: RegistryScanRelease,
    now: Date,
  ): Promise<"activated" | "rejected"> {
    const parent = await mkdtemp(path.join(this.#tempDirectory ?? tmpdir(), "agentcargo-worker-"));
    const artifactPath = path.join(parent, "artifact.agentcargo");
    const extractionPath = path.join(parent, input.coordinate.name);
    try {
      if (await this.#denylist.isDigestDenylisted(input.completion.artifact.digest)) {
        return this.reject(job, input, scanFailure("The artifact digest is on the emergency denylist.", now), "DIGEST_DENYLISTED", now);
      }
      const body = await this.artifacts.download(input);
      if (body.byteLength !== input.completion.artifact.bytes) {
        return this.reject(job, input, scanFailure("Artifact byte count does not match completion metadata.", now), "ARTIFACT_SIZE_MISMATCH", now);
      }
      await writeFile(artifactPath, body, { mode: 0o600 });
      try {
        await extractArtifact(artifactPath, extractionPath, { expectedDigest: input.completion.artifact.digest });
      } catch (error) {
        const scan = scanFailure(errorMessage(error), now);
        return this.reject(job, input, scan, "ARTIFACT_REJECTED", now);
      }

      const validation = await validateSkillDirectory(extractionPath);
      const scan = await scanSkillDirectory(extractionPath, { now: () => now });
      const files = await summarizeFiles(extractionPath);
      const declared = declaredFromManifest(validation.manifest);
      const mismatch = metadataMismatch(input, validation.manifest, declared, files);
      if (!validation.valid || !scan.valid || mismatch) {
        return this.reject(job, input, scan, mismatch ?? "PACKAGE_VALIDATION_FAILED", now);
      }

      const release: RegistryRelease = {
        apiVersion: "v1",
        coordinate: input.coordinate,
        status: "active",
        declared,
        artifact: {
          ...input.completion.artifact,
          download: {
            url: `https://registry.invalid/v1/artifacts/${encodeURIComponent(input.completion.artifact.digest)}`,
            expiresAt: new Date(now.getTime() + 300_000).toISOString(),
          },
        },
        files,
        scan,
        source: input.completion.source,
        publishedAt: now.toISOString(),
      };
      await this.releases.activate(input.releaseId, release);
      await this.jobs.succeed(job.jobId, scan, now);
      return "activated";
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }

  private async reject(
    job: RegistryScanJob,
    input: RegistryScanRelease,
    scan: RegistryScanSummary,
    reason: string,
    now: Date,
  ): Promise<"rejected"> {
    await this.releases.reject(input.releaseId, scan, reason, now);
    await this.jobs.succeed(job.jobId, scan, now);
    return "rejected";
  }

  private retryAt(now: Date): Date {
    return new Date(now.getTime() + this.#retryDelayMs);
  }
}

function declaredFromManifest(manifest: AgentCargoManifest | undefined): RegistryDeclaredMetadata {
  if (!manifest) {
    return { description: "", tags: [], compatibility: {} };
  }
  return {
    description: manifest.description,
    ...(manifest.license ? { license: manifest.license } : {}),
    ...(manifest.repository ? { repositoryUrl: manifest.repository } : {}),
    tags: manifest.tags ?? [],
    compatibility: manifest.compatibility ?? {},
    ...(manifest.capabilities ? { capabilities: manifest.capabilities as Readonly<Record<string, unknown>> } : {}),
  };
}

function metadataMismatch(
  input: RegistryScanRelease,
  manifest: AgentCargoManifest | undefined,
  declared: RegistryDeclaredMetadata,
  files: readonly RegistryFileSummary[],
): string | undefined {
  if (!manifest) return "AGENTCARGO_MANIFEST_MISSING";
  if (manifest.name !== input.coordinate.name || manifest.version !== input.coordinate.version) {
    return "MANIFEST_COORDINATE_MISMATCH";
  }
  if (canonicalJson(declared) !== canonicalJson(input.completion.declared)) return "DECLARED_METADATA_MISMATCH";
  if (canonicalJson(files) !== canonicalJson(input.completion.files)) return "FILE_INVENTORY_MISMATCH";
  return undefined;
}

async function summarizeFiles(root: string): Promise<RegistryFileSummary[]> {
  const inventory = await inventoryRegularTree(root);
  return inventory.files.map((file) => ({
    path: file.path,
    bytes: file.bytes,
    executable: file.mode === 0o755,
    scriptLike: file.mode === 0o755 || /\.(?:bash|bat|cjs|cmd|fish|js|mjs|php|pl|ps1|py|rb|sh|ts|zsh)$/i.test(file.path),
  }));
}

function scanFailure(message: string, now = new Date()): RegistryScanSummary {
  return {
    scannerVersion: STATIC_SCANNER_VERSION,
    completedAt: now.toISOString(),
    findings: [{
      ruleId: "AGENTCARGO-WORKER-REJECTED",
      ruleVersion: "1",
      severity: "error",
      message: "The artifact could not be activated by the worker.",
      explanation: message.slice(0, 2_048),
      remediation: "Upload a canonical AgentCargo artifact whose digest, metadata, and package structure match the release reservation.",
    }],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_048) : "The worker job failed.";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).sort().join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type { RegistryScanJob, RegistryScanRelease };
export { RegistryReleaseWorkerScheduler, registryWorkerStatusSource } from "./scheduler.js";
export type {
  RegistryWorkerQueueHealth,
  RegistryWorkerReadiness,
  RegistryWorkerSchedulerFailureReason,
  RegistryWorkerSchedulerHealth,
  RegistryWorkerSchedulerOptions,
  RegistryWorkerSchedulerState,
} from "./scheduler.js";
