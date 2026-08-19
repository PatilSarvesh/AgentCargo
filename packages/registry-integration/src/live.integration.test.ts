import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { RegistryRelease } from "@agentcargo/registry-contract";
import { digestBytes } from "@agentcargo/registry-storage";
import type { LiveRegistryIntegrationEnvironmentFactory } from "./index.js";

const adapterPath = process.env.AGENTCARGO_REGISTRY_INTEGRATION_MODULE;
const integration = adapterPath ? describe : describe.skip;

integration("live PostgreSQL and object-store registry path", () => {
  let environment: Awaited<ReturnType<LiveRegistryIntegrationEnvironmentFactory>>;

  afterAll(async () => {
    await environment?.close();
  });

  it("activates, resolves, and downloads one immutable release", async () => {
    const module = (await import(pathToFileURL(adapterPath!).href)) as {
      createEnvironment: LiveRegistryIntegrationEnvironmentFactory;
    };
    environment = await module.createEnvironment();

    const namespace = await environment.namespaceRepository.claimNamespace({
      actor: { provider: "github", subject: "integration-fixture", login: "integration" },
      namespace: "integration",
    });
    const reservationInput = {
      actor: { provider: "github" as const, subject: "integration-fixture" },
      coordinate: { namespace: "integration", name: "live-check", version: "2.0.0" },
      idempotencyKey: "integration-publish-1",
    };
    const reservation = await environment.reservationRepository.reserveRelease(reservationInput);
    const replay = await environment.reservationRepository.reserveRelease(reservationInput);
    expect(namespace).toEqual({ namespace: "integration", created: true });
    expect(reservation.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, reservation: { releaseId: reservation.reservation.releaseId } });

    const body = new TextEncoder().encode("live-agentcargo-artifact");
    const digest = digestBytes(body);
    const stored = await environment.storage.put(digest, body);
    const release = makeRelease(digest);
    await environment.activateRelease({
      ...release,
      artifact: { ...release.artifact, digest: stored.digest },
    });

    const resolved = await environment.repository.getRelease(release.coordinate);
    expect(resolved).not.toBeNull();
    expect(resolved?.artifact.digest).toBe(digest);
    expect(resolved?.artifact.download.url).toMatch(/^https?:\/\//);

    const downloaded = await environment.download(resolved!.artifact.download.url);
    expect(digestBytes(downloaded)).toBe(digest);

    // A rerun must preserve the already-uploaded digest object while replacing
    // only the fixture's database projection.
    await environment.storage.put(digest, body);
    await environment.activateRelease(release);
    const retried = await environment.repository.getRelease(release.coordinate);
    expect(retried).not.toBeNull();
    const retriedBytes = await environment.download(retried!.artifact.download.url);
    expect(digestBytes(retriedBytes)).toBe(digest);
  });
});

function makeRelease(digest: `sha256:${string}`): RegistryRelease {
  return {
    apiVersion: "v1",
    coordinate: { namespace: "integration", name: "live-check", version: "1.0.0" },
    status: "active",
    declared: {
      description: "Live registry integration fixture.",
      tags: ["integration"],
      compatibility: { codex: { scopes: ["project"] } },
    },
    artifact: {
      format: "agentcargo-ustar-v1",
      mediaType: "application/vnd.agentcargo.ustar-v1",
      digest,
      bytes: 24,
      download: { url: "https://placeholder.invalid/artifact", expiresAt: "2026-08-13T00:00:00.000Z" },
    },
    files: [{ path: "SKILL.md", bytes: 24, executable: false, scriptLike: false }],
    scan: { scannerVersion: "integration", completedAt: "2026-08-13T00:00:00.000Z", findings: [] },
    source: {},
    publishedAt: "2026-08-13T00:00:00.000Z",
  };
}
