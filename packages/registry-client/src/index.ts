import {
  validateRegistryApiError,
  validateRegistryAuthSessionResponse,
  validateRegistryAuthSessionMetadataResponse,
  validateRegistryArtifactUploadRequest,
  validateRegistryArtifactUploadResponse,
  validateRegistryModerationAuditEventListRequest,
  validateRegistryModerationAuditEventListResponse,
  validateRegistryPackageSummary,
  validateRegistryPublisherWorkspaceResponse,
  validateRegistryReport,
  validateRegistryReportRequest,
  validateRegistryReleaseModerationRequest,
  validateRegistryReleaseModerationResponse,
  validateRegistryDigestDenylistMutationRequest,
  validateRegistryDigestDenylistMutationResponse,
  validateRegistryDigestDenylistResponse,
  validateRegistryReleaseCompletionRequest,
  validateRegistryReleaseCompletionResponse,
  validateRegistryReleaseReservation,
  validateRegistryReleaseReservationRequest,
  validateRegistryReleaseLookupResponse,
  validateRegistrySearchRequest,
  validateRegistrySearchResponse,
  validateRegistryStatusResponse,
  AGENTCARGO_ARTIFACT_MEDIA_TYPE,
  type RegistryAuthCredential,
  type RegistryAuthSession,
  type RegistryAuthSessionMetadata,
  type RegistryModerationAuditEventListRequest,
  type RegistryModerationAuditEventListResponse,
  type RegistryArtifactUploadRequest,
  type RegistryArtifactUploadResponse,
  type RegistryReleaseCompletionRequest,
  type RegistryReleaseCompletionResponse,
  type RegistryPackageCoordinate,
  type RegistryPackageSummary,
  type RegistryPublisherWorkspaceResponse,
  type RegistryReport,
  type RegistryReportRequest,
  type RegistryReleaseModerationOperation,
  type RegistryReleaseModerationRequest,
  type RegistryReleaseModerationResponse,
  type RegistryDigestDenylistMutationRequest,
  type RegistryDigestDenylistMutationResponse,
  type RegistryDigestDenylistResponse,
  type RegistryArtifactDownload,
  type RegistryReleaseCoordinate,
  type RegistryReleaseLookupResponse,
  type RegistryReleaseReservation,
  type RegistryReleaseReservationRequest,
  type RegistrySessionScope,
  type RegistrySearchRequest,
  type RegistrySearchResponse,
  type RegistryStatusResponse,
} from "@agentcargo/registry-contract";

const PACKAGE_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface RegistryClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export type RegistryClientErrorCode =
  | "REGISTRY_URL_INVALID"
  | "REGISTRY_REQUEST_INVALID"
  | "REGISTRY_NETWORK_ERROR"
  | "REGISTRY_RESPONSE_INVALID"
  | "REGISTRY_HTTP_ERROR"
  | "REGISTRY_PACKAGE_NOT_FOUND"
  | "REGISTRY_RELEASE_NOT_FOUND"
  | "REGISTRY_ARTIFACT_DOWNLOAD_FAILED"
  | "REGISTRY_ARTIFACT_UPLOAD_FAILED"
  | "REGISTRY_AUTH_REQUIRED";

export type RegistryAuthInput = Pick<RegistryAuthCredential, "accessToken"> | string;

export class RegistryClientError extends Error {
  constructor(
    public readonly code: RegistryClientErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RegistryClientError";
  }
}

export class RegistryClient {
  readonly #baseUrl: URL;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: RegistryClientOptions) {
    this.#baseUrl = parseBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") {
      throw new RegistryClientError("REGISTRY_NETWORK_ERROR", "This Node.js runtime does not provide fetch.");
    }
  }

  async search(request: RegistrySearchRequest): Promise<RegistrySearchResponse> {
    const validation = validateRegistrySearchRequest(request);
    if (!validation.valid) {
      throw new RegistryClientError(
        "REGISTRY_REQUEST_INVALID",
        validation.issues[0]?.message ?? "The registry search request is invalid.",
      );
    }
    const params = new URLSearchParams({ q: request.query });
    if (request.host) params.set("host", request.host);
    if (request.scope) params.set("scope", request.scope);
    if (request.cursor) params.set("cursor", request.cursor);
    if (request.limit !== undefined) params.set("limit", String(request.limit));
    return this.#request(`/v1/search?${params.toString()}`, validateRegistrySearchResponse);
  }

  async getPackage(coordinate: RegistryPackageCoordinate): Promise<RegistryPackageSummary> {
    assertPackageCoordinate(coordinate);
    return this.#request(
      `/v1/packages/${encodeURIComponent(coordinate.namespace)}/${encodeURIComponent(coordinate.name)}`,
      validateRegistryPackageSummary,
      "REGISTRY_PACKAGE_NOT_FOUND",
    );
  }

  async getRelease(coordinate: RegistryReleaseCoordinate): Promise<RegistryReleaseLookupResponse> {
    assertReleaseCoordinate(coordinate);
    return this.#request(
      `/v1/packages/${encodeURIComponent(coordinate.namespace)}/${encodeURIComponent(coordinate.name)}/versions/${encodeURIComponent(coordinate.version)}`,
      validateRegistryReleaseLookupResponse,
      "REGISTRY_RELEASE_NOT_FOUND",
    );
  }

  async getStatus(): Promise<RegistryStatusResponse> {
    return this.#request("/v1/status", validateRegistryStatusResponse);
  }

  async downloadArtifact(download: RegistryArtifactDownload): Promise<Uint8Array> {
    const url = parseDownloadUrl(download.url);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: "application/vnd.agentcargo.ustar-v1" },
      });
    } catch (error) {
      throw new RegistryClientError(
        "REGISTRY_ARTIFACT_DOWNLOAD_FAILED",
        error instanceof Error ? `Artifact download failed: ${error.message}` : "Artifact download failed.",
      );
    }
    if (!response.ok) {
      throw new RegistryClientError(
        "REGISTRY_ARTIFACT_DOWNLOAD_FAILED",
        `Artifact download returned HTTP ${response.status}.`,
        response.status,
      );
    }
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw new RegistryClientError(
        "REGISTRY_ARTIFACT_DOWNLOAD_FAILED",
        error instanceof Error ? `Artifact download body could not be read: ${error.message}` : "Artifact download body could not be read.",
        response.status,
      );
    }
  }

  /**
   * Exchange a provider-issued GitHub bearer credential for a short-lived
   * AgentCargo session. The provider credential is sent only to the registry;
   * callers receive the scoped session once and must choose their own secure
   * server-side handoff or storage boundary.
   */
  async exchangeGitHubSession(
    providerAuth: RegistryAuthInput,
    options: { scopes?: readonly RegistrySessionScope[] } = {},
  ): Promise<RegistryAuthSession> {
    const response = await this.#request(
      "/v1/auth/github/session",
      validateRegistryAuthSessionResponse,
      "REGISTRY_AUTH_REQUIRED",
      requestInit(providerAuth, options.scopes === undefined ? {} : { scopes: options.scopes }),
    );
    return response.session;
  }

  /** Resolve token-free expiry and scope metadata for an AgentCargo session. */
  async inspectSession(auth: RegistryAuthInput): Promise<RegistryAuthSessionMetadata> {
    const response = await this.#request(
      "/v1/auth/session",
      validateRegistryAuthSessionMetadataResponse,
      "REGISTRY_AUTH_REQUIRED",
      authRequestInit(auth),
    );
    return response.session;
  }

  async getPublisherWorkspace(auth: RegistryAuthInput): Promise<RegistryPublisherWorkspaceResponse> {
    return this.#request(
      "/v1/publisher/workspace",
      validateRegistryPublisherWorkspaceResponse,
      "REGISTRY_AUTH_REQUIRED",
      authRequestInit(auth),
    );
  }

  async submitReport(request: RegistryReportRequest, auth: RegistryAuthInput): Promise<RegistryReport> {
    const requestValidation = validateRegistryReportRequest(request);
    if (!requestValidation.valid) {
      throw new RegistryClientError("REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "The moderation report request is invalid.");
    }
    return this.#request(
      "/v1/reports",
      validateRegistryReport,
      undefined,
      requestInit(auth, requestValidation.value),
    );
  }

  async listModerationAuditEvents(
    auth: RegistryAuthInput,
    request: RegistryModerationAuditEventListRequest = {},
  ): Promise<RegistryModerationAuditEventListResponse> {
    const requestValidation = validateRegistryModerationAuditEventListRequest(request);
    if (!requestValidation.valid) {
      throw new RegistryClientError("REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "The moderation audit query is invalid.");
    }
    const params = new URLSearchParams();
    if (request.cursor) params.set("cursor", request.cursor);
    if (request.limit !== undefined) params.set("limit", String(request.limit));
    const query = params.toString();
    return this.#request(
      `/v1/admin/audit-events${query ? `?${query}` : ""}`,
      validateRegistryModerationAuditEventListResponse,
      undefined,
      authRequestInit(auth),
    );
  }

  async moderateRelease(
    coordinate: RegistryReleaseCoordinate,
    operation: RegistryReleaseModerationOperation,
    request: RegistryReleaseModerationRequest,
    auth: RegistryAuthInput,
  ): Promise<RegistryReleaseModerationResponse> {
    assertReleaseCoordinate(coordinate);
    const requestValidation = validateRegistryReleaseModerationRequest(request);
    if (!requestValidation.valid) {
      throw new RegistryClientError("REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "The release moderation request is invalid.");
    }
    const prefix = operation === "deprecate" ? "/v1/packages" : "/v1/admin/packages";
    return this.#request(
      `${prefix}/${encodeURIComponent(coordinate.namespace)}/${encodeURIComponent(coordinate.name)}/versions/${encodeURIComponent(coordinate.version)}/${operation}`,
      validateRegistryReleaseModerationResponse,
      undefined,
      requestInit(auth, requestValidation.value),
    );
  }

  async listDigestDenylist(): Promise<RegistryDigestDenylistResponse> {
    return this.#request("/v1/security/denylist", validateRegistryDigestDenylistResponse);
  }

  async mutateDigestDenylist(
    request: RegistryDigestDenylistMutationRequest,
    auth: RegistryAuthInput,
  ): Promise<RegistryDigestDenylistMutationResponse> {
    const requestValidation = validateRegistryDigestDenylistMutationRequest(request);
    if (!requestValidation.valid) {
      throw new RegistryClientError("REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "The digest denylist request is invalid.");
    }
    return this.#request(
      "/v1/admin/security/denylist",
      validateRegistryDigestDenylistMutationResponse,
      undefined,
      requestInit(auth, requestValidation.value),
    );
  }

  async reserveRelease(
    coordinate: RegistryReleaseCoordinate,
    request: RegistryReleaseReservationRequest,
    auth: RegistryAuthInput,
  ): Promise<RegistryReleaseReservation> {
    assertReleaseCoordinate(coordinate);
    const requestValidation = validateRegistryReleaseReservationRequest(request);
    if (!requestValidation.valid) {
      throw new RegistryClientError("REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "The release reservation request is invalid.");
    }
    return this.#request(
      `/v1/packages/${encodeURIComponent(coordinate.namespace)}/${encodeURIComponent(coordinate.name)}/releases`,
      validateRegistryReleaseReservation,
      undefined,
      requestInit(auth, requestValidation.value),
    );
  }

  async createArtifactUpload(
    releaseId: string,
    request: RegistryArtifactUploadRequest,
    auth: RegistryAuthInput,
  ): Promise<RegistryArtifactUploadResponse> {
    assertReleaseId(releaseId);
    const requestValidation = validateRegistryArtifactUploadRequest(request);
    if (!requestValidation.valid) {
      throw new RegistryClientError("REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "The artifact upload request is invalid.");
    }
    return this.#request(
      `/v1/releases/${encodeURIComponent(releaseId)}/upload-url`,
      validateRegistryArtifactUploadResponse,
      undefined,
      requestInit(auth, requestValidation.value),
    );
  }

  async uploadArtifact(uploadUrl: string, bytes: Uint8Array, metadata: Pick<RegistryArtifactUploadRequest, "digest">): Promise<void> {
    const url = parseUploadUrl(uploadUrl);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "PUT",
        headers: {
          "content-type": AGENTCARGO_ARTIFACT_MEDIA_TYPE,
          "x-amz-meta-digest": metadata.digest,
          "x-amz-meta-bytes": String(bytes.byteLength),
        },
        body: bytes as unknown as BodyInit,
      });
    } catch (error) {
      throw new RegistryClientError(
        "REGISTRY_ARTIFACT_UPLOAD_FAILED",
        error instanceof Error ? `Artifact upload failed: ${error.message}` : "Artifact upload failed.",
      );
    }
    if (!response.ok) {
      throw new RegistryClientError("REGISTRY_ARTIFACT_UPLOAD_FAILED", `Artifact upload returned HTTP ${response.status}.`, response.status);
    }
  }

  async completeRelease(
    releaseId: string,
    request: RegistryReleaseCompletionRequest,
    auth: RegistryAuthInput,
  ): Promise<RegistryReleaseCompletionResponse> {
    assertReleaseId(releaseId);
    const requestValidation = validateRegistryReleaseCompletionRequest(request);
    if (!requestValidation.valid) {
      throw new RegistryClientError("REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "The release completion request is invalid.");
    }
    return this.#request(
      `/v1/releases/${encodeURIComponent(releaseId)}/complete`,
      validateRegistryReleaseCompletionResponse,
      undefined,
      requestInit(auth, requestValidation.value),
    );
  }

  async #request<T>(
    path: string,
    validate: (input: unknown) => { valid: true; value: T; issues: readonly [] } | { valid: false; issues: readonly { message: string }[] },
    specialHttpCode?: "REGISTRY_PACKAGE_NOT_FOUND" | "REGISTRY_RELEASE_NOT_FOUND" | "REGISTRY_AUTH_REQUIRED",
    init: RequestInit = {},
  ): Promise<T> {
    const url = new URL(path.replace(/^\/+/, ""), this.#baseUrl);
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      if (!headers.has("accept")) headers.set("accept", "application/json");
      response = await this.#fetch(url, { ...init, headers });
    } catch (error) {
      throw new RegistryClientError(
        "REGISTRY_NETWORK_ERROR",
        error instanceof Error ? `Registry request failed: ${error.message}` : "Registry request failed.",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RegistryClientError("REGISTRY_RESPONSE_INVALID", "The registry returned invalid JSON.", response.status);
    }
    if (!response.ok) {
      const errorResult = validateRegistryApiError(body);
      const message = errorResult.valid ? errorResult.value.error.message : `Registry returned HTTP ${response.status}.`;
      throw new RegistryClientError(
        response.status === 404 && (specialHttpCode === "REGISTRY_PACKAGE_NOT_FOUND" || specialHttpCode === "REGISTRY_RELEASE_NOT_FOUND")
          ? specialHttpCode
          : response.status === 401 && specialHttpCode === "REGISTRY_AUTH_REQUIRED"
            ? specialHttpCode
            : "REGISTRY_HTTP_ERROR",
        message,
        response.status,
      );
    }
    const result = validate(body);
    if (!result.valid) {
      throw new RegistryClientError(
        "REGISTRY_RESPONSE_INVALID",
        result.issues[0]?.message ?? "The registry response does not match the versioned contract.",
        response.status,
      );
    }
    return result.value;
  }
}

function parseBaseUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RegistryClientError("REGISTRY_URL_INVALID", "Registry URL must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RegistryClientError("REGISTRY_URL_INVALID", "Registry URL must use HTTP or HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  url.search = "";
  url.hash = "";
  return url;
}

function parseDownloadUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RegistryClientError("REGISTRY_ARTIFACT_DOWNLOAD_FAILED", "Artifact download URL is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new RegistryClientError("REGISTRY_ARTIFACT_DOWNLOAD_FAILED", "Artifact download URL must use HTTPS.");
  }
  return url;
}

function parseUploadUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RegistryClientError("REGISTRY_ARTIFACT_UPLOAD_FAILED", "Artifact upload URL is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new RegistryClientError("REGISTRY_ARTIFACT_UPLOAD_FAILED", "Artifact upload URL must use HTTPS.");
  }
  return url;
}

function requestInit(auth: RegistryAuthInput, body: unknown): RequestInit {
  const authInit = authRequestInit(auth);
  const headers = new Headers(authInit.headers);
  headers.set("content-type", "application/json");
  return {
    ...authInit,
    method: "POST",
    headers,
    body: JSON.stringify(body),
  };
}

function authRequestInit(auth: RegistryAuthInput): RequestInit {
  const accessToken = typeof auth === "string" ? auth : auth.accessToken;
  if (typeof accessToken !== "string" || accessToken.length < 1 || accessToken.length > 16_384 || /[^\u0021-\u007e]/.test(accessToken)) {
    throw new RegistryClientError("REGISTRY_AUTH_REQUIRED", "A valid registry authentication credential is required.");
  }
  return {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  };
}

function assertReleaseId(value: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /[^\u0021-\u007e]/.test(value)) {
    throw new RegistryClientError("REGISTRY_REQUEST_INVALID", "Release ID is invalid.");
  }
}

function assertPackageCoordinate(coordinate: RegistryPackageCoordinate): void {
  if (!PACKAGE_PART.test(coordinate.namespace) || !PACKAGE_PART.test(coordinate.name)) {
    throw new RegistryClientError("REGISTRY_REQUEST_INVALID", "Package coordinates must use lowercase names and single hyphens.");
  }
}

function assertReleaseCoordinate(coordinate: RegistryReleaseCoordinate): void {
  assertPackageCoordinate(coordinate);
  if (!SEMVER.test(coordinate.version)) {
    throw new RegistryClientError("REGISTRY_REQUEST_INVALID", "Release versions must use semantic versioning.");
  }
}

export {
  FileRegistryCredentialStore,
  RegistryCredentialStoreError,
  defaultRegistryCredentialPath,
} from "./auth-store.js";
export type {
  RegistryCredentialStatus,
  RegistryCredentialStore,
} from "./auth-store.js";
export {
  GitHubOAuthClient,
  GitHubOAuthError,
  GitHubHostedOAuthFlow,
  GitHubPublisherTokenVerifier,
  InMemoryGitHubOAuthStateStore,
} from "./github-oauth.js";
export type {
  GitHubAuthorizationRequest,
  GitHubDeviceCode,
  GitHubHostedAuthorization,
  GitHubOAuthStateStore,
  GitHubOAuthClientOptions,
  GitHubOAuthErrorCode,
} from "./github-oauth.js";
