import { describe, expect, it } from "vitest";
import type { RegistryRelease } from "@agentcargo/registry-contract";
import {
  InMemoryRegistryReleaseRepository,
  InMemoryRegistryReleaseReservationRepository,
  RegistryReleaseReservationError,
} from "@agentcargo/registry-db";
import {
  buildRegistryApp,
  createBearerPublisherResolver,
  createScopedSessionCookiePublisherResolver,
  createSessionCookiePublisherResolver,
  extractBearerToken,
  extractCookieToken,
  InMemoryRegistrySessionStore,
  ProviderSessionExchange,
} from "./index.js";

describe("registry read API", () => {
  it("serves search, package, and exact release lookups", async () => {
    const app = buildRegistryApp({ repository: new InMemoryRegistryReleaseRepository([makeRelease()]) });

    const search = await app.inject({ method: "GET", url: "/v1/search?q=review&host=codex&scope=project" });
    const summary = await app.inject({ method: "GET", url: "/v1/packages/acme/review" });
    const release = await app.inject({ method: "GET", url: "/v1/packages/acme/review/versions/1.2.3" });

    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({ apiVersion: "v1", items: [{ package: { name: "review" } }] });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ package: { namespace: "acme", name: "review" } });
    expect(release.statusCode).toBe(200);
    expect(release.json()).toMatchObject({ release: { artifact: { digest: `sha256:${"a".repeat(64)}` } } });

    await app.close();
  });

  it("returns stable errors for invalid requests, misses, and unknown routes", async () => {
    const app = buildRegistryApp({ repository: new InMemoryRegistryReleaseRepository([makeRelease()]) });

    const invalid = await app.inject({ method: "GET", url: "/v1/search?q=&limit=101" });
    const missing = await app.inject({ method: "GET", url: "/v1/packages/acme/missing" });
    const unknown = await app.inject({ method: "GET", url: "/v1/unknown" });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "REGISTRY_REQUEST_INVALID" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "REGISTRY_PACKAGE_NOT_FOUND" } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: { code: "REGISTRY_ROUTE_NOT_FOUND" } });

    await app.close();
  });

  it("does not expose repository failure details", async () => {
    const repository = new InMemoryRegistryReleaseRepository([makeRelease()]);
    repository.search = async () => {
      throw new Error("database password leaked");
    };
    const app = buildRegistryApp({ repository });

    const response = await app.inject({ method: "GET", url: "/v1/search?q=review" });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("database password");
    expect(response.json()).toMatchObject({ error: { code: "REGISTRY_UNAVAILABLE" } });
    await app.close();
  });

  it("keeps publishing unavailable until authentication and reservation persistence are injected", async () => {
    const app = buildRegistryApp({ repository: new InMemoryRegistryReleaseRepository([makeRelease()]) });

    const response = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/review/releases",
      payload: { version: "1.2.3", idempotencyKey: "publish-1" },
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({ error: { code: "REGISTRY_PUBLISHING_NOT_CONFIGURED" } });
    await app.close();
  });

  it("reserves a release with authenticated context and replays idempotently", async () => {
    const reservations = new InMemoryRegistryReleaseReservationRepository();
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      releaseReservations: reservations,
      resolvePublisher: async () => ({ identity: { provider: "github", subject: "user-1", login: "acme" } }),
    });

    const first = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      payload: { version: "1.0.0", idempotencyKey: "publish-1" },
    });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      payload: { version: "1.0.0", idempotencyKey: "publish-1" },
    });
    const conflictingKey = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      payload: { version: "2.0.0", idempotencyKey: "publish-1" },
    });
    const conflictingVersion = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      payload: { version: "1.0.0", idempotencyKey: "publish-2" },
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ status: "reserved", coordinate: { namespace: "acme", name: "new-skill", version: "1.0.0" } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().releaseId).toBe(first.json().releaseId);
    expect(conflictingKey.statusCode).toBe(409);
    expect(conflictingKey.json()).toMatchObject({ error: { code: "REGISTRY_IDEMPOTENCY_CONFLICT" } });
    expect(conflictingVersion.statusCode).toBe(409);
    expect(conflictingVersion.json()).toMatchObject({ error: { code: "REGISTRY_RELEASE_VERSION_RESERVED" } });

    await app.close();
  });

  it("rejects unauthenticated and malformed reservation requests", async () => {
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      releaseReservations: new InMemoryRegistryReleaseReservationRepository(),
      resolvePublisher: async () => null,
    });

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      payload: { version: "1.0.0", idempotencyKey: "publish-1" },
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      payload: { version: "not-semver", idempotencyKey: "publish-1" },
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toMatchObject({ error: { code: "REGISTRY_AUTH_REQUIRED" } });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: "REGISTRY_REQUEST_INVALID" } });
    await app.close();
  });

  it("enforces publisher write scope for scoped browser sessions", async () => {
    const sessions = new InMemoryRegistrySessionStore({ ttlSeconds: 120 });
    const readOnly = await sessions.issue({ provider: "github", subject: "user-read-only" }, { scopes: ["publisher:read"] });
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      releaseReservations: new InMemoryRegistryReleaseReservationRepository(),
      resolvePublisher: createScopedSessionCookiePublisherResolver(sessions),
    });

    const denied = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      headers: { cookie: `agentcargo_session=${readOnly.accessToken}` },
      payload: { version: "1.0.0", idempotencyKey: "scope-read-only" },
    });

    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "REGISTRY_SCOPE_FORBIDDEN" } });
    await app.close();
  });

  it("issues an upload URL and completes an uploaded release into scanning", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const calls: string[] = [];
    const completion = {
      apiVersion: "v1" as const,
      releaseId: "release-1",
      coordinate: { namespace: "acme", name: "new-skill", version: "1.0.0" },
      status: "scanning" as const,
      artifact: {
        format: "agentcargo-ustar-v1" as const,
        mediaType: "application/vnd.agentcargo.ustar-v1" as const,
        digest: digest as `sha256:${string}`,
        bytes: 256,
      },
      completedAt: "2026-08-15T00:01:00.000Z",
    };
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      resolveReleasePublisher: async (_request, releaseId) => releaseId === "release-1" ? { identity: { provider: "github", subject: "user-1" } } : null,
      releaseUploads: {
        async reserveArtifactUpload(input) {
          calls.push(`reserve:${input.releaseId}`);
          return {
            replayed: calls.length > 1,
            reservation: {
              apiVersion: "v1",
              releaseId: input.releaseId,
              coordinate: { namespace: "acme", name: "new-skill", version: "1.0.0" },
              status: "reserved",
              createdAt: "2026-08-15T00:00:00.000Z",
              expiresAt: "2026-08-15T00:30:00.000Z",
            },
          };
        },
        async completeRelease(input) {
          calls.push(`complete:${input.releaseId}`);
          return { completion, replayed: false };
        },
      },
      artifactStorage: {
        async createUpload(uploadDigest, bytes) {
          expect(uploadDigest).toBe(digest);
          expect(bytes).toBe(256);
          return { url: "https://storage.example.test/upload", expiresAt: "2026-08-15T00:05:00.000Z" };
        },
        async assertUploaded(uploadDigest, bytes) {
          expect(uploadDigest).toBe(digest);
          expect(bytes).toBe(256);
          return { key: `artifacts/sha256/aa/${"a".repeat(64)}.agentcargo`, digest: uploadDigest, bytes, contentType: "application/vnd.agentcargo.ustar-v1" };
        },
      },
    });

    const upload = await app.inject({
      method: "POST",
      url: "/v1/releases/release-1/upload-url",
      payload: { digest, bytes: 256 },
    });
    const completed = await app.inject({
      method: "POST",
      url: "/v1/releases/release-1/complete",
      payload: {
        artifact: completion.artifact,
        declared: { description: "Review code changes.", tags: ["review"], compatibility: { codex: { scopes: ["project"] } } },
        files: [{ path: "SKILL.md", bytes: 128, executable: false, scriptLike: false }],
        scan: { scannerVersion: "rules-1", completedAt: "2026-08-15T00:00:00.000Z", findings: [] },
        source: { repositoryUrl: "https://github.com/acme/review", commit: "abc123" },
      },
    });

    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({ releaseId: "release-1", uploadUrl: "https://storage.example.test/upload", digest, bytes: 256 });
    expect(upload.headers["cache-control"]).toBe("no-store");
    expect(completed.statusCode).toBe(202);
    expect(completed.json()).toMatchObject({ status: "scanning", releaseId: "release-1", artifact: { digest } });
    expect(completed.body).not.toContain("storage.example.test");
    expect(calls).toEqual(["reserve:release-1", "complete:release-1"]);
    await app.close();
  });

  it("does not complete a release before its artifact is present", async () => {
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      resolveReleasePublisher: async () => ({ identity: { provider: "github", subject: "user-1" } }),
      releaseUploads: {
        async reserveArtifactUpload() { throw new Error("unused"); },
        async completeRelease() { throw new Error("unused"); },
      },
      artifactStorage: {
        async createUpload() { return { url: "https://storage.example.test/upload", expiresAt: "2026-08-15T00:05:00.000Z" }; },
        async assertUploaded() { throw Object.assign(new Error("not uploaded"), { code: "ARTIFACT_NOT_FOUND" }); },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/releases/release-1/complete",
      payload: {
        artifact: { format: "agentcargo-ustar-v1", mediaType: "application/vnd.agentcargo.ustar-v1", digest: `sha256:${"a".repeat(64)}`, bytes: 256 },
        declared: { description: "Review code changes.", tags: ["review"], compatibility: { codex: { scopes: ["project"] } } },
        files: [{ path: "SKILL.md", bytes: 128, executable: false, scriptLike: false }],
        scan: { scannerVersion: "rules-1", completedAt: "2026-08-15T00:00:00.000Z", findings: [] },
        source: { repositoryUrl: "https://github.com/acme/review", commit: "abc123" },
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "REGISTRY_ARTIFACT_NOT_UPLOADED" } });
    await app.close();
  });

  it("does not trust an unvalidated authentication adapter context", async () => {
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      releaseReservations: new InMemoryRegistryReleaseReservationRepository(),
      resolvePublisher: async () => ({ identity: { provider: "github", subject: "\u0000" } }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      payload: { version: "1.0.0", idempotencyKey: "publish-1" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: "REGISTRY_AUTH_CONTEXT_INVALID" } });
    await app.close();
  });

  it("maps durable namespace errors to stable HTTP statuses", async () => {
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      releaseReservations: {
        async reserveRelease() {
          throw new RegistryReleaseReservationError("REGISTRY_NAMESPACE_FORBIDDEN", "not yours");
        },
      },
      resolvePublisher: async () => ({ identity: { provider: "github", subject: "user-1" } }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      payload: { version: "1.0.0", idempotencyKey: "publish-1" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "REGISTRY_NAMESPACE_FORBIDDEN" } });
    await app.close();
  });

  it("delegates bearer verification without exposing the token to route logic", async () => {
    let verifiedToken = "";
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      releaseReservations: new InMemoryRegistryReleaseReservationRepository(),
      resolvePublisher: createBearerPublisherResolver({
        async verify(token) {
          verifiedToken = token;
          return { provider: "github", subject: "user-1", login: "acme" };
        },
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      headers: { authorization: "Bearer ghu_example_secret" },
      payload: { version: "1.0.0", idempotencyKey: "publish-1" },
    });

    expect(response.statusCode).toBe(201);
    expect(verifiedToken).toBe("ghu_example_secret");
    expect(response.body).not.toContain("ghu_example_secret");
    await app.close();
  });

  it("rejects malformed bearer headers and maps verifier outages", async () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("Basic ghu_example_secret")).toBeNull();
    expect(extractBearerToken("Bearer too short")).toBeNull();
    expect(extractBearerToken("Bearer ghu_example_secret")).toBe("ghu_example_secret");

    const reservations = new InMemoryRegistryReleaseReservationRepository();
    const unauthenticated = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      releaseReservations: reservations,
      resolvePublisher: createBearerPublisherResolver({ verify: async () => null }),
    });
    const missing = await unauthenticated.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      payload: { version: "1.0.0", idempotencyKey: "publish-1" },
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ error: { code: "REGISTRY_AUTH_REQUIRED" } });
    await unauthenticated.close();

    const unavailable = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      releaseReservations: reservations,
      resolvePublisher: createBearerPublisherResolver({
        async verify() {
          throw new Error("provider details must stay private");
        },
      }),
    });
    const failed = await unavailable.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      headers: { authorization: "Bearer ghu_example_secret" },
      payload: { version: "1.0.0", idempotencyKey: "publish-1" },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain("provider details");
    expect(failed.json()).toMatchObject({ error: { code: "REGISTRY_AUTH_UNAVAILABLE" } });
    await unavailable.close();
  });

  it("issues opaque sessions, expires them, and supports revocation", async () => {
    let now = Date.parse("2026-08-15T00:00:00.000Z");
    const store = new InMemoryRegistrySessionStore({ now: () => now, ttlSeconds: 60 });
    const session = await store.issue({ provider: "github", subject: "user-1", login: "acme" });

    expect(session.accessToken).toMatch(/^acs_[A-Za-z0-9_-]{43}$/);
    expect(session.tokenType).toBe("bearer");
    expect(session.expiresAt).toBe("2026-08-15T00:01:00.000Z");
    expect(await store.resolve(session.accessToken)).toEqual({ provider: "github", subject: "user-1", login: "acme" });
    expect(await store.resolve("acs_invalid_token")).toBeNull();

    now += 60_000;
    expect(await store.resolve(session.accessToken)).toBeNull();

    const second = await store.issue({ provider: "github", subject: "user-1" });
    expect(await store.revoke(second.accessToken)).toBe(true);
    expect(await store.revoke(second.accessToken)).toBe(false);
    expect(await store.resolve(second.accessToken)).toBeNull();
  });

  it("exchanges a provider bearer credential for a no-store AgentCargo session", async () => {
    const store = new InMemoryRegistrySessionStore({ ttlSeconds: 120 });
    let providerToken = "";
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      sessionExchange: new ProviderSessionExchange({
        async verify(token) {
          providerToken = token;
          return token === "ghu_provider_token" ? { provider: "github", subject: "user-1", login: "acme" } : null;
        },
      }, store),
      releaseReservations: new InMemoryRegistryReleaseReservationRepository(),
      resolvePublisher: createBearerPublisherResolver({ verify: (token) => store.resolve(token) }),
    });

    const exchanged = await app.inject({
      method: "POST",
      url: "/v1/auth/github/session",
      headers: { authorization: "Bearer ghu_provider_token" },
    });
    expect(exchanged.statusCode).toBe(201);
    expect(exchanged.headers["cache-control"]).toBe("no-store");
    expect(providerToken).toBe("ghu_provider_token");
    expect(exchanged.json()).toMatchObject({
      apiVersion: "v1",
      session: { tokenType: "bearer", identity: { provider: "github", subject: "user-1" }, scopes: ["publisher:read", "publisher:write"] },
    });

    const readOnly = await app.inject({
      method: "POST",
      url: "/v1/auth/github/session",
      headers: { authorization: "Bearer ghu_provider_token" },
      payload: { scopes: ["publisher:read"] },
    });
    expect(readOnly.statusCode).toBe(201);
    expect(readOnly.json().session.scopes).toEqual(["publisher:read"]);

    const sessionToken = exchanged.json().session.accessToken as string;
    const reservation = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { version: "1.0.0", idempotencyKey: "publish-session-1" },
    });
    expect(reservation.statusCode).toBe(201);

    const invalid = await app.inject({
      method: "POST",
      url: "/v1/auth/github/session",
      headers: { authorization: "Bearer ghu_invalid_token" },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toMatchObject({ error: { code: "REGISTRY_AUTH_REQUIRED" } });
    await app.close();
  });

  it("keeps hosted session exchange visibly unavailable until configured", async () => {
    const app = buildRegistryApp({ repository: new InMemoryRegistryReleaseRepository([makeRelease()]) });
    const missing = await app.inject({
      method: "POST",
      url: "/v1/auth/github/session",
      headers: { authorization: "Bearer ghu_provider_token" },
    });
    expect(missing.statusCode).toBe(501);
    expect(missing.json()).toMatchObject({ error: { code: "REGISTRY_AUTH_NOT_CONFIGURED" } });
    await app.close();
  });

  it("protects hosted callback routes and establishes an HttpOnly session cookie", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const session = {
      accessToken: "acs_hosted_session",
      tokenType: "bearer" as const,
      expiresAt: "2099-08-15T00:00:00.000Z",
      identity: { provider: "github" as const, subject: "user-1", login: "acme" },
      scopes: ["publisher:read", "publisher:write"] as const,
    };
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      hostedGitHubAuth: {
        redirectUri: "https://registry.example.test/v1/auth/github/callback",
        scopes: ["read:user"],
        successRedirect: "/account",
        flow: {
          async begin(options) {
            calls.push({ kind: "begin", ...options });
            return {
              authorizationUrl: "https://github.com/login/oauth/authorize?client_id=Iv1.client&state=state_value",
              state: "state_value",
              expiresAt: "2099-08-15T00:01:00.000Z",
            };
          },
          async complete(options) {
            calls.push({ kind: "complete", ...options });
            return { provider: "github", tokenType: "bearer", accessToken: "ghu_callback" };
          },
        },
        sessionExchange: {
          async exchange(token) {
            calls.push({ kind: "exchange", token });
            return token === "ghu_callback" ? session : null;
          },
        },
      },
    });

    const started = await app.inject({ method: "GET", url: "/v1/auth/github/start" });
    expect(started.statusCode).toBe(302);
    expect(started.headers.location).toContain("https://github.com/login/oauth/authorize");
    expect(started.headers["cache-control"]).toBe("no-store");
    expect(calls[0]).toMatchObject({ kind: "begin", redirectUri: "https://registry.example.test/v1/auth/github/callback", scopes: ["read:user"] });

    const callback = await app.inject({
      method: "GET",
      url: "/v1/auth/github/callback?code=temporary-code&state=state_value",
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/account");
    expect(callback.headers["set-cookie"]).toContain("agentcargo_session=acs_hosted_session");
    expect(callback.headers["set-cookie"]).toContain("HttpOnly");
    expect(callback.headers["set-cookie"]).toContain("Secure");
    expect(callback.body).not.toContain("acs_hosted_session");
    expect(calls).toContainEqual({ kind: "exchange", token: "ghu_callback" });

    await app.close();
  });

  it("rejects invalid hosted callback state without leaking provider details", async () => {
    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      hostedGitHubAuth: {
        flow: {
          async begin() {
            return { authorizationUrl: "https://github.com/login/oauth/authorize?state=state_value", state: "state_value", expiresAt: "2099-08-15T00:01:00.000Z" };
          },
          async complete() {
            throw Object.assign(new Error("state detail must stay private"), { code: "GITHUB_OAUTH_STATE_INVALID" });
          },
        },
        sessionExchange: { exchange: async () => null },
        redirectUri: "https://registry.example.test/v1/auth/github/callback",
      },
    });
    const response = await app.inject({ method: "GET", url: "/v1/auth/github/callback?code=code&state=bad" });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("state detail");
    expect(response.json()).toMatchObject({ error: { code: "REGISTRY_AUTH_REQUIRED" } });
    await app.close();
  });

  it("parses only a single safe session cookie and supports cookie publisher resolution", async () => {
    expect(extractCookieToken("theme=dark; agentcargo_session=acs_cookie_session")).toBe("acs_cookie_session");
    expect(extractCookieToken("agentcargo_session=acs_cookie_session; agentcargo_session=acs_other")).toBeNull();
    expect(extractCookieToken("agentcargo_session=bad token")).toBeNull();

    const app = buildRegistryApp({
      repository: new InMemoryRegistryReleaseRepository([makeRelease()]),
      releaseReservations: new InMemoryRegistryReleaseReservationRepository(),
      resolvePublisher: createSessionCookiePublisherResolver({
        verify: async (token) => token === "acs_cookie_session" ? { provider: "github", subject: "user-1" } : null,
      }),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/packages/acme/new-skill/releases",
      headers: { cookie: "agentcargo_session=acs_cookie_session" },
      payload: { version: "1.0.0", idempotencyKey: "publish-cookie-1" },
    });
    expect(response.statusCode).toBe(201);
    await app.close();
  });
});

function makeRelease(): RegistryRelease {
  return {
    apiVersion: "v1",
    coordinate: { namespace: "acme", name: "review", version: "1.2.3" },
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
