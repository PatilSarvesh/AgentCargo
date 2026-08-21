import type { RegistryScanQueueStats } from "@agentcargo/registry-db";
import type { RegistryWorkerRunResult, RegistryReleaseWorker } from "./index.js";

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_MAX_QUEUE_LAG_MS = 60_000;
const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 60 * 60 * 1_000;

export type RegistryWorkerSchedulerState = "stopped" | "running" | "degraded" | "draining";
export type RegistryWorkerSchedulerFailureReason = "stopped" | "draining" | "not-run" | "failure-threshold" | "queue-health-unavailable" | "queue-lag" | "stale" | "ready";

export interface RegistryWorkerSchedulerOptions {
  intervalMs?: number;
  maxConsecutiveFailures?: number;
  maxQueueLagMs?: number;
  now?: () => Date;
}

export interface RegistryWorkerQueueHealth extends RegistryScanQueueStats {
  lagMs: number;
}

export interface RegistryWorkerSchedulerHealth {
  apiVersion: "v1";
  state: RegistryWorkerSchedulerState;
  ready: boolean;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastOutcome: RegistryWorkerRunResult["outcome"] | null;
  lastError: string | null;
  consecutiveFailures: number;
  totalRuns: number;
  claimedJobs: number;
  lastRunDurationMs: number | null;
  lastScheduleLagMs: number | null;
  lastRunAgeMs: number | null;
  queue: RegistryWorkerQueueHealth | null;
}

export interface RegistryWorkerReadiness {
  ready: boolean;
  reason: RegistryWorkerSchedulerFailureReason;
  health: RegistryWorkerSchedulerHealth;
}

/**
 * Runs the durable worker without overlapping claims. A stop drains the
 * current run, so its database lease can be completed or retried normally;
 * no new claim is started after shutdown begins.
 */
export class RegistryReleaseWorkerScheduler {
  readonly #worker: RegistryReleaseWorker;
  readonly #intervalMs: number;
  readonly #maxConsecutiveFailures: number;
  readonly #maxQueueLagMs: number;
  readonly #now: () => Date;
  #state: RegistryWorkerSchedulerState = "stopped";
  #timer: ReturnType<typeof setTimeout> | null = null;
  #active: Promise<RegistryWorkerRunResult> | null = null;
  #lastRunStartedAt: Date | null = null;
  #lastRunFinishedAt: Date | null = null;
  #lastOutcome: RegistryWorkerRunResult["outcome"] | null = null;
  #lastError: string | null = null;
  #consecutiveFailures = 0;
  #totalRuns = 0;
  #claimedJobs = 0;
  #lastRunDurationMs: number | null = null;
  #lastScheduleLagMs: number | null = null;
  #queue: RegistryWorkerQueueHealth | null = null;
  #queueHealthError = false;

  constructor(worker: RegistryReleaseWorker, options: RegistryWorkerSchedulerOptions = {}) {
    this.#worker = worker;
    this.#intervalMs = boundedPositiveInteger(options.intervalMs ?? DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS, "intervalMs");
    this.#maxConsecutiveFailures = boundedPositiveInteger(options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES, 1, 100, "maxConsecutiveFailures");
    this.#maxQueueLagMs = boundedPositiveInteger(options.maxQueueLagMs ?? DEFAULT_MAX_QUEUE_LAG_MS, 1_000, MAX_INTERVAL_MS, "maxQueueLagMs");
    this.#now = options.now ?? (() => new Date());
  }

  get state(): RegistryWorkerSchedulerState {
    return this.#state;
  }

  /** Start the periodic loop. The first run is scheduled immediately. */
  start(): void {
    if (this.#state === "running" || this.#state === "degraded") return;
    if (this.#state === "draining") throw new Error("The worker scheduler is draining.");
    this.#state = "running";
    this.#schedule(0);
  }

  /** Stop scheduling and wait for the current lease-owning run to finish. */
  async stop(): Promise<void> {
    if (this.#state === "stopped") return;
    this.#state = "draining";
    this.#clearTimer();
    const active = this.#active;
    if (active) {
      try {
        await active;
      } catch {
        // The run already recorded a bounded health error; shutdown still drains it.
      }
    }
    this.#state = "stopped";
  }

  /** Run one cycle on demand; concurrent callers share the same promise. */
  runNow(): Promise<RegistryWorkerRunResult> {
    if (this.#state === "draining") return Promise.reject(new Error("The worker scheduler is draining."));
    if (this.#state === "stopped") this.#state = "running";
    return this.#startRun(this.#now());
  }

  health(now = this.#now()): RegistryWorkerSchedulerHealth {
    const lastRunAgeMs = this.#lastRunStartedAt === null
      ? null
      : Math.max(0, now.getTime() - this.#lastRunStartedAt.getTime());
    const ready = this.#readinessReason(now) === "ready";
    return {
      apiVersion: "v1",
      state: this.#state,
      ready,
      lastRunStartedAt: this.#lastRunStartedAt?.toISOString() ?? null,
      lastRunFinishedAt: this.#lastRunFinishedAt?.toISOString() ?? null,
      lastOutcome: this.#lastOutcome,
      lastError: this.#lastError,
      consecutiveFailures: this.#consecutiveFailures,
      totalRuns: this.#totalRuns,
      claimedJobs: this.#claimedJobs,
      lastRunDurationMs: this.#lastRunDurationMs,
      lastScheduleLagMs: this.#lastScheduleLagMs,
      lastRunAgeMs,
      queue: this.#queue,
    };
  }

  readiness(now = this.#now()): RegistryWorkerReadiness {
    const reason = this.#readinessReason(now);
    return { ready: reason === "ready", reason, health: this.health(now) };
  }

  #startRun(scheduledAt: Date): Promise<RegistryWorkerRunResult> {
    if (this.#active) return this.#active;
    const promise = this.#execute(scheduledAt);
    this.#active = promise;
    void promise.then(
      () => this.#clearActive(promise),
      () => this.#clearActive(promise),
    ).catch(() => undefined);
    return promise;
  }

  async #execute(scheduledAt: Date): Promise<RegistryWorkerRunResult> {
    const startedAt = this.#now();
    this.#lastRunStartedAt = startedAt;
    this.#lastScheduleLagMs = Math.max(0, startedAt.getTime() - scheduledAt.getTime());
    this.#totalRuns += 1;
    try {
      const result = await this.#worker.runOnce();
      this.#lastOutcome = result.outcome ?? null;
      if (result.claimed) this.#claimedJobs += 1;
      if (result.outcome === "failed") this.#recordFailure("A scan job failed and was scheduled for retry.");
      else this.#recordSuccess();
      await this.#refreshQueue(this.#now());
      this.#finishRun(startedAt);
      return result;
    } catch {
      this.#lastOutcome = "failed";
      this.#recordFailure("The worker cycle failed before completion.");
      await this.#refreshQueue(this.#now());
      this.#finishRun(startedAt);
      throw new Error("The worker cycle failed before completion.");
    }
  }

  #finishRun(startedAt: Date): void {
    const finishedAt = this.#now();
    this.#lastRunFinishedAt = finishedAt;
    this.#lastRunDurationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
  }

  #recordSuccess(): void {
    this.#consecutiveFailures = 0;
    this.#lastError = null;
    if (this.#state !== "draining") this.#state = "running";
  }

  #recordFailure(message: string): void {
    this.#consecutiveFailures += 1;
    this.#lastError = message;
    if (this.#state !== "draining" && this.#consecutiveFailures >= this.#maxConsecutiveFailures) this.#state = "degraded";
  }

  async #refreshQueue(now: Date): Promise<void> {
    try {
      const stats = await this.#worker.queueStats(now);
      if (!stats) {
        this.#queue = null;
        this.#queueHealthError = false;
        return;
      }
      const oldest = stats.oldestAvailableAt === null ? null : Date.parse(stats.oldestAvailableAt);
      if (oldest !== null && !Number.isFinite(oldest)) throw new Error("invalid queue timestamp");
      this.#queue = { ...stats, lagMs: oldest === null ? 0 : Math.max(0, now.getTime() - oldest) };
      this.#queueHealthError = false;
    } catch {
      this.#queue = null;
      this.#queueHealthError = true;
      this.#lastError ??= "Queue health is unavailable.";
    }
  }

  #readinessReason(now: Date): RegistryWorkerSchedulerFailureReason {
    if (this.#state === "stopped") return "stopped";
    if (this.#state === "draining") return "draining";
    if (!this.#lastRunFinishedAt) return "not-run";
    if (this.#consecutiveFailures >= this.#maxConsecutiveFailures || this.#state === "degraded") return "failure-threshold";
    if (this.#queueHealthError) return "queue-health-unavailable";
    if (this.#queue && this.#queue.lagMs > this.#maxQueueLagMs) return "queue-lag";
    if (now.getTime() - this.#lastRunFinishedAt.getTime() > this.#intervalMs * 3) return "stale";
    return "ready";
  }

  #schedule(delayMs: number): void {
    this.#clearTimer();
    if (this.#state !== "running" && this.#state !== "degraded") return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#active) {
        this.#schedule(this.#intervalMs);
        return;
      }
      const scheduledAt = this.#now();
      const run = this.#startRun(scheduledAt);
      void run.catch(() => undefined).finally(() => {
        if (this.#state === "running" || this.#state === "degraded") this.#schedule(this.#intervalMs);
      });
    }, delayMs);
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  #clearActive(promise: Promise<RegistryWorkerRunResult>): void {
    if (this.#active === promise) this.#active = null;
  }
}

/**
 * Adapt scheduler readiness into the registry API's sanitized status-source
 * shape without exposing the scheduler's bounded error text or package data.
 */
export function registryWorkerStatusSource(scheduler: RegistryReleaseWorkerScheduler, now = new Date()) {
  const readiness = scheduler.readiness(now);
  const health = readiness.health;
  return {
    status: readiness.ready ? "operational" as const : "degraded" as const,
    ready: readiness.ready,
    reason: readiness.reason,
    totalRuns: health.totalRuns,
    claimedJobs: health.claimedJobs,
    consecutiveFailures: health.consecutiveFailures,
    lastRunAgeMs: health.lastRunAgeMs,
    queue: health.queue,
  };
}

function boundedPositiveInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
