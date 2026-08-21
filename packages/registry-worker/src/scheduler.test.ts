import { describe, expect, it, vi } from "vitest";
import type { RegistryScanQueueStats } from "@agentcargo/registry-db";
import type { RegistryWorkerRunResult, RegistryReleaseWorker } from "./index.js";
import { RegistryReleaseWorkerScheduler, registryWorkerStatusSource } from "./scheduler.js";

const idleResult: RegistryWorkerRunResult = { enqueued: 0, claimed: false };

function fakeWorker(
  runOnce: () => Promise<RegistryWorkerRunResult>,
  queueStats?: () => Promise<RegistryScanQueueStats>,
): RegistryReleaseWorker {
  return { runOnce, queueStats: queueStats ?? (async () => ({ queued: 0, failed: 0, running: 0, staleLeases: 0, oldestAvailableAt: null })) } as unknown as RegistryReleaseWorker;
}

describe("RegistryReleaseWorkerScheduler", () => {
  it("deduplicates concurrent cycles and drains the active lease on stop", async () => {
    let releaseRun!: () => void;
    let calls = 0;
    const gate = new Promise<void>((resolve) => { releaseRun = resolve; });
    const scheduler = new RegistryReleaseWorkerScheduler(fakeWorker(async () => {
      calls += 1;
      await gate;
      return idleResult;
    }), { intervalMs: 100 });

    const first = scheduler.runNow();
    const second = scheduler.runNow();
    expect(second).toBe(first);
    expect(calls).toBe(1);
    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseRun();
    await stopping;
    expect(stopped).toBe(true);
    expect(scheduler.state).toBe("stopped");
    expect(calls).toBe(1);
  });

  it("starts immediately, repeats on a bounded interval, and stops without another claim", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const scheduler = new RegistryReleaseWorkerScheduler(fakeWorker(async () => {
        calls += 1;
        return idleResult;
      }), { intervalMs: 100 });

      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      expect(calls).toBe(3);
      await scheduler.stop();
      await vi.advanceTimersByTimeAsync(500);
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails readiness after repeated worker errors without exposing error text", async () => {
    const clock = new Date("2026-08-20T00:00:00.000Z");
    const scheduler = new RegistryReleaseWorkerScheduler(fakeWorker(async () => {
      throw new Error("secret package contents must not appear in health");
    }), { now: () => new Date(clock), maxConsecutiveFailures: 1 });

    await expect(scheduler.runNow()).rejects.toThrow("worker cycle failed");
    const health = scheduler.health(clock);
    expect(health.state).toBe("degraded");
    expect(health.lastError).toBe("The worker cycle failed before completion.");
    expect(health.lastError).not.toContain("secret");
    expect(scheduler.readiness(clock)).toMatchObject({ ready: false, reason: "failure-threshold" });
    await scheduler.stop();
  });

  it("reports queue lag and stale leases as bounded operational health", async () => {
    const now = new Date("2026-08-20T00:10:00.000Z");
    const scheduler = new RegistryReleaseWorkerScheduler(fakeWorker(
      async () => idleResult,
      async () => ({ queued: 2, failed: 1, running: 1, staleLeases: 1, oldestAvailableAt: "2026-08-20T00:00:00.000Z" }),
    ), { now: () => new Date(now), maxQueueLagMs: 1_000 });

    await scheduler.runNow();
    expect(scheduler.health(now).queue).toMatchObject({ queued: 2, failed: 1, running: 1, staleLeases: 1, lagMs: 600_000 });
    expect(scheduler.readiness(now)).toMatchObject({ ready: false, reason: "queue-lag" });
    await scheduler.stop();
  });

  it("adapts readiness to a package-free API status source", async () => {
    const now = new Date("2026-08-20T00:10:00.000Z");
    const scheduler = new RegistryReleaseWorkerScheduler(fakeWorker(
      async () => idleResult,
      async () => ({ queued: 1, failed: 0, running: 0, staleLeases: 0, oldestAvailableAt: null }),
    ), { now: () => new Date(now) });

    const beforeRun = registryWorkerStatusSource(scheduler, now);
    expect(beforeRun).toMatchObject({ status: "degraded", ready: false, reason: "stopped", queue: null });
    await scheduler.runNow();
    const afterRun = registryWorkerStatusSource(scheduler, now);
    expect(afterRun).toMatchObject({ status: "operational", ready: true, totalRuns: 1, claimedJobs: 0, queue: { queued: 1, lagMs: 0 } });
    await scheduler.stop();
  });
});
