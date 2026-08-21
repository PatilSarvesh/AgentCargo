import { describe, expect, it } from "vitest";
import {
  InMemoryRegistryReleaseRepository,
  InMemoryRegistryModerationRepository,
  InMemoryRegistryReleaseReservationRepository,
  PostgresRegistryNamespaceRepository,
  PostgresRegistryPublisherWorkspaceRepository,
  PostgresRegistryReleaseReservationRepository,
  PostgresRegistryReleaseScanRepository,
  PostgresRegistryScanJobRepository,
  PostgresRegistryReleaseUploadRepository,
  PostgresRegistryReleaseRepository,
  PostgresRegistryModerationRepository,
  PostgresRegistryOAuthStateStore,
  PostgresRegistrySessionStore,
  type RegistrySqlClient,
} from "./index.js";
import type { RegistryRelease } from "@agentcargo/registry-contract";

const release = makeRelease("1.2.3");

describe("registry release repositories", () => {
  it("filters and paginates public in-memory releases", async () => {
    const repository = new InMemoryRegistryReleaseRepository([release, makeRelease("1.3.0", "other")]);

    const result = await repository.search({ query: "review", host: "codex", scope: "project", limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.package).toEqual({ namespace: "acme", name: "review" });
  });

  it("returns exact releases without exposing the repository-owned object", async () => {
    const repository = new InMemoryRegistryReleaseRepository([release]);
    const result = await repository.getRelease({ namespace: "acme", name: "review", version: "1.2.3" });

    expect(result).toEqual(release);
    expect(result).not.toBe(release);
  });

  it("overlays mutable public status while filtering quarantined releases", async () => {
    const queries: string[] = [];
    const client: RegistrySqlClient = {
      async query<Row>(text: string) {
        queries.push(text);
        return { rows: [{ release_json: release, artifact_key: "sha256/a", status: "deprecated" }] as Row[] };
      },
    };
    const repository = new PostgresRegistryReleaseRepository(client, async () => ({
      url: "https://storage.example.test/sha256/a",
      expiresAt: "2026-08-13T00:05:00.000Z",
    }));
    const deprecated = await repository.getRelease({ namespace: "acme", name: "review", version: "1.2.3" });
    expect(deprecated?.status).toBe("deprecated");
    expect(queries[0]).toContain("status IN ('active', 'deprecated')");

    const hiddenRepository = new PostgresRegistryReleaseRepository({
      async query<Row>() { return { rows: [] as Row[] }; },
    }, async () => ({ url: "https://storage.example.test/hidden", expiresAt: "2026-08-13T00:05:00.000Z" }));
    await expect(hiddenRepository.getRelease({ namespace: "acme", name: "review", version: "9.9.9" })).resolves.toBeNull();
  });

  it("uses parameterized SQL and supplies a request-scoped artifact URL", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        return { rows: [{ release_json: release, artifact_key: "sha256/a" }] as Row[] };
      },
    };
    const repository = new PostgresRegistryReleaseRepository(client, async ({ artifactKey }) => ({
      url: `https://storage.example.test/${artifactKey}`,
      expiresAt: "2026-08-13T00:05:00.000Z",
    }));

    const result = await repository.getRelease({ namespace: "acme", name: "review", version: "1.2.3" });

    expect(queries[0]!.text).toContain("status IN ('active', 'deprecated')");
    expect(queries[0]!.text).toContain("$1 AND name = $2 AND version = $3");
    expect(queries[0]!.values).toEqual(["acme", "review", "1.2.3"]);
    expect(result?.artifact.download.url).toBe("https://storage.example.test/sha256/a");
  });

  it("uses full-text and trigram ranking for PostgreSQL search", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        return { rows: [{ package_json: {
          apiVersion: "v1",
          package: { namespace: "acme", name: "review" },
          description: "Review code changes.",
          latestVersion: "1.2.3",
          compatibility: { codex: { scopes: ["project"] } },
          tags: ["review"],
          hasScripts: false,
          status: "active",
        } }] as Row[] };
      },
    };
    const repository = new PostgresRegistryReleaseRepository(client, async () => ({
      url: "https://storage.example.test/unused",
      expiresAt: "2026-08-13T00:05:00.000Z",
    }));

    const result = await repository.search({ query: "review", host: "codex", scope: "project", limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(queries[0]!.text).toContain("search_text @@ plainto_tsquery('simple', $1)");
    expect(queries[0]!.text).toContain("search_document % lower($1)");
    expect(queries[0]!.text).toContain("similarity(search_document, lower($1))");
    expect(queries[0]!.values).toEqual(["review", "codex", "project", 10]);
  });

  it("rejects invalid database rows before serving them", async () => {
    const client: RegistrySqlClient = {
      async query<Row>() {
        return { rows: [{ release_json: { ...release, artifact: { ...release.artifact, digest: "invalid" } }, artifact_key: "bad" }] as Row[] };
      },
    };
    const repository = new PostgresRegistryReleaseRepository(client, async () => ({
      url: "https://storage.example.test/bad",
      expiresAt: "2026-08-13T00:05:00.000Z",
    }));

    await expect(repository.getRelease({ namespace: "acme", name: "review", version: "1.2.3" })).rejects.toMatchObject({
      code: "REGISTRY_ROW_INVALID",
    });
  });

  it("never reuses a reserved coordinate and scopes idempotency to the publisher", async () => {
    const repository = new InMemoryRegistryReleaseReservationRepository();
    const input = {
      actor: { provider: "github" as const, subject: "publisher-1" },
      coordinate: { namespace: "acme", name: "review", version: "2.0.0" },
      idempotencyKey: "publish-1",
      now: new Date("2026-08-14T00:00:00.000Z"),
    };

    const first = await repository.reserveRelease(input);
    const replay = await repository.reserveRelease(input);

    expect(first.replayed).toBe(false);
    expect(first.reservation.expiresAt).toBe("2026-08-14T00:30:00.000Z");
    expect(replay.replayed).toBe(true);
    expect(replay.reservation.releaseId).toBe(first.reservation.releaseId);
    await expect(repository.reserveRelease({ ...input, idempotencyKey: "publish-2" })).rejects.toMatchObject({
      code: "REGISTRY_RELEASE_VERSION_RESERVED",
    });
    await expect(repository.reserveRelease({ ...input, actor: { provider: "github", subject: "publisher-2" } })).rejects.toMatchObject({
      code: "REGISTRY_RELEASE_VERSION_RESERVED",
    });
    await expect(repository.reserveRelease({ ...input, coordinate: { ...input.coordinate, version: "2.1.0" } })).rejects.toMatchObject({
      code: "REGISTRY_IDEMPOTENCY_CONFLICT",
    });
  });

  it("claims namespaces durably and refuses another publisher", async () => {
    const queries: string[] = [];
    let inserted = false;
    const client: RegistrySqlClient = {
      async query<Row>(text: string) {
        queries.push(text);
        if (text.includes("INSERT INTO registry_namespaces")) {
          if (!inserted) {
            inserted = true;
            return { rows: [{ namespace: "acme" }] as Row[] };
          }
          return { rows: [] as Row[] };
        }
        if (text.includes("SELECT namespace, owner_provider")) {
          return { rows: [{ namespace: "acme", owner_provider: "github", owner_subject: "publisher-1" }] as Row[] };
        }
        return { rows: [] as Row[] };
      },
    };
    const repository = new PostgresRegistryNamespaceRepository(client);
    const actor = { provider: "github" as const, subject: "publisher-1", login: "acme" };

    await expect(repository.claimNamespace({ actor, namespace: "acme", now: new Date("2026-08-14T00:00:00.000Z") })).resolves.toEqual({
      namespace: "acme",
      created: true,
    });
    await expect(repository.claimNamespace({ actor, namespace: "acme" })).resolves.toEqual({ namespace: "acme", created: false });
    await expect(
      repository.claimNamespace({ actor: { provider: "github", subject: "publisher-2" }, namespace: "acme" }),
    ).rejects.toMatchObject({ code: "REGISTRY_NAMESPACE_OWNED" });
    expect(queries.some((text) => text.includes("ON CONFLICT (provider, subject) DO UPDATE"))).toBe(true);
  });

  it("loads only the authenticated publisher's namespaces and immutable version history", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const digest = `sha256:${"a".repeat(64)}`;
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        return { rows: [{
          namespace: "acme",
          release_id: "release-2",
          name: "review",
          version: "1.1.0",
          reservation_created_at: "2026-08-15T01:00:00.000Z",
          expires_at: "2026-08-15T01:30:00.000Z",
          upload_status: "scanning",
          digest,
          completed_at: "2026-08-15T01:02:00.000Z",
          public_status: null,
          published_at: null,
        }, {
          namespace: "acme",
          release_id: "release-1",
          name: "review",
          version: "1.0.0",
          reservation_created_at: "2026-08-15T00:00:00.000Z",
          expires_at: "2026-08-15T00:30:00.000Z",
          upload_status: "scanning",
          digest,
          completed_at: "2026-08-15T00:01:00.000Z",
          public_status: "active",
          published_at: "2026-08-15T00:02:00.000Z",
        }, {
          namespace: "empty-space",
          release_id: null,
          name: null,
          version: null,
          reservation_created_at: null,
          expires_at: null,
          upload_status: null,
          digest: null,
          completed_at: null,
          public_status: null,
          published_at: null,
        }] as Row[] };
      },
    };
    const repository = new PostgresRegistryPublisherWorkspaceRepository(client, {
      now: () => Date.parse("2026-08-15T01:05:00.000Z"),
    });

    const workspace = await repository.getWorkspace({ provider: "github", subject: "publisher-1", login: "acme" });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.text).toContain("WHERE namespaces.owner_provider = $1 AND namespaces.owner_subject = $2");
    expect(queries[0]!.values).toEqual(["github", "publisher-1"]);
    expect(workspace.namespaces).toHaveLength(2);
    expect(workspace.namespaces[0]).toMatchObject({
      namespace: "acme",
      packages: [{
        package: { namespace: "acme", name: "review" },
        latestVersion: "1.0.0",
        releases: [{ version: "1.1.0", status: "scanning" }, { version: "1.0.0", status: "active" }],
      }],
    });
    expect(workspace.namespaces[1]).toEqual({ namespace: "empty-space", packages: [] });
  });

  it("persists only hashed opaque sessions and resolves or revokes them durably", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    let revoked = false;
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        if (text.includes("SELECT sessions.provider")) {
          return {
            rows: (revoked ? [] : [{
              provider: "github",
              subject: "publisher-1",
              login: "acme",
              scopes: ["publisher:read", "publisher:write"],
              expires_at: "2026-08-15T00:02:00.000Z",
            }]) as Row[],
          };
        }
        if (text.includes("UPDATE registry_auth_sessions")) {
          if (revoked) return { rows: [] as Row[] };
          revoked = true;
          return { rows: [{ token_digest: values[0] }] as Row[] };
        }
        return { rows: [] as Row[] };
      },
    };
    let now = Date.parse("2026-08-15T00:00:00.000Z");
    const store = new PostgresRegistrySessionStore(client, { now: () => now, ttlSeconds: 120 });
    const session = await store.issue({ provider: "github", subject: "publisher-1", login: "acme" });

    expect(session.expiresAt).toBe("2026-08-15T00:02:00.000Z");
    expect(session.scopes).toEqual(["publisher:read", "publisher:write"]);
    expect(queries.some(({ text }) => text.includes("INSERT INTO registry_auth_sessions"))).toBe(true);
    expect(queries.flatMap(({ values }) => values)).not.toContain(session.accessToken);
    const digest = queries.find(({ text }) => text.includes("INSERT INTO registry_auth_sessions"))?.values[0];
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(queries.find(({ text }) => text.includes("INSERT INTO registry_auth_sessions"))?.values).toContainEqual(["publisher:read", "publisher:write"]);
    expect(await store.resolve(session.accessToken)).toEqual({ provider: "github", subject: "publisher-1", login: "acme" });
    expect(await store.resolveContext(session.accessToken)).toMatchObject({ scopes: ["publisher:read", "publisher:write"] });
    expect(await store.inspect(session.accessToken)).toEqual({
      expiresAt: "2026-08-15T00:02:00.000Z",
      scopes: ["publisher:read", "publisher:write"],
    });
    expect(await store.revoke(session.accessToken)).toBe(true);
    expect(await store.revoke(session.accessToken)).toBe(false);
    now += 120_000;
    expect(await store.resolve(session.accessToken)).toBeNull();
  });

  it("stores redirect-bound OAuth callback state as a one-time database record", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    let consumed = false;
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        if (text.includes("DELETE FROM registry_oauth_state") && !consumed) {
          consumed = true;
          return {
            rows: [{
              code_verifier: "verifier_value_123456",
              redirect_uri: "https://registry.example.test/auth/github/callback",
              expires_at: "2026-08-15T00:01:00.000Z",
            }] as Row[],
          };
        }
        return { rows: [] as Row[] };
      },
    };
    const store = new PostgresRegistryOAuthStateStore(client, {
      now: () => Date.parse("2026-08-15T00:00:00.000Z"),
      ttlSeconds: 60,
    });
    const state = "state_value_abcdefghijklmnopqrstuvwxyz";
    const verifier = "verifier_value_123456";
    await expect(store.remember(
      { state, codeVerifier: verifier },
      "https://registry.example.test/auth/github/callback",
    )).resolves.toEqual({ expiresAt: "2026-08-15T00:01:00.000Z" });
    const insertValues = queries.find(({ text }) => text.includes("INSERT INTO registry_oauth_state"))?.values ?? [];
    expect(insertValues).not.toContain(state);
    expect(insertValues).toContain(verifier);
    expect(insertValues[0]).toMatch(/^[a-f0-9]{64}$/);
    await expect(store.consume(state, "https://registry.example.test/auth/github/callback")).resolves.toEqual({
      codeVerifier: verifier,
    });
    await expect(store.consume(state, "https://registry.example.test/auth/github/callback")).resolves.toBeNull();
  });

  it("uses PostgreSQL uniqueness for durable reservations and replays", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    let firstInsert = true;
    const row = {
      release_id: "release-1",
      namespace: "acme",
      name: "review",
      version: "2.0.0",
      created_at: "2026-08-14T00:00:00.000Z",
      expires_at: "2026-08-14T00:30:00.000Z",
    };
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        if (text.includes("SELECT namespace") && text.includes("owner_provider")) return { rows: [{ namespace: "acme" }] as Row[] };
        if (text.includes("INSERT INTO registry_release_reservations")) {
          return { rows: (firstInsert ? [row] : []) as Row[] };
        }
        if (text.includes("publisher_provider = $1")) return { rows: [row] as Row[] };
        return { rows: [] as Row[] };
      },
    };
    const repository = new PostgresRegistryReleaseReservationRepository(client);
    const input = {
      actor: { provider: "github" as const, subject: "publisher-1" },
      coordinate: { namespace: "acme", name: "review", version: "2.0.0" },
      idempotencyKey: "publish-1",
      now: new Date("2026-08-14T00:00:00.000Z"),
    };

    const first = await repository.reserveRelease(input);
    firstInsert = false;
    const replay = await repository.reserveRelease(input);

    expect(first).toMatchObject({ replayed: false, reservation: { releaseId: "release-1", status: "reserved" } });
    expect(replay).toMatchObject({ replayed: true, reservation: { releaseId: "release-1" } });
    expect(queries.some(({ text }) => text.includes("ON CONFLICT DO NOTHING"))).toBe(true);
    expect(queries.some(({ text, values }) => text.includes("idempotency_key") && values.includes("publish-1"))).toBe(true);
  });

  it("reports namespace absence and ownership before inserting a reservation", async () => {
    const makeClient = (namespaceExists: boolean): RegistrySqlClient => ({
      async query<Row>(text: string) {
        if (text.includes("SELECT namespace") && text.includes("owner_provider")) return { rows: [] as Row[] };
        if (text.includes("SELECT namespace FROM registry_namespaces")) return { rows: (namespaceExists ? [{ namespace: "acme" }] : []) as Row[] };
        return { rows: [] as Row[] };
      },
    });
    const input = {
      actor: { provider: "github" as const, subject: "publisher-2" },
      coordinate: { namespace: "acme", name: "review", version: "2.0.0" },
      idempotencyKey: "publish-1",
    };

    await expect(new PostgresRegistryReleaseReservationRepository(makeClient(true)).reserveRelease(input)).rejects.toMatchObject({
      code: "REGISTRY_NAMESPACE_FORBIDDEN",
    });
    await expect(new PostgresRegistryReleaseReservationRepository(makeClient(false)).reserveRelease(input)).rejects.toMatchObject({
      code: "REGISTRY_NAMESPACE_NOT_FOUND",
    });
  });

  it("records an immutable artifact upload intent and idempotent scanning completion", async () => {
    const queries: string[] = [];
    const reservationRow = {
      release_id: "release-upload-1",
      namespace: "acme",
      name: "review",
      version: "2.0.0",
      created_at: "2026-08-15T00:00:00.000Z",
      expires_at: "2026-08-15T00:30:00.000Z",
    };
    const completionRequest = {
      artifact: {
        format: "agentcargo-ustar-v1" as const,
        mediaType: "application/vnd.agentcargo.ustar-v1" as const,
        digest: `sha256:${"a".repeat(64)}` as `sha256:${string}`,
        bytes: 256,
      },
      declared: { description: "Review code changes.", tags: ["review"], compatibility: { codex: { scopes: ["project"] as const } } },
      files: [{ path: "SKILL.md", bytes: 128, executable: false, scriptLike: false }],
      scan: { scannerVersion: "rules-1", completedAt: "2026-08-15T00:00:00.000Z", findings: [] },
      source: { repositoryUrl: "https://github.com/acme/review", commit: "abc123" },
    };
    let uploadRow: Record<string, unknown> | undefined;
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push(text);
        if (text.includes("FROM registry_release_reservations") && text.includes("publisher_provider")) {
          return { rows: [reservationRow] as Row[] };
        }
        if (text.includes("INSERT INTO registry_release_uploads")) {
          if (uploadRow) return { rows: [] as Row[] };
          uploadRow = {
            ...reservationRow,
            digest: values[1],
            artifact_key: values[2],
            format: values[3],
            media_type: values[4],
            bytes: values[5],
            upload_status: "reserved",
            completion_json: null,
            completed_at: null,
          };
          return { rows: [uploadRow] as Row[] };
        }
        if (text.includes("FROM registry_release_uploads AS uploads") && text.includes("JOIN registry_release_reservations")) {
          return { rows: (uploadRow ? [uploadRow] : []) as Row[] };
        }
        if (text.includes("INSERT INTO registry_artifacts")) return { rows: [] as Row[] };
        if (text.includes("SELECT digest, artifact_key, format, media_type, bytes")) {
          return {
            rows: [{ digest, artifact_key: `artifacts/sha256/aa/${"a".repeat(64)}.agentcargo`, format: "agentcargo-ustar-v1", media_type: "application/vnd.agentcargo.ustar-v1", bytes: 256 }] as Row[],
          };
        }
        if (text.includes("UPDATE registry_release_uploads")) {
          if (!uploadRow) return { rows: [] as Row[] };
          uploadRow = { ...uploadRow, upload_status: "scanning", completion_json: JSON.parse(String(values[1])), completed_at: values[2] };
          return { rows: [uploadRow] as Row[] };
        }
        return { rows: [] as Row[] };
      },
    };
    const repository = new PostgresRegistryReleaseUploadRepository(client);
    const actor = { provider: "github" as const, subject: "publisher-1" };
    const digest = completionRequest.artifact.digest;
    const firstUpload = await repository.reserveArtifactUpload({ actor, releaseId: reservationRow.release_id, digest, bytes: 256 });
    const replayUpload = await repository.reserveArtifactUpload({ actor, releaseId: reservationRow.release_id, digest, bytes: 256 });
    const firstCompletion = await repository.completeRelease({
      actor,
      releaseId: reservationRow.release_id,
      artifactKey: `artifacts/sha256/aa/${"a".repeat(64)}.agentcargo`,
      request: completionRequest,
      now: new Date("2026-08-15T00:01:00.000Z"),
    });
    const replayCompletion = await repository.completeRelease({
      actor,
      releaseId: reservationRow.release_id,
      artifactKey: `artifacts/sha256/aa/${"a".repeat(64)}.agentcargo`,
      request: completionRequest,
      now: new Date("2026-08-15T00:02:00.000Z"),
    });

    expect(firstUpload.replayed).toBe(false);
    expect(replayUpload.replayed).toBe(true);
    expect(firstCompletion.completion.status).toBe("scanning");
    expect(firstCompletion.replayed).toBe(false);
    expect(replayCompletion.replayed).toBe(true);
    expect(queries.some((text) => text.includes("completion_json"))).toBe(true);
  });

  it("leases durable scan jobs and reads only completed scanning releases", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const completion = {
      artifact: {
        format: "agentcargo-ustar-v1" as const,
        mediaType: "application/vnd.agentcargo.ustar-v1" as const,
        digest: `sha256:${"b".repeat(64)}` as `sha256:${string}`,
        bytes: 512,
      },
      declared: { description: "Scan me.", tags: [], compatibility: {} },
      files: [{ path: "SKILL.md", bytes: 512, executable: false, scriptLike: false }],
      scan: { scannerVersion: "client", completedAt: "2026-08-15T00:00:00.000Z", findings: [] },
      source: {},
    };
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        if (text.includes("SELECT uploads.release_id") && text.includes("NOT EXISTS")) {
          return { rows: [{ release_id: "release-scan-1" }] as Row[] };
        }
        if (text.includes("INSERT INTO registry_scan_jobs")) {
          return { rows: [{ job_id: values[0] }] as Row[] };
        }
        if (text.includes("WITH candidate AS")) {
          return { rows: [{ job_id: "job-scan-1", release_id: "release-scan-1", status: "running", attempts: 1, lease_until: "2026-08-15T00:05:00.000Z" }] as Row[] };
        }
        if (text.includes("FROM registry_release_uploads AS uploads") && text.includes("uploads.status = 'scanning'")) {
          return { rows: [{ release_id: "release-scan-1", namespace: "acme", name: "scan", version: "1.0.0", artifact_key: "artifacts/sha256/bb/placeholder.agentcargo", completion_json: completion }] as Row[] };
        }
        if (text.includes("UPDATE registry_scan_jobs")) return { rows: [{ job_id: "job-scan-1" }] as Row[] };
        return { rows: [] as Row[] };
      },
    };
    const jobs = new PostgresRegistryScanJobRepository(client);
    expect(await jobs.enqueuePending(new Date("2026-08-15T00:00:00.000Z"))).toBe(1);
    await expect(jobs.claim(new Date("2026-08-15T00:00:00.000Z"))).resolves.toMatchObject({ jobId: "job-scan-1", releaseId: "release-scan-1" });
    await jobs.succeed("job-scan-1", completion.scan);
    const release = await new PostgresRegistryReleaseScanRepository(client, { isDigestDenylisted: async () => false }).getForScan("release-scan-1");
    expect(release).toMatchObject({ releaseId: "release-scan-1", coordinate: { namespace: "acme", name: "scan", version: "1.0.0" }, completion });
    expect(queries.some(({ text }) => text.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
  });

  it("reports bounded queue counters and stale lease lag without package data", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        if (text.includes("COUNT(*) FILTER")) {
          return {
            rows: [{ queued: "2", failed: "1", running: "3", stale_leases: "1", oldest_available_at: "2026-08-15T00:00:00.000Z" }] as Row[],
          };
        }
        return { rows: [] as Row[] };
      },
    };
    const now = new Date("2026-08-15T00:05:00.000Z");
    const stats = await new PostgresRegistryScanJobRepository(client).getQueueStats(now);
    expect(stats).toEqual({ queued: 2, failed: 1, running: 3, staleLeases: 1, oldestAvailableAt: "2026-08-15T00:00:00.000Z" });
    expect(queries[0]!.values).toEqual([now.toISOString()]);
    expect(queries[0]!.text).not.toContain("completion_json");
  });

  it("activates a validated release only for its matching scanning reservation", async () => {
    const queries: string[] = [];
    const client: RegistrySqlClient = {
      async query<Row>(text: string) {
        queries.push(text);
        if (text.includes("FROM registry_release_uploads AS uploads") && text.includes("uploads.status = 'scanning'")) {
          return { rows: [{ namespace: release.coordinate.namespace, name: release.coordinate.name, version: release.coordinate.version }] as Row[] };
        }
        if (text.includes("INSERT INTO registry_public_releases")) return { rows: [{ namespace: release.coordinate.namespace }] as Row[] };
        return { rows: [] as Row[] };
      },
    };
    await expect(new PostgresRegistryReleaseScanRepository(client, { isDigestDenylisted: async () => false }).activate("release-activate-1", release)).resolves.toBeUndefined();
    expect(queries.some((text) => text.includes("INSERT INTO registry_public_releases"))).toBe(true);
    expect(queries.some((text) => text.includes("INSERT INTO registry_public_packages"))).toBe(true);
  });

  it("keeps in-memory reports idempotent and paginates append-only audit events", async () => {
    const repository = new InMemoryRegistryModerationRepository();
    const input = {
      actor: { provider: "github" as const, subject: "reporter-1" },
      request: {
        target: { package: { namespace: "acme", name: "review" }, releaseVersion: "1.2.3" },
        category: "malware" as const,
        evidence: "Suspicious script behavior.",
        idempotencyKey: "report-1",
      },
      requestId: "request-1",
      now: new Date("2026-08-15T00:00:00.000Z"),
    };

    const first = await repository.createReport(input);
    const replay = await repository.createReport(input);

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, report: { reportId: first.report.reportId } });
    await expect(repository.createReport({
      ...input,
      request: { ...input.request, evidence: "Different evidence." },
    })).rejects.toMatchObject({ code: "REGISTRY_REPORT_IDEMPOTENCY_CONFLICT" });

    const audit = await repository.listAuditEvents({ limit: 1 });
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]).toMatchObject({
      action: "report_created",
      actor: { kind: "publisher", identity: input.actor },
      target: { type: "report", reportId: first.report.reportId },
    });
    expect(audit.nextCursor).toBeUndefined();
  });

  it("persists reports with PostgreSQL idempotency and maps audit rows safely", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const reportRow = {
      report_id: "report-1",
      namespace: "acme",
      name: "review",
      release_version: "1.2.3",
      category: "malware" as const,
      status: "open" as const,
      evidence: "Suspicious script behavior.",
      created_at: "2026-08-15T00:00:00.000Z",
      updated_at: "2026-08-15T00:00:00.000Z",
    };
    let insertAttempt = 0;
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        if (text.includes("WITH inserted AS")) {
          insertAttempt += 1;
          return { rows: (insertAttempt === 1 ? [reportRow] : []) as Row[] };
        }
        if (text.includes("FROM registry_reports")) {
          return { rows: [{ ...reportRow, reporter_provider: "github", reporter_subject: "reporter-1", idempotency_key: "report-1" }] as Row[] };
        }
        if (text.includes("FROM registry_moderation_audit_events")) {
          return {
            rows: [{
              event_id: "event-1",
              action: "report_created" as const,
              actor_kind: "publisher" as const,
              actor_provider: "github",
              actor_subject: "reporter-1",
              target_type: "report" as const,
              target_report_id: "report-1",
              target_namespace: null,
              target_name: null,
              target_version: null,
              target_digest: null,
              occurred_at: "2026-08-15T00:00:00.000Z",
              request_id: "request-1",
              metadata_json: { category: "malware", targetType: "release" },
            }] as Row[],
          };
        }
        return { rows: [] as Row[] };
      },
    };
    const repository = new PostgresRegistryModerationRepository(client);
    const input = {
      actor: { provider: "github" as const, subject: "reporter-1" },
      request: {
        target: { package: { namespace: "acme", name: "review" }, releaseVersion: "1.2.3" },
        category: "malware" as const,
        evidence: "Suspicious script behavior.",
        idempotencyKey: "report-1",
      },
      requestId: "request-1",
      now: new Date("2026-08-15T00:00:00.000Z"),
    };

    const first = await repository.createReport(input);
    const replay = await repository.createReport(input);
    const audit = await repository.listAuditEvents({ limit: 10 });

    expect(first).toMatchObject({ replayed: false, report: { reportId: "report-1", status: "open" } });
    expect(replay).toMatchObject({ replayed: true, report: { reportId: "report-1" } });
    expect(audit.items[0]).toMatchObject({
      eventId: "event-1",
      action: "report_created",
      target: { type: "report", reportId: "report-1" },
      metadata: { category: "malware", targetType: "release" },
    });
    const insertQuery = queries.find(({ text }) => text.includes("WITH inserted AS"));
    expect(insertQuery?.text).toContain("ON CONFLICT (reporter_provider, reporter_subject, idempotency_key) DO NOTHING");
    expect(insertQuery?.text).toContain("registry_moderation_audit_events");
    expect(insertQuery?.values).toContain("Suspicious script behavior.");
    expect(queries.some(({ text, values }) => text.includes("ORDER BY occurred_at DESC") && values[0] === 11)).toBe(true);
  });

  it("guards in-memory deprecation, quarantine, and restoration transitions", async () => {
    const coordinate = { namespace: "acme", name: "review", version: "1.2.3" } as const;
    const repository = new InMemoryRegistryModerationRepository({
      releases: [{ coordinate, status: "active" }],
      releaseOwners: { acme: "github:publisher-1" },
    });
    const base = {
      actor: { provider: "github" as const, subject: "publisher-1" },
      actorKind: "publisher" as const,
      coordinate,
      requestId: "moderation-request-1",
      request: { reason: "The publisher superseded this release.", idempotencyKey: "moderate-1" },
      now: new Date("2026-08-15T00:00:00.000Z"),
    };

    const deprecated = await repository.moderateRelease({ ...base, operation: "deprecate" });
    const replay = await repository.moderateRelease({ ...base, operation: "deprecate" });
    expect(deprecated).toMatchObject({ replayed: false, response: { operation: "deprecate", status: "deprecated" } });
    expect(replay).toMatchObject({ replayed: true, response: { auditEventId: deprecated.response.auditEventId } });
    await expect(repository.moderateRelease({
      ...base,
      actor: { provider: "github", subject: "other-publisher" },
      operation: "quarantine",
      request: { ...base.request, idempotencyKey: "moderate-2" },
    })).resolves.toMatchObject({ response: { status: "quarantined" } });
    await expect(repository.moderateRelease({
      ...base,
      actor: { provider: "github", subject: "maintainer-1" },
      actorKind: "maintainer",
      operation: "unquarantine",
      request: { ...base.request, idempotencyKey: "moderate-3" },
    })).resolves.toMatchObject({ response: { status: "deprecated" } });
    await expect(repository.moderateRelease({
      ...base,
      actor: { provider: "github", subject: "other-publisher" },
      operation: "deprecate",
      request: { ...base.request, idempotencyKey: "moderate-4" },
    })).rejects.toMatchObject({ code: "REGISTRY_RELEASE_MODERATION_FORBIDDEN" });

    const audit = await repository.listAuditEvents({ limit: 10 });
    expect(audit.items.map((event) => event.action)).toEqual([
      "release_unquarantined",
      "release_quarantined",
      "release_deprecated",
    ]);
  });

  it("uses a guarded PostgreSQL transition and replays the immutable moderation event", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    let firstTransition = true;
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        if (text.includes("WITH updated AS")) {
          return {
            rows: (firstTransition ? [{
              namespace: "acme",
              name: "review",
              version: "1.2.3",
              status: "deprecated" as const,
              changed_at: "2026-08-15T00:00:00.000Z",
              audit_event_id: "event-deprecate-1",
            }] : []) as Row[],
          };
        }
        if (text.includes("target_type = 'release'")) {
          return { rows: [{ event_id: "event-deprecate-1", action: "release_deprecated" as const, occurred_at: "2026-08-15T00:00:00.000Z" }] as Row[] };
        }
        if (text.includes("quarantine_previous_status")) {
          return { rows: [{ status: "deprecated" as const, quarantine_previous_status: null }] as Row[] };
        }
        if (text.includes("ORDER BY occurred_at DESC")) {
          return { rows: [{
            event_id: "event-deprecate-1",
            action: "release_deprecated" as const,
            actor_kind: "publisher" as const,
            actor_provider: "github",
            actor_subject: "publisher-1",
            target_type: "release" as const,
            target_report_id: null,
            target_namespace: "acme",
            target_name: "review",
            target_version: "1.2.3",
            target_digest: null,
            occurred_at: "2026-08-15T00:00:00.000Z",
            request_id: "moderation-request-1",
            idempotency_key: "moderate-1",
            metadata_json: { reason: "The publisher superseded this release.", operation: "deprecate" },
          }] as Row[] };
        }
        return { rows: [{ namespace: "acme" }] as Row[] };
      },
    };
    const repository = new PostgresRegistryModerationRepository(client);
    const input = {
      actor: { provider: "github" as const, subject: "publisher-1" },
      actorKind: "publisher" as const,
      coordinate: { namespace: "acme", name: "review", version: "1.2.3" },
      operation: "deprecate" as const,
      request: { reason: "The publisher superseded this release.", idempotencyKey: "moderate-1" },
      requestId: "moderation-request-1",
      now: new Date("2026-08-15T00:00:00.000Z"),
    };

    const first = await repository.moderateRelease(input);
    firstTransition = false;
    const replay = await repository.moderateRelease(input);
    const audit = await repository.listAuditEvents({ limit: 10 });

    expect(first).toMatchObject({ replayed: false, response: { status: "deprecated", auditEventId: "event-deprecate-1" } });
    expect(replay).toMatchObject({ replayed: true, response: { status: "deprecated", auditEventId: "event-deprecate-1" } });
    expect(audit.items[0]).toMatchObject({ action: "release_deprecated", target: { type: "release", release: input.coordinate } });
    const transition = queries.find(({ text }) => text.includes("WITH updated AS"));
    expect(transition?.text).toContain("EXISTS (\n                SELECT 1 FROM registry_namespaces");
    expect(transition?.text).toContain("quarantine_previous_status");
    expect(transition?.text).toContain("ON CONFLICT DO NOTHING");
    expect(transition?.values.some((value) => String(value).includes("The publisher superseded this release."))).toBe(true);
  });

  it("adds and removes emergency denylist digests with append-only audit events", async () => {
    const digest = `sha256:${"d".repeat(64)}` as `sha256:${string}`;
    const repository = new InMemoryRegistryModerationRepository();
    const input = {
      actor: { provider: "github" as const, subject: "maintainer-1" },
      requestId: "deny-request-1",
      request: { action: "add" as const, digest, reason: "Emergency block.", idempotencyKey: "deny-1" },
      now: new Date("2026-08-15T00:00:00.000Z"),
    };
    const added = await repository.mutateDenylist(input);
    const replay = await repository.mutateDenylist(input);
    expect(added).toMatchObject({ replayed: false, response: { action: "add", active: true, digest } });
    expect(replay).toMatchObject({ replayed: true, response: { auditEventId: added.response.auditEventId } });
    await expect(repository.isDigestDenylisted(digest)).resolves.toBe(true);
    await repository.mutateDenylist({ ...input, request: { ...input.request, action: "remove", idempotencyKey: "deny-2" } });
    await expect(repository.isDigestDenylisted(digest)).resolves.toBe(false);
    await expect(repository.listDenylistedDigests()).resolves.toMatchObject({ items: [] });
    const audit = await repository.listAuditEvents({ limit: 10 });
    expect(audit.items.map((event) => event.action)).toEqual(["digest_denylist_removed", "digest_denylisted"]);
  });

  it("persists denylist state and audit replay through PostgreSQL queries", async () => {
    const digest = `sha256:${"e".repeat(64)}` as `sha256:${string}`;
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    let firstMutation = true;
    const client: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        queries.push({ text, values });
        if (text.includes("WITH changed AS")) {
          return { rows: (firstMutation ? [{ digest, reason: "Emergency block.", added_at: "2026-08-15T00:00:00.000Z", active: true, changed_at: "2026-08-15T00:00:00.000Z", audit_event_id: "event-deny-1" }] : []) as Row[] };
        }
        if (text.includes("target_type = 'artifact'")) {
          return { rows: [{ event_id: "event-deny-1", action: "digest_denylisted" as const, occurred_at: "2026-08-15T00:00:00.000Z", metadata_json: { active: true } }] as Row[] };
        }
        if (text.includes("WHERE digest = $1")) return { rows: [{ digest, reason: "Emergency block.", added_at: "2026-08-15T00:00:00.000Z", active: true }] as Row[] };
        if (text.includes("WHERE active = true")) return { rows: [{ digest, reason: "Emergency block.", added_at: "2026-08-15T00:00:00.000Z" }] as Row[] };
        return { rows: [] as Row[] };
      },
    };
    const repository = new PostgresRegistryModerationRepository(client);
    const input = {
      actor: { provider: "github" as const, subject: "maintainer-1" },
      requestId: "deny-request-1",
      request: { action: "add" as const, digest, reason: "Emergency block.", idempotencyKey: "deny-1" },
      now: new Date("2026-08-15T00:00:00.000Z"),
    };
    const added = await repository.mutateDenylist(input);
    firstMutation = false;
    const replay = await repository.mutateDenylist(input);
    const listed = await repository.listDenylistedDigests();
    expect(added).toMatchObject({ replayed: false, response: { active: true, digest } });
    expect(replay).toMatchObject({ replayed: true, response: { active: true, digest } });
    expect(listed.items).toEqual([{ digest, reason: "Emergency block.", addedAt: "2026-08-15T00:00:00.000Z" }]);
    const mutation = queries.find(({ text }) => text.includes("WITH changed AS"));
    expect(mutation?.text).toContain("registry_digest_denylist");
    expect(mutation?.text).toContain("registry_moderation_audit_events");
    expect(mutation?.text).toContain("ON CONFLICT DO NOTHING");
  });
});

function makeRelease(version: string, name = "review"): RegistryRelease {
  return {
    apiVersion: "v1",
    coordinate: { namespace: "acme", name, version },
    status: "active",
    declared: {
      description: "Review code changes.",
      tags: ["review"],
      compatibility: { codex: { scopes: ["project", "user"] } },
    },
    artifact: {
      format: "agentcargo-ustar-v1",
      mediaType: "application/vnd.agentcargo.ustar-v1",
      digest: `sha256:${"a".repeat(64)}`,
      bytes: 256,
      download: { url: "https://storage.example.test/placeholder", expiresAt: "2026-08-13T00:00:00.000Z" },
    },
    files: [{ path: "SKILL.md", bytes: 128, executable: false, scriptLike: false }],
    scan: { scannerVersion: "rules-1", completedAt: "2026-08-13T00:00:00.000Z", findings: [] },
    source: { repositoryUrl: "https://github.com/acme/review", commit: "abc123" },
    publishedAt: "2026-08-13T00:00:00.000Z",
  };
}
