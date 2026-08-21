import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  REGISTRY_API_VERSION,
  validateRegistryArtifactUploadRequest,
  validateRegistryArtifactUploadResponse,
  validateRegistryAuthSessionResponse,
  validateRegistryAuthSessionMetadataResponse,
  validateRegistryAuthSessionRequest,
  validateRegistryModerationAuditEventListRequest,
  validateRegistryModerationAuditEventListResponse,
  validateRegistryPublisherIdentity,
  validateRegistryPublisherWorkspaceResponse,
  validateRegistryReport,
  validateRegistryReportRequest,
  validateRegistryReleaseModerationRequest,
  validateRegistryReleaseModerationResponse,
  validateRegistryDigestDenylistMutationRequest,
  validateRegistryDigestDenylistMutationResponse,
  validateRegistryDigestDenylistResponse,
  validateRegistryReleaseCoordinate,
  validateRegistryReleaseCompletionRequest,
  validateRegistryReleaseCompletionResponse,
  validateRegistryReleaseLookupResponse,
  validateRegistryReleaseReservation,
  validateRegistryReleaseReservationRequest,
  validateRegistrySearchRequest,
  validateRegistrySearchResponse,
  validateRegistryStatusResponse,
  type RegistryApiError,
  type RegistryArtifactUploadResponse,
  type RegistryAuthCredential,
  type RegistryAuthSession,
  type RegistryModerationAuditEventListRequest,
  type RegistryPublisherIdentity,
  type RegistryReportTarget,
  type RegistryReportRequest,
  type RegistryReleaseCoordinate,
  type RegistryReleaseModerationOperation,
  type RegistryDigestDenylistMutationRequest,
  type RegistryReleaseCompletionResponse,
  type RegistrySearchRequest,
  type RegistrySessionScope,
  type RegistryOperationalStatus,
  type RegistryStatusQueue,
  type RegistryStatusResponse,
} from "@agentcargo/registry-contract";
import {
  RegistryReleaseReservationError,
  RegistryReleaseUploadError,
  RegistryModerationError,
  RegistryRepositoryError,
  type RegistryReleaseReservationRepository,
  type RegistryReleaseRepository,
  type RegistryReleaseUploadRepository,
  type RegistryModerationRepository,
  type RegistryPublisherWorkspaceRepository,
} from "@agentcargo/registry-db";
import { extractBearerToken, RegistryPublisherAuthError } from "./auth.js";
import type { RegistryPublisherContext, RegistrySessionExchange } from "./auth.js";
import type { RegistrySessionStore } from "./auth.js";
import {
  InMemoryRegistryRateLimiter,
  type RegistryRateLimitBucket,
  type RegistryRateLimitDecision,
  type RegistryRateLimiter,
  type RegistryRateLimitPolicy,
} from "./rate-limit.js";

export {
  InMemoryRegistryRateLimiter,
  RegistryRateLimiterError,
} from "./rate-limit.js";
export type {
  RegistryRateLimitBucket,
  RegistryRateLimitDecision,
  RegistryRateLimiter,
  RegistryRateLimitPolicy,
} from "./rate-limit.js";

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
  RegistrySessionContext,
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
  sessionStore?: Pick<RegistrySessionStore, "inspect" | "resolveContext">;
  publisherWorkspace?: RegistryPublisherWorkspaceRepository;
  moderation?: RegistryModerationRepository;
  resolveReporter?: RegistryReporterContextResolver;
  resolveMaintainer?: RegistryMaintainerContextResolver;
  hostedGitHubAuth?: RegistryHostedGitHubAuthOptions;
  /**
   * Abuse controls are injectable so a deployment can use a shared limiter.
   * The default is a bounded process-local limiter with conservative policies.
   */
  rateLimiter?: RegistryRateLimiter;
  rateLimitPolicies?: Partial<Record<RegistryRateLimitBucket, RegistryRateLimitPolicy>>;
  status?: RegistryStatusSources;
}

export interface RegistryStatusSourceResult {
  status: RegistryOperationalStatus;
  detail?: string;
}

export interface RegistryWorkerStatusSourceResult extends RegistryStatusSourceResult {
  ready: boolean;
  reason: string;
  totalRuns: number;
  claimedJobs: number;
  consecutiveFailures: number;
  lastRunAgeMs: number | null;
  queue: RegistryStatusQueue | null;
}

export interface RegistryStatusSources {
  now?: () => Date;
  database?: () => Promise<RegistryStatusSourceResult>;
  storage?: () => Promise<RegistryStatusSourceResult>;
  worker?: () => Promise<RegistryWorkerStatusSourceResult>;
  moderation?: () => Promise<RegistryStatusSourceResult & { activeDenylistEntries?: number | null }>;
}

const DEFAULT_RATE_LIMIT_POLICIES: Readonly<Record<RegistryRateLimitBucket, RegistryRateLimitPolicy>> = {
  auth: { limit: 20, windowMs: 60_000 },
  search: { limit: 120, windowMs: 60_000 },
  reporting: { limit: 10, windowMs: 60_000 },
  publishing: { limit: 30, windowMs: 60_000 },
  moderation: { limit: 30, windowMs: 60_000 },
};

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

export type RegistryReporterContextResolver = (
  request: FastifyRequest,
  target: RegistryReportTarget,
) => Promise<RegistryPublisherContext | { identity: RegistryPublisherIdentity; scopes?: readonly RegistrySessionScope[] } | null>;

export interface RegistryMaintainerContext {
  identity: RegistryPublisherIdentity;
  role: "maintainer";
}

export type RegistryMaintainerContextResolver = (
  request: FastifyRequest,
) => Promise<RegistryMaintainerContext | null>;

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

interface AuditEventQuery {
  cursor?: unknown;
  limit?: unknown;
}

export function buildRegistryApp(options: RegistryApiOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const rateLimiter = options.rateLimiter ?? new InMemoryRegistryRateLimiter();
  const rateLimitPolicies = { ...DEFAULT_RATE_LIMIT_POLICIES, ...options.rateLimitPolicies };
  const enforceRateLimit = (bucket: RegistryRateLimitBucket, request: FastifyRequest, reply: FastifyReply) =>
    applyRateLimit(rateLimiter, rateLimitPolicies[bucket], bucket, request, reply);

  app.get("/v1/status", async (request, reply) => {
    const status = await buildRegistryStatus(options);
    const validation = validateRegistryStatusResponse(status);
    if (!validation.valid) {
      return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned invalid operational status metadata.", request.id);
    }
    return reply.header("cache-control", "public, max-age=15, stale-while-revalidate=30").send(validation.value);
  });

  app.get("/v1/auth/github/start", async (request, reply) => {
    const limited = await enforceRateLimit("auth", request, reply);
    if (limited) return limited;
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
    const limited = await enforceRateLimit("auth", request, reply);
    if (limited) return limited;
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
    const limited = await enforceRateLimit("auth", request, reply);
    if (limited) return limited;
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

  app.get("/v1/auth/session", async (request, reply) => {
    const limited = await enforceRateLimit("auth", request, reply);
    if (limited) return limited;
    if (!options.sessionStore) {
      return sendError(
        reply,
        501,
        "REGISTRY_AUTH_NOT_CONFIGURED",
        "Registry session inspection is not configured on this registry instance.",
        request.id,
      );
    }
    const accessToken = extractBearerToken(request.headers.authorization);
    if (!accessToken) {
      return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid AgentCargo bearer session is required.", request.id);
    }

    let session: Awaited<ReturnType<RegistrySessionStore["inspect"]>>;
    try {
      session = await options.sessionStore.inspect(accessToken);
    } catch {
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The registry session store is unavailable.", request.id);
    }
    if (!session) {
      return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid AgentCargo bearer session is required.", request.id);
    }

    const validation = validateRegistryAuthSessionMetadataResponse({ apiVersion: REGISTRY_API_VERSION, session });
    if (!validation.valid) {
      return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned invalid session metadata.", request.id);
    }
    return reply.header("cache-control", "no-store").send(validation.value);
  });

  app.get("/v1/publisher/workspace", async (request, reply) => {
    const limited = await enforceRateLimit("moderation", request, reply);
    if (limited) return limited;
    if (!options.sessionStore || !options.publisherWorkspace) {
      return sendError(
        reply,
        501,
        "REGISTRY_PUBLISHER_NOT_CONFIGURED",
        "Authenticated publisher management is not configured on this registry instance.",
        request.id,
      );
    }
    const accessToken = extractBearerToken(request.headers.authorization);
    if (!accessToken) {
      return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid AgentCargo bearer session is required.", request.id);
    }

    let publisher: RegistryPublisherContext | null;
    try {
      publisher = await options.sessionStore.resolveContext(accessToken);
    } catch {
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The registry session store is unavailable.", request.id);
    }
    if (!publisher) {
      return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid AgentCargo bearer session is required.", request.id);
    }
    if (!hasPublisherScope(publisher, "publisher:read")) {
      return sendError(reply, 403, "REGISTRY_SCOPE_FORBIDDEN", "The registry session is not authorized for publisher reads.", request.id);
    }

    try {
      const workspace = await options.publisherWorkspace.getWorkspace(publisher.identity);
      const validation = validateRegistryPublisherWorkspaceResponse(workspace);
      if (!validation.valid) {
        return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned an invalid publisher workspace.", request.id);
      }
      return reply.header("cache-control", "no-store").send(validation.value);
    } catch (error) {
      return sendRepositoryError(reply, error, request.id);
    }
  });

  app.post("/v1/reports", async (request, reply) => {
    const limited = await enforceRateLimit("reporting", request, reply);
    if (limited) return limited;
    if (!options.moderation || !options.resolveReporter) {
      return sendError(reply, 501, "REGISTRY_REPORTING_NOT_CONFIGURED", "Authenticated reporting is not configured on this registry instance.", request.id);
    }
    const requestValidation = validateRegistryReportRequest(request.body);
    if (!requestValidation.valid) {
      return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "Invalid moderation report request.", request.id);
    }
    let reporter: Awaited<ReturnType<RegistryReporterContextResolver>>;
    try {
      reporter = await options.resolveReporter(request, requestValidation.value.target);
    } catch (error) {
      if (error instanceof RegistryPublisherAuthError) return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", error.message, request.id);
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The publisher identity provider is unavailable.", request.id);
    }
    if (!reporter) return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid authenticated identity is required to submit a report.", request.id);
    const identityValidation = validateRegistryPublisherIdentity(reporter.identity);
    if (!identityValidation.valid) return sendError(reply, 500, "REGISTRY_AUTH_CONTEXT_INVALID", "The authentication adapter returned an invalid publisher identity.", request.id);

    try {
      const result = await options.moderation.createReport({
        actor: identityValidation.value,
        request: requestValidation.value,
        requestId: request.id,
      });
      const responseValidation = validateRegistryReport(result.report);
      if (!responseValidation.valid) return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned an invalid moderation report.", request.id);
      return reply.code(result.replayed ? 200 : 201).header("cache-control", "no-store").send(responseValidation.value);
    } catch (error) {
      return sendModerationError(reply, error, request.id);
    }
  });

  app.get<{ Querystring: AuditEventQuery }>("/v1/admin/audit-events", async (request, reply) => {
    const limited = await enforceRateLimit("moderation", request, reply);
    if (limited) return limited;
    if (!options.moderation || !options.resolveMaintainer) {
      return sendError(reply, 501, "REGISTRY_MODERATION_NOT_CONFIGURED", "Maintainer moderation reads are not configured on this registry instance.", request.id);
    }
    const query = parseAuditEventQuery(request.query);
    if (!query.valid) return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", query.message, request.id);
    let maintainer: RegistryMaintainerContext | null;
    try {
      maintainer = await options.resolveMaintainer(request);
    } catch (error) {
      if (error instanceof RegistryPublisherAuthError) return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", error.message, request.id);
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The maintainer identity provider is unavailable.", request.id);
    }
    if (!maintainer) return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid maintainer identity is required.", request.id);
    const identityValidation = validateRegistryPublisherIdentity(maintainer.identity);
    if (!identityValidation.valid || maintainer.role !== "maintainer") return sendError(reply, 403, "REGISTRY_MAINTAINER_FORBIDDEN", "The authenticated identity is not authorized for moderation reads.", request.id);
    try {
      const response = await options.moderation.listAuditEvents(query.value);
      const responseValidation = validateRegistryModerationAuditEventListResponse(response);
      if (!responseValidation.valid) return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned invalid moderation audit events.", request.id);
      return reply.header("cache-control", "no-store").send(responseValidation.value);
    } catch (error) {
      return sendModerationError(reply, error, request.id);
    }
  });

  app.post<{ Params: ReleaseParams }>("/v1/packages/:namespace/:name/versions/:version/deprecate", async (request, reply) => {
    const limited = await enforceRateLimit("moderation", request, reply);
    if (limited) return limited;
    return moderateReleaseRoute(options, request, reply, "deprecate", "publisher");
  });

  app.post<{ Params: ReleaseParams }>("/v1/admin/packages/:namespace/:name/versions/:version/quarantine", async (request, reply) => {
    const limited = await enforceRateLimit("moderation", request, reply);
    if (limited) return limited;
    return moderateReleaseRoute(options, request, reply, "quarantine", "maintainer");
  });

  app.post<{ Params: ReleaseParams }>("/v1/admin/packages/:namespace/:name/versions/:version/unquarantine", async (request, reply) => {
    const limited = await enforceRateLimit("moderation", request, reply);
    if (limited) return limited;
    return moderateReleaseRoute(options, request, reply, "unquarantine", "maintainer");
  });

  app.get("/v1/security/denylist", async (request, reply) => {
    const limited = await enforceRateLimit("moderation", request, reply);
    if (limited) return limited;
    if (!options.moderation) return sendError(reply, 501, "REGISTRY_DENYLIST_NOT_CONFIGURED", "Digest denylist enforcement is not configured on this registry instance.", request.id);
    try {
      const response = await options.moderation.listDenylistedDigests();
      const validation = validateRegistryDigestDenylistResponse(response);
      if (!validation.valid) return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned invalid digest denylist metadata.", request.id);
      return reply.header("cache-control", "no-store").send(validation.value);
    } catch (error) {
      return sendModerationError(reply, error, request.id);
    }
  });

  app.post("/v1/admin/security/denylist", async (request, reply) => {
    const limited = await enforceRateLimit("moderation", request, reply);
    if (limited) return limited;
    if (!options.moderation || !options.resolveMaintainer) return sendError(reply, 501, "REGISTRY_DENYLIST_NOT_CONFIGURED", "Maintainer digest denylist controls are not configured on this registry instance.", request.id);
    const requestValidation = validateRegistryDigestDenylistMutationRequest(request.body);
    if (!requestValidation.valid) return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "Invalid digest denylist request.", request.id);
    let maintainer: RegistryMaintainerContext | null;
    try {
      maintainer = await options.resolveMaintainer(request);
    } catch (error) {
      if (error instanceof RegistryPublisherAuthError) return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", error.message, request.id);
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The maintainer identity provider is unavailable.", request.id);
    }
    if (!maintainer) return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid maintainer identity is required.", request.id);
    if (maintainer.role !== "maintainer") return sendError(reply, 403, "REGISTRY_MAINTAINER_FORBIDDEN", "The authenticated identity is not authorized for digest denylist changes.", request.id);
    const identity = validateRegistryPublisherIdentity(maintainer.identity);
    if (!identity.valid) return sendError(reply, 500, "REGISTRY_AUTH_CONTEXT_INVALID", "The authentication adapter returned an invalid maintainer identity.", request.id);
    try {
      const result = await options.moderation.mutateDenylist({ actor: identity.value, request: requestValidation.value, requestId: request.id });
      const responseValidation = validateRegistryDigestDenylistMutationResponse(result.response);
      if (!responseValidation.valid) return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned invalid digest denylist metadata.", request.id);
      return reply.code(result.replayed ? 200 : 201).header("cache-control", "no-store").send(responseValidation.value);
    } catch (error) {
      return sendModerationError(reply, error, request.id);
    }
  });

  app.get("/v1/search", async (request, reply) => {
    const limited = await enforceRateLimit("search", request, reply);
    if (limited) return limited;
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
      if (options.moderation) {
        try {
          if (await options.moderation.isDigestDenylisted(release.artifact.digest)) {
            return sendError(reply, 404, "REGISTRY_RELEASE_NOT_FOUND", "Release was not found.", request.id);
          }
        } catch (error) {
          return sendModerationError(reply, error, request.id);
        }
      }
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
    const limited = await enforceRateLimit("publishing", request, reply);
    if (limited) return limited;
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
    const limited = await enforceRateLimit("publishing", request, reply);
    if (limited) return limited;
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
    const limited = await enforceRateLimit("publishing", request, reply);
    if (limited) return limited;
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

async function buildRegistryStatus(options: RegistryApiOptions): Promise<RegistryStatusResponse> {
  const now = options.status?.now?.() ?? new Date();
  const checkedAt = Number.isNaN(now.getTime()) ? new Date().toISOString() : now.toISOString();
  const api = statusComponent("operational", checkedAt);
  const database = await readStatusComponent(options.status?.database, checkedAt, {
    status: "operational",
    detail: "Registry repository boundary configured.",
  });
  const storage = await readStatusComponent(options.status?.storage, checkedAt, {
    status: options.artifactStorage ? "operational" : "not_configured",
    detail: options.artifactStorage ? "Artifact storage boundary configured." : "Artifact storage is not configured.",
  });
  const moderation = await readModerationStatus(options, checkedAt);
  const worker = await readWorkerStatus(options.status?.worker, checkedAt);
  const components = { api, database, storage, worker, moderation };
  const requiredOutage = components.api.status === "unavailable" || components.database.status === "unavailable";
  const degraded = Object.values(components).some((component) => component.status !== "operational");
  return {
    apiVersion: REGISTRY_API_VERSION,
    generatedAt: checkedAt,
    overall: requiredOutage ? "outage" : degraded ? "degraded" : "operational",
    components,
  };
}

async function readStatusComponent(
  source: (() => Promise<RegistryStatusSourceResult>) | undefined,
  checkedAt: string,
  fallback: RegistryStatusSourceResult,
): Promise<{ status: RegistryOperationalStatus; checkedAt: string; detail?: string }> {
  if (!source) return statusComponent(fallback.status, checkedAt, fallback.detail);
  try {
    const result = await source();
    return statusComponent(normalizeStatus(result?.status), checkedAt, result?.detail);
  } catch {
    return statusComponent("unavailable", checkedAt, "Operational signal unavailable.");
  }
}

async function readModerationStatus(options: RegistryApiOptions, checkedAt: string): Promise<RegistryStatusResponse["components"]["moderation"]> {
  const source = options.status?.moderation;
  if (!source) {
    return {
      ...statusComponent(
        options.moderation ? "operational" : "not_configured",
        checkedAt,
        options.moderation ? "Moderation and denylist boundary configured." : "Moderation controls are not configured.",
      ),
      activeDenylistEntries: null,
    };
  }
  try {
    const result = await source();
    return {
      ...statusComponent(normalizeStatus(result?.status), checkedAt, result?.detail),
      activeDenylistEntries: typeof result?.activeDenylistEntries === "number" && Number.isSafeInteger(result.activeDenylistEntries) && result.activeDenylistEntries >= 0
        ? result.activeDenylistEntries
        : null,
    };
  } catch {
    return { ...statusComponent("unavailable", checkedAt, "Moderation operational signal unavailable."), activeDenylistEntries: null };
  }
}

async function readWorkerStatus(source: (() => Promise<RegistryWorkerStatusSourceResult>) | undefined, checkedAt: string): Promise<RegistryStatusResponse["components"]["worker"]> {
  if (!source) {
    return {
      ...statusComponent("not_configured", checkedAt, "Worker scheduler is not configured."),
      ready: false,
      reason: "not-configured",
      totalRuns: 0,
      claimedJobs: 0,
      consecutiveFailures: 0,
      lastRunAgeMs: null,
      queue: null,
    };
  }
  try {
    const result = await source();
    return {
      ...statusComponent(normalizeStatus(result?.status), checkedAt, result?.detail),
      ready: result?.ready === true,
      reason: sanitizeStatusDetail(result?.reason, "unknown", 64) ?? "unknown",
      totalRuns: safeCounter(result?.totalRuns),
      claimedJobs: safeCounter(result?.claimedJobs),
      consecutiveFailures: safeCounter(result?.consecutiveFailures),
      lastRunAgeMs: safeNullableCounter(result?.lastRunAgeMs),
      queue: normalizeQueue(result?.queue),
    };
  } catch {
    return {
      ...statusComponent("unavailable", checkedAt, "Worker operational signal unavailable."),
      ready: false,
      reason: "signal-unavailable",
      totalRuns: 0,
      claimedJobs: 0,
      consecutiveFailures: 0,
      lastRunAgeMs: null,
      queue: null,
    };
  }
}

function statusComponent(status: RegistryOperationalStatus, checkedAt: string, detail?: string): { status: RegistryOperationalStatus; checkedAt: string; detail?: string } {
  const safeDetail = sanitizeStatusDetail(detail);
  return safeDetail === undefined ? { status, checkedAt } : { status, checkedAt, detail: safeDetail };
}

function normalizeStatus(value: unknown): RegistryOperationalStatus {
  return value === "operational" || value === "degraded" || value === "unavailable" || value === "not_configured" ? value : "unavailable";
}

function sanitizeStatusDetail(value: unknown, fallback?: string, maxLength = 256): string | undefined {
  if (typeof value !== "string" || value.length === 0) return fallback;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, maxLength);
  return sanitized.length > 0 ? sanitized : fallback;
}

function safeCounter(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeNullableCounter(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return safeCounter(value);
}

function normalizeQueue(value: unknown): RegistryStatusQueue | null {
  if (!value || typeof value !== "object") return null;
  const queue = value as Partial<RegistryStatusQueue>;
  const oldestAvailableAt = typeof queue.oldestAvailableAt === "string" ? queue.oldestAvailableAt : null;
  return {
    queued: safeCounter(queue.queued),
    failed: safeCounter(queue.failed),
    running: safeCounter(queue.running),
    staleLeases: safeCounter(queue.staleLeases),
    oldestAvailableAt,
    lagMs: safeCounter(queue.lagMs),
  };
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

function parseAuditEventQuery(query: AuditEventQuery):
  | { valid: true; value: RegistryModerationAuditEventListRequest }
  | { valid: false; message: string } {
  const value: Record<string, unknown> = {};
  if (query.cursor !== undefined) value.cursor = query.cursor;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^\d+$/.test(query.limit)) return { valid: false, message: "The limit parameter must be an integer." };
    value.limit = Number(query.limit);
  }
  const result = validateRegistryModerationAuditEventListRequest(value);
  return result.valid ? result : { valid: false, message: result.issues[0]?.message ?? "Invalid audit event query." };
}

async function moderateReleaseRoute(
  options: RegistryApiOptions,
  request: FastifyRequest<{ Params: ReleaseParams }>,
  reply: FastifyReply,
  operation: RegistryReleaseModerationOperation,
  actorKind: "publisher" | "maintainer",
): Promise<FastifyReply> {
  if (!options.moderation) {
    return sendError(reply, 501, "REGISTRY_MODERATION_NOT_CONFIGURED", "Release moderation is not configured on this registry instance.", request.id);
  }
  const coordinateValidation = validateRegistryReleaseCoordinate(request.params);
  if (!coordinateValidation.valid) return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", coordinateValidation.issues[0]?.message ?? "Invalid release coordinate.", request.id);
  const requestValidation = validateRegistryReleaseModerationRequest(request.body);
  if (!requestValidation.valid) return sendError(reply, 400, "REGISTRY_REQUEST_INVALID", requestValidation.issues[0]?.message ?? "Invalid release moderation request.", request.id);

  let identity: RegistryPublisherIdentity;
  if (actorKind === "publisher") {
    if (!options.resolvePublisher) return sendError(reply, 501, "REGISTRY_MODERATION_NOT_CONFIGURED", "Publisher release moderation is not configured on this registry instance.", request.id);
    let publisher: Awaited<ReturnType<RegistryPublisherContextResolver>>;
    try {
      publisher = await options.resolvePublisher(request, coordinateValidation.value);
    } catch (error) {
      if (error instanceof RegistryPublisherAuthError) return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", error.message, request.id);
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The publisher identity provider is unavailable.", request.id);
    }
    if (!publisher) return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid publisher identity is required.", request.id);
    if (!hasPublisherScope(publisher, "publisher:write")) return sendError(reply, 403, "REGISTRY_SCOPE_FORBIDDEN", "The registry session is not authorized for publisher writes.", request.id);
    const validation = validateRegistryPublisherIdentity(publisher.identity);
    if (!validation.valid) return sendError(reply, 500, "REGISTRY_AUTH_CONTEXT_INVALID", "The authentication adapter returned an invalid publisher identity.", request.id);
    identity = validation.value;
  } else {
    if (!options.resolveMaintainer) return sendError(reply, 501, "REGISTRY_MODERATION_NOT_CONFIGURED", "Maintainer release moderation is not configured on this registry instance.", request.id);
    let maintainer: RegistryMaintainerContext | null;
    try {
      maintainer = await options.resolveMaintainer(request);
    } catch (error) {
      if (error instanceof RegistryPublisherAuthError) return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", error.message, request.id);
      return sendError(reply, 503, "REGISTRY_AUTH_UNAVAILABLE", "The maintainer identity provider is unavailable.", request.id);
    }
    if (!maintainer) return sendError(reply, 401, "REGISTRY_AUTH_REQUIRED", "A valid maintainer identity is required.", request.id);
    if (maintainer.role !== "maintainer") return sendError(reply, 403, "REGISTRY_MAINTAINER_FORBIDDEN", "The authenticated identity is not authorized for release moderation.", request.id);
    const validation = validateRegistryPublisherIdentity(maintainer.identity);
    if (!validation.valid) return sendError(reply, 500, "REGISTRY_AUTH_CONTEXT_INVALID", "The authentication adapter returned an invalid maintainer identity.", request.id);
    identity = validation.value;
  }

  try {
    const result = await options.moderation.moderateRelease({
      actor: identity,
      actorKind,
      coordinate: coordinateValidation.value,
      operation,
      request: requestValidation.value,
      requestId: request.id,
    });
    const responseValidation = validateRegistryReleaseModerationResponse(result.response);
    if (!responseValidation.valid) return sendError(reply, 500, "REGISTRY_RESPONSE_INVALID", "The registry returned invalid release moderation metadata.", request.id);
    return reply.code(result.replayed ? 200 : 201).header("cache-control", "no-store").send(responseValidation.value);
  } catch (error) {
    return sendModerationError(reply, error, request.id);
  }
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

async function applyRateLimit(
  limiter: RegistryRateLimiter,
  policy: RegistryRateLimitPolicy,
  bucket: RegistryRateLimitBucket,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | null> {
  const route = sanitizeRateLimitPart((request as FastifyRequest & { routeOptions?: { url?: string } }).routeOptions?.url ?? request.url.split("?", 1)[0], 160);
  const address = sanitizeRateLimitPart(request.ip, 96);
  const key = `${bucket}:${route}:${address}`;
  let decision: RegistryRateLimitDecision;
  try {
    decision = await limiter.consume({ key, limit: policy.limit, windowMs: policy.windowMs });
    if (!isRateLimitDecision(decision)) throw new Error("invalid rate limiter response");
  } catch {
    // Mutation paths must fail closed when their abuse-control dependency is
    // unavailable. The response intentionally contains no limiter internals.
    return sendError(reply, 503, "REGISTRY_RATE_LIMITER_UNAVAILABLE", "Request throttling is temporarily unavailable.", request.id);
  }

  reply
    .header("ratelimit-limit", String(decision.limit))
    .header("ratelimit-remaining", String(decision.remaining))
    .header("ratelimit-reset", String(Math.max(0, Math.ceil(decision.resetAt / 1_000))));
  if (decision.allowed) return null;
  reply.header("retry-after", String(decision.retryAfterSeconds)).header("cache-control", "no-store");
  return sendError(reply, 429, "REGISTRY_RATE_LIMITED", "Too many requests; retry after the indicated delay.", request.id);
}

function sanitizeRateLimitPart(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0) return "unknown";
  return value.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, maxLength);
}

function isRateLimitDecision(value: unknown): value is RegistryRateLimitDecision {
  if (typeof value !== "object" || value === null) return false;
  const decision = value as Partial<RegistryRateLimitDecision>;
  const { allowed, limit, remaining, resetAt, retryAfterSeconds } = decision;
  return typeof allowed === "boolean" &&
    typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 1 &&
    typeof remaining === "number" && Number.isSafeInteger(remaining) && remaining >= 0 && remaining <= limit &&
    typeof resetAt === "number" && Number.isFinite(resetAt) && resetAt >= 0 &&
    typeof retryAfterSeconds === "number" && Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 0;
}

function sendRepositoryError(reply: FastifyReply, error: unknown, requestId: string): FastifyReply {
  if (error instanceof RegistryRepositoryError && (error.code === "REGISTRY_ROW_INVALID" || error.code === "REGISTRY_MODERATION_RESULT_INVALID")) {
    return sendError(reply, 500, error.code, error.code === "REGISTRY_MODERATION_RESULT_INVALID" ? "The registry contains invalid moderation metadata." : "The registry contains invalid release metadata.", requestId);
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

function sendModerationError(reply: FastifyReply, error: unknown, requestId: string): FastifyReply {
  if (error instanceof RegistryModerationError) {
    if (error.code === "REGISTRY_REPORT_IDEMPOTENCY_CONFLICT") return sendError(reply, 409, error.code, error.message, requestId);
    if (error.code === "REGISTRY_RELEASE_MODERATION_IDEMPOTENCY_CONFLICT") return sendError(reply, 409, error.code, error.message, requestId);
    if (error.code === "REGISTRY_RELEASE_MODERATION_NOT_FOUND") return sendError(reply, 404, error.code, error.message, requestId);
    if (error.code === "REGISTRY_RELEASE_MODERATION_FORBIDDEN") return sendError(reply, 403, error.code, error.message, requestId);
    if (error.code === "REGISTRY_RELEASE_MODERATION_CONFLICT") return sendError(reply, 409, error.code, error.message, requestId);
    if (error.code === "REGISTRY_DIGEST_DENYLIST_IDEMPOTENCY_CONFLICT" || error.code === "REGISTRY_DIGEST_DENYLIST_CONFLICT") return sendError(reply, 409, error.code, error.message, requestId);
    if (error.code === "REGISTRY_REPORT_INVALID" || error.code === "REGISTRY_AUDIT_EVENT_INVALID" || error.code === "REGISTRY_RELEASE_MODERATION_INVALID" || error.code === "REGISTRY_DIGEST_DENYLIST_INVALID") return sendError(reply, 500, error.code, error.message, requestId);
  }
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
