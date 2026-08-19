import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  REGISTRY_API_VERSION,
  validateRegistryArtifactUploadRequest,
  validateRegistryArtifactUploadResponse,
  validateRegistryAuthSessionResponse,
  validateRegistryAuthSessionRequest,
  validateRegistryPublisherIdentity,
  validateRegistryReleaseCoordinate,
  validateRegistryReleaseCompletionRequest,
  validateRegistryReleaseCompletionResponse,
  validateRegistryReleaseLookupResponse,
  validateRegistryReleaseReservation,
  validateRegistryReleaseReservationRequest,
  validateRegistrySearchRequest,
  validateRegistrySearchResponse,
  type RegistryApiError,
  type RegistryArtifactUploadResponse,
  type RegistryAuthCredential,
  type RegistryAuthSession,
  type RegistryPublisherIdentity,
  type RegistryReleaseCoordinate,
  type RegistryReleaseCompletionResponse,
  type RegistrySearchRequest,
  type RegistrySessionScope,
} from "@agentcargo/registry-contract";
import {
  RegistryReleaseReservationError,
  RegistryReleaseUploadError,
  RegistryRepositoryError,
  type RegistryReleaseReservationRepository,
  type RegistryReleaseRepository,
  type RegistryReleaseUploadRepository,
} from "@agentcargo/registry-db";
import { extractBearerToken, RegistryPublisherAuthError } from "./auth.js";
import type { RegistryPublisherContext, RegistrySessionExchange } from "./auth.js";

export {
  createBearerPublisherResolver,
  createSessionCookiePublisherResolver,
  createScopedSessionCookiePublisherResolver,
  extractBearerToken,
  extractCookieToken,
  RegistryPublisherAuthError,
  InMemoryRegistrySessionStore,
  ProviderSessionExchange,
} from "./auth.js";
export type {
  RegistryPublisherContext,
  RegistryPublisherTokenVerifier,
  RegistrySessionExchange,
  RegistrySessionStore,
} from "./auth.js";

export interface RegistryApiOptions {
  repository: RegistryReleaseRepository;
  /**
   * Authentication and namespace authorization are intentionally injected.
   * Provider-specific verification and namespace policy stay outside this
   * package; a missing resolver keeps the mutation route visibly unavailable
   * instead of creating an unauthenticated publishing path.
   */
  resolvePublisher?: RegistryPublisherContextResolver;
  releaseReservations?: RegistryReleaseReservationRepository;
  resolveReleasePublisher?: RegistryReleasePublisherContextResolver;
  releaseUploads?: RegistryReleaseUploadRepository;
  artifactStorage?: RegistryArtifactStorageBoundary;
  sessionExchange?: RegistrySessionExchange;
  hostedGitHubAuth?: RegistryHostedGitHubAuthOptions;
}

export interface RegistryHostedOAuthFlow {
  begin(options: {
    redirectUri: string;
    scopes?: readonly string[];
  }): Promise<{ authorizationUrl: string; state: string; expiresAt: string }>;
  complete(options: { code: string; state: string; redirectUri: string }): Promise<RegistryAuthCredential>;
}

export interface RegistryHostedGitHubAuthOptions {
  flow: RegistryHostedOAuthFlow;
  sessionExchange: RegistrySessionExchange;
  redirectUri: string;
  scopes?: readonly string[];
  successRedirect?: string;
  cookieName?: string;
}

export type RegistryPublisherContextResolver = (
  request: FastifyRequest,
  coordinate: RegistryReleaseCoordinate,
) => Promise<RegistryPublisherContext | { identity: RegistryPublisherIdentity; scopes?: readonly RegistrySessionScope[] } | null>;

export type RegistryReleasePublisherContextResolver = (
  request: FastifyRequest,
  releaseId: string,
) => Promise<RegistryPublisherContext | { identity: RegistryPublisherIdentity; scopes?: readonly RegistrySessionScope[] } | null>;

export interface RegistryArtifactStorageBoundary {
  createUpload(digest: string, bytes: number): Promise<{ url: string; expiresAt: string }>;
  assertUploaded(digest: string, bytes: number): Promise<{ key: string; digest: string; bytes: number; contentType: string }>;
}

interface SearchQuery {
  q?: unknown;
  host?: unknown;
  scope?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

interface CoordinateParams {
  namespace: string;
  name: string;
}

interface ReleaseParams extends CoordinateParams {
  version: string;
}

interface ReleaseIdParams {
  releaseId: string;
}

interface ReleaseReservationBody {
  version?: unknown;
  idempotencyKey?: unknown;
}

interface GitHubCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

export function buildRegistryApp(options: RegistryApiOptions): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/v1/auth/github/start", async (request, reply) => {
    const hosted = options.hostedGitHubAuth;
    if (!hosted) {
      return sendError(
        reply,
        501,
        "REGISTRY_AUTH_NOT_CONFIGURED",
        "Hosted authentication is not configured on this registry instance.",
        request.id,
      );
    }
    let started: Awaited<ReturnType<RegistryHostedOAuthFlow["begin"]>>;
    try {
      started = await hosted.flow.begin(
        hosted.scopes === undefined ? { redirectUri: hosted.redirectUri } : { redirectUri: hosted.redirectUri, scopes: hosted.scopes },
      );
    } catch {
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The identity provider is unavailable.", request.id);
    }
    if (!isGitHubAuthorizationUrl(started.authorizationUrl)) {
      return sendError(reply, 500, "REGISTRY_AUTH_CONTEXT_INVALID", "The authentication adapter returned an invalid authorization URL.", request.id);
    }
    return reply.code(302).header("location", started.authorizationUrl).header("cache-control", "no-store").send();
  });

  app.get<{ Querystring: GitHubCallbackQuery }>("/v1/auth/github/callback", async (request, reply) => {
    const hosted = options.hostedGitHubAuth;
    if (!hosted) {
      return sendError(
        reply,
        501,
        "REGISTRY_AUTH_NOT_CONFIGURED",
        "Hosted authentication is not configured on this registry instance.",
        request.id,
      );
    }
    if (request.query.error !== undefined || typeof request.query.code !== "string" || typeof request.query.state !== "string") {
      return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "The GitHub authentication callback was not completed.", request.id);
    }
    let credential: RegistryAuthCredential;
    try {
      credential = await hosted.flow.complete({
        code: request.query.code,
        state: request.query.state,
        redirectUri: hosted.redirectUri,
      });
    } catch (error) {
      if (isHostedAuthInvalid(error)) {
        return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "The GitHub authentication callback was invalid or expired.", request.id);
      }
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The identity provider is unavailable.", request.id);
    }
    let session: RegistryAuthSession | null;
    try {
      session = await hosted.sessionExchange.exchange(credential.accessToken);
    } catch {
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The identity provider is unavailable.", request.id);
    }
    if (!session) {
      return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "The GitHub authentication credential was rejected.", request.id);
    }
    const sessionResponse = { apiVersion: REGISTRY_API_VERSION, session };
    if (!validateRegistryAuthSessionResponse(sessionResponse).valid) {
      return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned an invalid authentication session.", request.id);
    }
    return reply
      .code(302)
      .header("location", safeHostedRedirect(hosted.successRedirect ?? "/"))
      .header("set-cookie", serializeSessionCookie(hosted.cookieName ?? "agentcargo_session", session))
      .header("cache-control", "no-store")
      .send();
  });

  app.post("/v1/auth/github/session", async (request, reply) => {
    if (!options.sessionExchange) {
      return sendError(
        reply,
        501,
        "REGISTRY_AUTH_NOT_CONFIGURED",
        "Hosted authentication is not configured on this registry instance.",
        request.id,
      );
    }
    const providerToken = extractBearerToken(request.headers.authorization);
    if (!providerToken) {
      return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid GitHub bearer credential is required.", request.id);
    }
    const scopeRequest = validateRegistryAuthSessionRequest(request.body ?? {});
    if (!scopeRequest.valid) {
      return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", scopeRequest.issues[0]?.message ?? "Invalid session scope request.", request.id);
    }
    let session: Awaited<ReturnType<RegistrySessionExchange["exchange"]>>;
    try {
      const exchangeOptions = scopeRequest.value.scopes === undefined ? {} : { scopes: scopeRequest.value.scopes };
      session = await options.sessionExchange.exchange(providerToken, exchangeOptions);
    } catch {
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The identity provider is unavailable.", request.id);
    }
    if (!session) {
      return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid GitHub bearer credential is required.", request.id);
    }
    const response = { apiVersion: REGISTRY_API_VERSION, session };
    const validation = validateRegistryAuthSessionResponse(response);
    if (!validation.valid) {
      return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned an invalid authentication session.", request.id);
    }
    return reply.code(201).header("cache-control", "no-store").send(validation.value);
  });

  app.get("/v1/search", async (request, reply) => {
    const parsed = parseSearchQuery(request.query as SearchQuery);
    if (!parsed.valid) return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", parsed.message, request.id);

    try {
      const response = await options.repository.search(parsed.value);
      const validation = validateRegistrySearchResponse(response);
      if (!validation.valid) {
        return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned an invalid search response.", request.id);
      }
      return reply.header("cache-control", "public, max-age=30").send(response);
    } catch (error) {
      return sendRepositoryError(reply, error, request.id);
    }
  });

  app.get<{ Params: CoordinateParams }>("/v1/packages/:namespace/:name", async (request, reply) => {
    const coordinate = request.params;
    try {
      const summary = await options.repository.getPackage(coordinate);
      if (!summary) return sendError(reply, 404, "REGISTRY_PACKAGE_NOT_FOUND", "Package was not found.", request.id);
      return reply.header("cache-control", "public, max-age=30").send(summary);
    } catch (error) {
      return sendRepositoryError(reply, error, request.id);
    }
  });

  app.get<{ Params: ReleaseParams }>("/v1/packages/:namespace/:name/versions/:version", async (request, reply) => {
    const coordinate: RegistryReleaseCoordinate = request.params;
    try {
      const release = await options.repository.getRelease(coordinate);
      if (!release) return sendError(reply, 404, "REGISTRY_RELEASE_NOT_FOUND", "Release was not found.", request.id);
      const response = { apiVersion: REGISTRY_API_VERSION, release };
      const validation = validateRegistryReleaseLookupResponse(response);
      if (!validation.valid) {
        return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned an invalid release response.", request.id);
      }
      return reply.header("cache-control", "public, max-age=30").send(response);
    } catch (error) {
      return sendRepositoryError(reply, error, request.id);
    }
  });

  app.post<{ Params: CoordinateParams }>("/v1/packages/:namespace/:name/releases", async (request, reply) => {
    if (!options.resolvePublisher || !options.releaseReservations) {
      return sendError(
        reply,
        501,
        "REGISTRY_PUBLISHING_NOT_CONFIGURED",
        "Authenticated publishing is not configured on this registry instance.",
        request.id,
      );
    }

    const body = request.body as ReleaseReservationBody;
    const requestValidation = validateRegistryReleaseReservationRequest(body);
    if (!requestValidation.valid) {
      return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "Invalid release reservation request.", request.id);
    }
    const coordinateValidation = validateRegistryReleaseCoordinate({
      ...request.params,
      version: requestValidation.value.version,
    });
    if (!coordinateValidation.valid) {
      return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", coordinateValidation.issues[0]?.message ?? "Invalid release coordinate.", request.id);
    }

    let publisher: Awaited<ReturnType<RegistryPublisherContextResolver>>;
    try {
      publisher = await options.resolvePublisher(request, coordinateValidation.value);
    } catch (error) {
      if (error instanceof RegistryPublisherAuthError) {
        return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", error.message, request.id);
      }
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The publisher identity provider is unavailable.", request.id);
    }
    if (!publisher) {
      return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid publisher identity is required.", request.id);
    }
    const identityValidation = validateRegistryPublisherIdentity(publisher.identity);
    if (!identityValidation.valid) {
      return sendError(reply, 500, "REGISTRY_AUTH_CONTEXT_INVALID", "The authentication adapter returned an invalid publisher identity.", request.id);
    }
    if (!hasPublisherScope(publisher, "publisher:write")) {
      return sendError(reply, 403, "REGISTRY_SCOPE_FORBIDDEN", "The registry session is not authorized for publisher writes.", request.id);
    }

    try {
      const result = await options.releaseReservations.reserveRelease({
        actor: publisher.identity,
        coordinate: coordinateValidation.value,
        idempotencyKey: requestValidation.value.idempotencyKey,
      });
      const responseValidation = validateRegistryReleaseReservation(result.reservation);
      if (!responseValidation.valid) {
        return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned an invalid release reservation.", request.id);
      }
      return reply
        .code(result.replayed ? 200 : 201)
        .header("cache-control", "no-store")
        .send(result.reservation);
    } catch (error) {
      return sendReservationError(reply, error, request.id);
    }
  });

  app.post<{ Params: ReleaseIdParams }>("/v1/releases/:releaseId/upload-url", async (request, reply) => {
    if (!options.resolveReleasePublisher || !options.releaseUploads || !options.artifactStorage) {
      return sendError(
        reply,
        501,
        "REGISTRY_PUBLISHING_NOT_CONFIGURED",
        "Artifact publishing is not configured on this registry instance.",
        request.id,
      );
    }
    const requestValidation = validateRegistryArtifactUploadRequest(request.body);
    if (!requestValidation.valid) {
      return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "Invalid artifact upload request.", request.id);
    }
    let publisher: Awaited<ReturnType<RegistryReleasePublisherContextResolver>>;
    try {
      publisher = await options.resolveReleasePublisher(request, request.params.releaseId);
    } catch (error) {
      if (error instanceof RegistryPublisherAuthError) return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", error.message, request.id);
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The publisher identity provider is unavailable.", request.id);
    }
    if (!publisher) return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid publisher identity is required.", request.id);
    const identityValidation = validateRegistryPublisherIdentity(publisher.identity);
    if (!identityValidation.valid) return sendError(reply, 500, "REGISTRY_AUTH_CONTEXT_INVALID", "The authentication adapter returned an invalid publisher identity.", request.id);
    if (!hasPublisherScope(publisher, "publisher:write")) {
      return sendError(reply, 403, "REGISTRY_SCOPE_FORBIDDEN", "The registry session is not authorized for publisher writes.", request.id);
    }

    try {
      const signedUpload = await options.artifactStorage.createUpload(requestValidation.value.digest, requestValidation.value.bytes);
      const reservation = await options.releaseUploads.reserveArtifactUpload({
        actor: publisher.identity,
        releaseId: request.params.releaseId,
        digest: requestValidation.value.digest,
        bytes: requestValidation.value.bytes,
      });
      const response: RegistryArtifactUploadResponse = {
        apiVersion: REGISTRY_API_VERSION,
        releaseId: reservation.reservation.releaseId,
        coordinate: reservation.reservation.coordinate,
        digest: requestValidation.value.digest,
        bytes: requestValidation.value.bytes,
        uploadUrl: signedUpload.url,
        expiresAt: signedUpload.expiresAt,
      };
      const responseValidation = validateRegistryArtifactUploadResponse(response);
      if (!responseValidation.valid) return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned an invalid artifact upload response.", request.id);
      return reply.code(reservation.replayed ? 200 : 201).header("cache-control", "no-store").send(responseValidation.value);
    } catch (error) {
      return sendReleaseUploadError(reply, error, request.id);
    }
  });

  app.post<{ Params: ReleaseIdParams }>("/v1/releases/:releaseId/complete", async (request, reply) => {
    if (!options.resolveReleasePublisher || !options.releaseUploads || !options.artifactStorage) {
      return sendError(
        reply,
        501,
        "REGISTRY_PUBLISHING_NOT_CONFIGURED",
        "Artifact publishing is not configured on this registry instance.",
        request.id,
      );
    }
    const requestValidation = validateRegistryReleaseCompletionRequest(request.body);
    if (!requestValidation.valid) {
      return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "Invalid release completion request.", request.id);
    }
    let publisher: Awaited<ReturnType<RegistryReleasePublisherContextResolver>>;
    try {
      publisher = await options.resolveReleasePublisher(request, request.params.releaseId);
    } catch (error) {
      if (error instanceof RegistryPublisherAuthError) return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", error.message, request.id);
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The publisher identity provider is unavailable.", request.id);
    }
    if (!publisher) return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid publisher identity is required.", request.id);
    const identityValidation = validateRegistryPublisherIdentity(publisher.identity);
    if (!identityValidation.valid) return sendError(reply, 500, "REGISTRY_AUTH_CONTEXT_INVALID", "The authentication adapter returned an invalid publisher identity.", request.id);
    if (!hasPublisherScope(publisher, "publisher:write")) {
      return sendError(reply, 403, "REGISTRY_SCOPE_FORBIDDEN", "The registry session is not authorized for publisher writes.", request.id);
    }

    let stored: Awaited<ReturnType<RegistryArtifactStorageBoundary["assertUploaded"]>>;
    try {
      stored = await options.artifactStorage.assertUploaded(requestValidation.value.artifact.digest, requestValidation.value.artifact.bytes);
    } catch (error) {
      return sendArtifactStorageError(reply, error, request.id);
    }
    if (stored.digest !== requestValidation.value.artifact.digest || stored.bytes !== requestValidation.value.artifact.bytes) {
      return sendError(reply, 409, "REGISTRY_ARTIFACT_METADATA_CONFLICT", "The uploaded artifact does not match the completion metadata.", request.id);
    }

    try {
      const result = await options.releaseUploads.completeRelease({
        actor: publisher.identity,
        releaseId: request.params.releaseId,
        artifactKey: stored.key,
        request: requestValidation.value,
      });
      const responseValidation = validateRegistryReleaseCompletionResponse(result.completion);
      if (!responseValidation.valid) return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned an invalid completion response.", request.id);
      return reply.code(result.replayed ? 200 : 202).header("cache-control", "no-store").send(responseValidation.value);
    } catch (error) {
      return sendReleaseUploadError(reply, error, request.id);
    }
  });

  app.setNotFoundHandler((request, reply) => {
    return sendError(reply, 404, "REGISTRY_ROUTE_NOT_FOUND", "Registry route was not found.", request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    return sendError(reply, 500, "REGISTRY_INTERNAL_ERROR", "The registry request failed.", request.id);
  });

  return app;
}

function parseSearchQuery(query: SearchQuery):
  | { valid: true; value: RegistrySearchRequest }
  | { valid: false; message: string } {
  const value: Record<string, unknown> = {};
  if (typeof query.q === "string") value.query = query.q;
  else if (query.q !== undefined) return { valid: false, message: "The q parameter must be a string." };
  if (query.host !== undefined) value.host = query.host;
  if (query.scope !== undefined) value.scope = query.scope;
  if (query.cursor !== undefined) value.cursor = query.cursor;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^\d+$/.test(query.limit)) {
      return { valid: false, message: "The limit parameter must be an integer." };
    }
    value.limit = Number(query.limit);
  }
  const result = validateRegistrySearchRequest(value);
  return result.valid ? result : { valid: false, message: result.issues[0]?.message ?? "Invalid search request." };
}

function isGitHubAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname === "/login/oauth/authorize" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function isHostedAuthInvalid(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { code?: unknown; status?: unknown };
  return value.code === "GITHUB_OAUTH_STATE_INVALID" || value.code === "GITHUB_OAUTH_TOKEN_REJECTED" ||
    value.code === "GITHUB_OAUTH_ACCESS_DENIED" || (value.code === "GITHUB_OAUTH_HTTP_ERROR" && value.status === 401);
}

function safeHostedRedirect(value: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://agentcargo.local");
    return url.origin === "https://agentcargo.local" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

function serializeSessionCookie(cookieName: string, session: RegistryAuthSession): string {
  const safeName = /^[A-Za-z0-9_]{1,64}$/.test(cookieName) ? cookieName : "agentcargo_session";
  const expiresAt = Date.parse(session.expiresAt);
  const maxAge = Number.isFinite(expiresAt) ? Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)) : 1;
  return `${safeName}=${session.accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function hasPublisherScope(
  publisher: { scopes?: readonly RegistrySessionScope[] },
  required: RegistrySessionScope,
): boolean {
  // Legacy injected resolvers predate scoped sessions. Keep them compatible;
  // every scoped resolver must provide an explicit allowlist.
  return publisher.scopes === undefined || publisher.scopes.includes(required);
}

function sendRepositoryError(reply: FastifyReply, error: unknown, requestId: string): FastifyReply {
  if (error instanceof RegistryRepositoryError && error.code === "REGISTRY_ROW_INVALID") {
    return sendError(reply, 500, error.code, "The registry contains invalid release metadata.", requestId);
  }
  return sendError(reply, 503, "REGISTRY_UNAVAILABLE", "The registry is temporarily unavailable.", requestId);
}

function sendReservationError(reply: FastifyReply, error: unknown, requestId: string): FastifyReply {
  if (error instanceof RegistryReleaseReservationError) {
    const statusCode =
      error.code === "REGISTRY_NAMESPACE_NOT_FOUND"
        ? 404
        : error.code === "REGISTRY_NAMESPACE_FORBIDDEN"
          ? 403
          : 409;
    return sendError(reply, statusCode, error.code, error.message, requestId);
  }
  return sendRepositoryError(reply, error, requestId);
}

function sendReleaseUploadError(reply: FastifyReply, error: unknown, requestId: string): FastifyReply {
  if (error instanceof RegistryReleaseUploadError) {
    const statusCode = error.code === "REGISTRY_RELEASE_UPLOAD_NOT_FOUND" ? 404 : 409;
    return sendError(reply, statusCode, error.code, error.message, requestId);
  }
  if (isArtifactStorageError(error)) return sendArtifactStorageError(reply, error, requestId);
  return sendRepositoryError(reply, error, requestId);
}

function sendArtifactStorageError(reply: FastifyReply, error: unknown, requestId: string): FastifyReply {
  const code = artifactStorageErrorCode(error);
  if (code === "ARTIFACT_NOT_FOUND") return sendError(reply, 409, "REGISTRY_ARTIFACT_NOT_UPLOADED", "The artifact has not been uploaded yet.", requestId);
  if (code === "ARTIFACT_DIGEST_MISMATCH" || code === "ARTIFACT_OBJECT_CONFLICT" || code === "ARTIFACT_SIZE_INVALID") {
    return sendError(reply, 409, "REGISTRY_ARTIFACT_METADATA_CONFLICT", "The uploaded artifact does not match the declared metadata.", requestId);
  }
  return sendError(reply, 503, "REGISTRY_STORAGE_UNAVAILABLE", "Artifact storage is temporarily unavailable.", requestId);
}

function isArtifactStorageError(error: unknown): boolean {
  return artifactStorageErrorCode(error) !== undefined;
}

function artifactStorageErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("ARTIFACT_") ? code : undefined;
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
): FastifyReply {
  const body: RegistryApiError = {
    apiVersion: REGISTRY_API_VERSION,
    error: { code, message, requestId },
  };
  return reply.code(statusCode).type("application/json").send(body);
}
