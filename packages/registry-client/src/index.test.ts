import { describe, expect, it } from "vitest";
import type { RegistryAuthSessionResponse, RegistryPackageSummary, RegistryReleaseLookupResponse, RegistrySearchResponse } from "@agentcargo/registry-contract";
import { RegistryClient, RegistryClientError } from "./index.js";

describe("registry client", () => {
  it("builds validated search requests and returns search results", async () => {
    let requestedUrl = "";
    const response: RegistrySearchResponse = { apiVersion: "v1", items: [] };
    const client = new RegistryClient({
      baseUrl: "https://registry.example.test/",
      fetch: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    await expect(client.search({ query: "react review", host: "codex", scope: "project", limit: 10 })).resolves.toEqual(response);
    expect(requestedUrl).toBe("https://registry.example.test/v1/search?q=react+review&host=codex&scope=project&limit=10");
  });

  it("resolves package and release paths without accepting path injection", async () => {
    const packageSummary: RegistryPackageSummary = {
      apiVersion: "v1",
      package: { namespace: "acme", name: "review" },
      description: "Review changes.",
      compatibility: { codex: { scopes: ["project"] } },
      tags: ["review"],
      hasScripts: false,
      status: "active",
    };
    const release: RegistryReleaseLookupResponse = {
      apiVersion: "v1",
      release: {
        ...makeRelease(),
        artifact: {
          ...makeRelease().artifact,
          download: { url: "https://storage.example.test/artifact", expiresAt: "2026-08-13T00:00:00.000Z" },
        },
      },
    };
    const requested: string[] = [];
    const client = new RegistryClient({
      baseUrl: "https://registry.example.test",
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(JSON.stringify(requested.length === 1 ? packageSummary : release), { status: 200 });
      },
    });

    await expect(client.getPackage({ namespace: "acme", name: "review" })).resolves.toEqual(packageSummary);
    await expect(client.getRelease({ namespace: "acme", name: "review", version: "1.2.3" })).resolves.toEqual(release);
    expect(requested).toEqual([
      "https://registry.example.test/v1/packages/acme/review",
      "https://registry.example.test/v1/packages/acme/review/versions/1.2.3",
    ]);
    await expect(client.getPackage({ namespace: "../acme", name: "review" })).rejects.toMatchObject({
      code: "REGISTRY_REQUEST_INVALID",
    });
  });

  it("maps HTTP, network, and contract failures to stable errors", async () => {
    const notFound = new RegistryClient({
      baseUrl: "https://registry.example.test",
      fetch: async () => new Response(JSON.stringify({ apiVersion: "v1", error: { code: "REGISTRY_PACKAGE_NOT_FOUND", message: "Missing.", requestId: "req-1" } }), { status: 404 }),
    });
    await expect(notFound.getPackage({ namespace: "acme", name: "missing" })).rejects.toMatchObject({ code: "REGISTRY_PACKAGE_NOT_FOUND", status: 404 });

    const network = new RegistryClient({ baseUrl: "https://registry.example.test", fetch: async () => { throw new Error("offline"); } });
    await expect(network.search({ query: "review" })).rejects.toMatchObject({ code: "REGISTRY_NETWORK_ERROR" });

    const invalid = new RegistryClient({ baseUrl: "https://registry.example.test", fetch: async () => new Response("{}", { status: 200 }) });
    await expect(invalid.search({ query: "review" })).rejects.toMatchObject({ code: "REGISTRY_RESPONSE_INVALID" });
  });

  it("preserves a registry URL path prefix", async () => {
    let requestedUrl = "";
    const client = new RegistryClient({
      baseUrl: "https://registry.example.test/api",
      fetch: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify({ apiVersion: "v1", items: [] }), { status: 200 });
      },
    });
    await client.search({ query: "review" });
    expect(requestedUrl).toBe("https://registry.example.test/api/v1/search?q=review");
  });

  it("downloads immutable artifact bytes and reports transport failures", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const requested: string[] = [];
    const client = new RegistryClient({
      baseUrl: "https://registry.example.test",
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(bytes, { status: 200 });
      },
    });

    await expect(
      client.downloadArtifact({ url: "https://storage.example.test/artifact", expiresAt: "2026-08-13T00:00:00.000Z" }),
    ).resolves.toEqual(bytes);
    expect(requested).toEqual(["https://storage.example.test/artifact"]);

    const insecure = new RegistryClient({ baseUrl: "https://registry.example.test", fetch: async () => new Response(bytes) });
    await expect(
      insecure.downloadArtifact({ url: "http://storage.example.test/artifact", expiresAt: "2026-08-13T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "REGISTRY_ARTIFACT_DOWNLOAD_FAILED" });

    const failed = new RegistryClient({
      baseUrl: "https://registry.example.test",
      fetch: async () => new Response("unavailable", { status: 503 }),
    });
    await expect(
      failed.downloadArtifact({ url: "https://storage.example.test/artifact", expiresAt: "2026-08-13T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "REGISTRY_ARTIFACT_DOWNLOAD_FAILED", status: 503 });
  });

  it("exchanges a GitHub provider credential for an explicitly scoped registry session", async () => {
    const sessionResponse: RegistryAuthSessionResponse = {
      apiVersion: "v1",
      session: {
        accessToken: "acs_registry_session",
        tokenType: "bearer",
        expiresAt: "2026-08-15T00:15:00.000Z",
        identity: { provider: "github", subject: "github-user-1", login: "agentcargo" },
        scopes: ["publisher:read"],
      },
    };
    let request: { url: string; init?: RequestInit } | undefined;
    const client = new RegistryClient({
      baseUrl: "https://registry.example.test",
      fetch: async (input, init) => {
        request = { url: String(input), ...(init ? { init } : {}) };
        return new Response(JSON.stringify(sessionResponse), { status: 201 });
      },
    });

    await expect(client.exchangeGitHubSession("gh_provider_token", { scopes: ["publisher:read"] })).resolves.toEqual(sessionResponse.session);
    expect(request?.url).toBe("https://registry.example.test/v1/auth/github/session");
    expect(request?.init?.method).toBe("POST");
    expect(new Headers(request?.init?.headers).get("authorization")).toBe("Bearer gh_provider_token");
    expect(JSON.parse(String(request?.init?.body))).toEqual({ scopes: ["publisher:read"] });
    expect(String(request?.init?.body)).not.toContain("acs_registry_session");
  });

  it("maps a rejected provider credential to the stable auth-required error", async () => {
    const client = new RegistryClient({
      baseUrl: "https://registry.example.test",
      fetch: async () => new Response(JSON.stringify({ apiVersion: "v1", error: { code: "REGISTRY_AUTH_REQUIRED", message: "Rejected.", requestId: "req-auth" } }), { status: 401 }),
    });

    await expect(client.exchangeGitHubSession("gh_provider_token")).rejects.toMatchObject({ code: "REGISTRY_AUTH_REQUIRED", status: 401 });
  });

  it("publishes through authenticated reservation, upload, and completion calls without leaking credentials", async () => {
    const digest = `sha256:${"b".repeat(64)}` as `sha256:${string}`;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new RegistryClient({
      baseUrl: "https://registry.example.test",
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, ...(init ? { init } : {}) });
        if (init?.method === "PUT") return new Response(null, { status: 200 });
        if (url.endsWith("/releases")) {
          return new Response(JSON.stringify({ apiVersion: "v1", releaseId: "release-1", coordinate: { namespace: "acme", name: "review", version: "1.0.0" }, status: "reserved", createdAt: "2026-08-15T00:00:00.000Z", expiresAt: "2026-08-15T00:30:00.000Z" }), { status: 201 });
        }
        if (url.endsWith("/upload-url")) {
          return new Response(JSON.stringify({ apiVersion: "v1", releaseId: "release-1", coordinate: { namespace: "acme", name: "review", version: "1.0.0" }, digest, bytes: 4, uploadUrl: "https://storage.example.test/upload", expiresAt: "2026-08-15T00:05:00.000Z" }), { status: 201 });
        }
        return new Response(JSON.stringify({ apiVersion: "v1", releaseId: "release-1", coordinate: { namespace: "acme", name: "review", version: "1.0.0" }, status: "scanning", artifact: { format: "agentcargo-ustar-v1", mediaType: "application/vnd.agentcargo.ustar-v1", digest, bytes: 4 }, completedAt: "2026-08-15T00:01:00.000Z" }), { status: 202 });
      },
    });
    const auth = { accessToken: "acs_secret" };
    const reservation = await client.reserveRelease({ namespace: "acme", name: "review", version: "1.0.0" }, { version: "1.0.0", idempotencyKey: "publish-1" }, auth);
    const upload = await client.createArtifactUpload(reservation.releaseId, { digest, bytes: 4 }, auth);
    await client.uploadArtifact(upload.uploadUrl, new Uint8Array([1, 2, 3, 4]), { digest });
    await client.completeRelease(reservation.releaseId, {
      artifact: { format: "agentcargo-ustar-v1", mediaType: "application/vnd.agentcargo.ustar-v1", digest, bytes: 4 },
      declared: { description: "Review changes.", tags: [], compatibility: {} },
      files: [{ path: "SKILL.md", bytes: 4, executable: false, scriptLike: false }],
      scan: { scannerVersion: "rules-1", completedAt: "2026-08-15T00:00:00.000Z", findings: [] },
      source: {},
    }, auth);

    expect(calls).toHaveLength(4);
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer acs_secret");
    expect(new Headers(calls[2]!.init?.headers).get("x-amz-meta-digest")).toBe(digest);
    expect(new Headers(calls[2]!.init?.headers).get("x-amz-meta-bytes")).toBe("4");
  });
});

function makeRelease() {
  return {
    apiVersion: "v1" as const,
    coordinate: { namespace: "acme", name: "review", version: "1.2.3" },
    status: "active" as const,
    declared: {
      description: "Review changes.",
      tags: ["review"],
      compatibility: { codex: { scopes: ["project" as const] } },
    },
    artifact: {
      format: "agentcargo-ustar-v1" as const,
      mediaType: "application/vnd.agentcargo.ustar-v1" as const,
      digest: `sha256:${"a".repeat(64)}` as `sha256:${string}`,
      bytes: 128,
      download: { url: "https://storage.example.test/artifact", expiresAt: "2026-08-13T00:00:00.000Z" },
    },
    files: [{ path: "SKILL.md", bytes: 128, executable: false, scriptLike: false }],
    scan: { scannerVersion: "rules-1", completedAt: "2026-08-13T00:00:00.000Z", findings: [] },
    source: {},
    publishedAt: "2026-08-13T00:00:00.000Z",
  };
}
