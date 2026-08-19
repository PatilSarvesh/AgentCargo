import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  AGENTCARGO_ARTIFACT_FORMAT,
  AGENTCARGO_ARTIFACT_MEDIA_TYPE,
  REGISTRY_API_PREFIX,
  REGISTRY_API_VERSION,
  assertPublicReleaseStatus,
  formatPackageCoordinate,
  formatReleaseCoordinate,
  isSha256Digest,
  validateRegistryApiError,
  validateRegistryArtifactUploadRequest,
  validateRegistryArtifactUploadResponse,
  validateRegistryAuthCredential,
  validateRegistryAuthSessionRequest,
  validateRegistryAuthSession,
  validateRegistryAuthSessionResponse,
  validateRegistryPublisherIdentity,
  validateRegistryReleaseReservation,
  validateRegistryReleaseReservationRequest,
  validateRegistryReleaseCompletionRequest,
  validateRegistryReleaseCompletionResponse,
  validateRegistryReleaseLookupResponse,
  validateRegistrySearchRequest,
} from "./index.js";

describe("registry read contract", () => {
  it("pins the versioned API and canonical artifact representation", () => {
    expect(REGISTRY_API_VERSION).toBe("v1");
    expect(REGISTRY_API_PREFIX).toBe("/v1");
    expect(AGENTCARGO_ARTIFACT_FORMAT).toBe("agentcargo-ustar-v1");
    expect(AGENTCARGO_ARTIFACT_MEDIA_TYPE).toBe("application/vnd.agentcargo.ustar-v1");
  });

  it("formats stable package and release coordinates", () => {
    expect(formatPackageCoordinate({ namespace: "acme", name: "review" })).toBe("@acme/review");
    expect(formatReleaseCoordinate({ namespace: "acme", name: "review", version: "1.2.3" })).toBe(
      "@acme/review@1.2.3",
    );
  });

  it("accepts only lowercase SHA-256 artifact digests", () => {
    expect(isSha256Digest(`sha256:${"a".repeat(64)}`)).toBe(true);
    expect(isSha256Digest(`sha256:${"A".repeat(64)}`)).toBe(false);
    expect(isSha256Digest("sha256:short")).toBe(false);
  });

  it("rejects quarantined releases from public read results", () => {
    expect(() => assertPublicReleaseStatus("quarantined")).toThrow(
      "Quarantined releases are not public read-path results.",
    );
    expect(() => assertPublicReleaseStatus("active")).not.toThrow();
    expect(() => assertPublicReleaseStatus("deprecated")).not.toThrow();
  });

  it("validates an exact release lookup response", () => {
    const response = validReleaseLookup();
    const finding = ((response.release as Record<string, unknown>).scan as Record<string, unknown>).findings as unknown[];
    finding.push({
      ruleId: "AGENTCARGO-NETWORK-REFERENCE",
      ruleVersion: "1",
      severity: "warning",
      message: "File contains a network URL.",
      explanation: "A URL may contact an external service.",
      remediation: "Document the endpoint or remove it.",
    });
    const result = validateRegistryReleaseLookupResponse(response);

    expect(result).toEqual({ valid: true, value: response, issues: [] });
  });

  it("reports unknown fields and invalid artifact digests", () => {
    const response = validReleaseLookup() as Record<string, unknown>;
    const release = response.release as Record<string, unknown>;
    const artifact = release.artifact as Record<string, unknown>;
    artifact.digest = "sha256:not-a-digest";
    release.unexpected = true;

    const result = validateRegistryReleaseLookupResponse(response);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.release.unexpected", code: "UNKNOWN_FIELD" }),
        expect.objectContaining({ path: "$.release.artifact.digest", code: "DIGEST_INVALID" }),
      ]),
    );
  });

  it("validates bounded search requests and API errors", () => {
    expect(validateRegistrySearchRequest({ query: "review", scope: "project", limit: 20 })).toMatchObject({
      valid: true,
    });
    const invalidRequest = validateRegistrySearchRequest({ query: "", limit: 101 });
    expect(invalidRequest.valid).toBe(false);
    expect(validateRegistryApiError({
      apiVersion: "v1",
      error: { code: "NOT_FOUND", message: "Not found", requestId: "req-1" },
    })).toMatchObject({ valid: true });
  });

  it("validates publisher identity and idempotent release reservations", () => {
    expect(validateRegistryPublisherIdentity({ provider: "github", subject: "gh-subject", login: "acme" })).toMatchObject({
      valid: true,
    });
    expect(validateRegistryPublisherIdentity({ provider: "github", subject: "\u0000" }).valid).toBe(false);
    expect(validateRegistryReleaseReservationRequest({ version: "1.2.3", idempotencyKey: "publish-1" })).toMatchObject({
      valid: true,
    });
    expect(validateRegistryReleaseReservationRequest({ version: "1.2", idempotencyKey: "publish-1" }).valid).toBe(false);
    expect(validateRegistryReleaseReservation({
      apiVersion: "v1",
      releaseId: "release-1",
      coordinate: { namespace: "acme", name: "review", version: "1.2.3" },
      status: "reserved",
      createdAt: "2026-08-14T00:00:00.000Z",
      expiresAt: "2026-08-14T00:30:00.000Z",
    })).toMatchObject({ valid: true });
  });

  it("validates immutable upload and scanning-completion contracts", () => {
    const digest = `sha256:${"a".repeat(64)}` as `sha256:${string}`;
    expect(validateRegistryArtifactUploadRequest({ digest, bytes: 256 })).toMatchObject({ valid: true });
    expect(validateRegistryArtifactUploadRequest({ digest: "sha256:bad", bytes: -1 }).valid).toBe(false);
    expect(validateRegistryArtifactUploadResponse({
      apiVersion: "v1",
      releaseId: "release-1",
      coordinate: { namespace: "acme", name: "review", version: "1.2.3" },
      digest,
      bytes: 256,
      uploadUrl: "https://storage.example.test/upload",
      expiresAt: "2026-08-15T00:05:00.000Z",
    })).toMatchObject({ valid: true });
    const completion = {
      artifact: { format: AGENTCARGO_ARTIFACT_FORMAT, mediaType: AGENTCARGO_ARTIFACT_MEDIA_TYPE, digest, bytes: 256 },
      declared: { description: "Review code changes.", tags: ["review"], compatibility: { codex: { scopes: ["project"] as const } } },
      files: [{ path: "SKILL.md", bytes: 128, executable: false, scriptLike: false }],
      scan: { scannerVersion: "rules-1", completedAt: "2026-08-15T00:00:00.000Z", findings: [] },
      source: { repositoryUrl: "https://github.com/acme/review", commit: "abc123" },
    };
    expect(validateRegistryReleaseCompletionRequest(completion)).toMatchObject({ valid: true });
    expect(validateRegistryReleaseCompletionRequest({
      ...completion,
      declared: { ...completion.declared, dependencies: ["git>=2.40", "node>=22"] },
    })).toMatchObject({ valid: true });
    expect(validateRegistryReleaseCompletionRequest({
      ...completion,
      declared: { ...completion.declared, dependencies: ["git>=2.40", "git>=2.40"] },
    }).valid).toBe(false);
    expect(validateRegistryReleaseCompletionResponse({
      apiVersion: "v1",
      releaseId: "release-1",
      coordinate: { namespace: "acme", name: "review", version: "1.2.3" },
      status: "scanning",
      artifact: completion.artifact,
      completedAt: "2026-08-15T00:01:00.000Z",
    })).toMatchObject({ valid: true });
  });

  it("validates bearer credentials without accepting control characters", () => {
    expect(validateRegistryAuthCredential({
      provider: "github",
      tokenType: "bearer",
      accessToken: "gho_example",
      refreshToken: "ghr_example",
      expiresAt: "2026-08-15T00:30:00.000Z",
      refreshTokenExpiresAt: "2027-02-15T00:30:00.000Z",
      scopes: ["read:user"],
    })).toMatchObject({ valid: true });
    const invalid = validateRegistryAuthCredential({ provider: "github", tokenType: "bearer", accessToken: "gho_\nsecret" });
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) expect(invalid.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CONTROL_CHARACTER_INVALID" })]));
    expect(validateRegistryAuthCredential({
      provider: "github",
      tokenType: "bearer",
      accessToken: "gho_example",
      scopes: ["read:user", "read:user"],
    }).valid).toBe(false);
  });

  it("validates short-lived AgentCargo session responses", () => {
    const session = {
      accessToken: "acs_session_token",
      tokenType: "bearer",
      expiresAt: "2026-08-15T01:00:00.000Z",
      identity: { provider: "github", subject: "42", login: "octocat" },
      scopes: ["publisher:read", "publisher:write"],
    } as const;
    expect(validateRegistryAuthSession(session)).toMatchObject({ valid: true });
    expect(validateRegistryAuthSessionResponse({ apiVersion: "v1", session })).toMatchObject({ valid: true });
    const invalid = validateRegistryAuthSessionResponse({
      apiVersion: "v1",
      session: { ...session, identity: { provider: "github", subject: "\u0000" } },
    });
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) expect(invalid.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "$.session.identity.subject" })]));
    const invalidScopes = validateRegistryAuthSession({ ...session, scopes: ["publisher:write", "publisher:write"] });
    expect(invalidScopes.valid).toBe(false);
    expect(validateRegistryAuthSessionRequest({ scopes: ["publisher:read"] })).toMatchObject({ valid: true });
    expect(validateRegistryAuthSessionRequest({ scopes: ["publisher:admin"] }).valid).toBe(false);
  });

  it("ships an OpenAPI 3.1 document for reads, reservation, upload, and completion", async () => {
    const document = JSON.parse(await readFile(new URL("../openapi/registry-v1.json", import.meta.url), "utf8")) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths)).toEqual([
      "/v1/auth/github/start",
      "/v1/auth/github/callback",
      "/v1/auth/github/session",
      "/v1/search",
      "/v1/packages/{namespace}/{name}",
      "/v1/packages/{namespace}/{name}/versions/{version}",
      "/v1/packages/{namespace}/{name}/releases",
      "/v1/releases/{releaseId}/upload-url",
      "/v1/releases/{releaseId}/complete",
    ]);
    expect(document.components.schemas.RegistryApiVersion!.const).toBe("v1");
    expect(document.components.schemas.RegistryAuthSession!.required).toEqual(["accessToken", "tokenType", "expiresAt", "identity", "scopes"]);
    expect(document.components.schemas.RegistryAuthSessionResponse!.required).toEqual(["apiVersion", "session"]);
    expect(document.components.schemas.RegistryReleaseLookupResponse!.required).toEqual(["apiVersion", "release"]);
    expectUnresolvedInternalReferences(document);
  });
});

function expectUnresolvedInternalReferences(document: unknown): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string" && record.$ref.startsWith("#/")) {
      let target: unknown = document;
      for (const token of record.$ref.slice(2).split("/")) {
        if (typeof target !== "object" || target === null) throw new Error(`Unresolved OpenAPI reference: ${record.$ref}`);
        target = (target as Record<string, unknown>)[token.replace(/~1/g, "/").replace(/~0/g, "~")];
      }
      expect(target).toBeDefined();
    }
    Object.values(record).forEach(visit);
  };
  visit(document);
}

function validReleaseLookup(): Record<string, unknown> {
  return {
    apiVersion: "v1",
    release: {
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
        download: { url: "https://storage.example.test/artifacts/a", expiresAt: "2026-08-13T00:00:00.000Z" },
      },
      files: [{ path: "SKILL.md", bytes: 128, executable: false, scriptLike: false }],
      scan: { scannerVersion: "rules-1", completedAt: "2026-08-13T00:00:00.000Z", findings: [] },
      source: { repositoryUrl: "https://github.com/acme/review", commit: "abc123" },
      publishedAt: "2026-08-13T00:00:00.000Z",
    },
  };
}
