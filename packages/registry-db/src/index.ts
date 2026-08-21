import {
  REGISTRY_API_VERSION,
  AGENTCARGO_ARTIFACT_FORMAT,
  AGENTCARGO_ARTIFACT_MEDIA_TYPE,
  DEFAULT_REGISTRY_SESSION_SCOPES,
  formatPackageCoordinate,
  formatReleaseCoordinate,
  validateRegistryRelease,
  validateRegistryReleaseCompletionRequest,
  validateRegistryModerationAuditEventListResponse,
  validateRegistryReport,
  validateRegistryReportRequest,
  validateRegistryReleaseCoordinate,
  validateRegistryReleaseModerationRequest,
  validateRegistryReleaseModerationResponse,
  validateRegistryDigestDenylistMutationRequest,
  validateRegistryDigestDenylistMutationResponse,
  validateRegistryDigestDenylistResponse,
  validateRegistryPublisherIdentity,
  validateRegistryPublisherWorkspaceResponse,
  validateRegistrySearchResponse,
  type RegistryAuthSession,
  type RegistryModerationAuditEvent,
  type RegistryModerationAuditEventListRequest,
  type RegistryModerationAuditEventListResponse,
  type RegistryModerationAuditTarget,
  type RegistryReport,
  type RegistryReportRequest,
  type RegistryReportTarget,
  type RegistryReportStatus,
  type RegistryReportCategory,
  type RegistryReleaseModerationOperation,
  type RegistryReleaseModerationRequest,
  type RegistryReleaseModerationResponse,
  type RegistryReleaseStatus,
  type RegistryDigestDenylistAction,
  type RegistryDigestDenylistMutationRequest,
  type RegistryDigestDenylistMutationResponse,
  type RegistryDigestDenylistResponse,
  type RegistryDigestDenylistEntry,
  type RegistryReleaseCompletionRequest,
  type RegistryReleaseCompletionResponse,
  type RegistryPackageCoordinate,
  type RegistryPackageSummary,
  type RegistryPublisherIdentity,
  type RegistryPublisherPackageHistory,
  type RegistryPublisherReleaseSummary,
  type RegistryPublisherReleaseStatus,
  type RegistryPublisherWorkspaceResponse,
  type RegistryRelease,
  type RegistryReleaseCoordinate,
  type RegistryReleaseReservation,
  type RegistryScanSummary,
  type RegistrySearchRequest,
  type RegistrySearchResponse,
  type RegistrySessionScope,
} from "@agentcargo/registry-contract";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export interface RegistryReleaseRepository {
  getPackage(coordinate: RegistryPackageCoordinate): Promise<RegistryPackageSummary | null>;
  getRelease(coordinate: RegistryReleaseCoordinate): Promise<RegistryRelease | null>;
  search(request: RegistrySearchRequest): Promise<RegistrySearchResponse>;
}

export interface RegistryReleaseReservationInput {
  actor: RegistryPublisherIdentity;
  coordinate: RegistryReleaseCoordinate;
  idempotencyKey: string;
  now?: Date;
}

export interface RegistryReleaseReservationResult {
  reservation: RegistryReleaseReservation;
  replayed: boolean;
}

export interface RegistryReleaseReservationRepository {
  reserveRelease(input: RegistryReleaseReservationInput): Promise<RegistryReleaseReservationResult>;
}

export interface RegistryArtifactUploadInput {
  actor: RegistryPublisherIdentity;
  releaseId: string;
  digest: string;
  bytes: number;
  now?: Date;
}

export interface RegistryArtifactUploadResult {
  reservation: RegistryReleaseReservation;
  replayed: boolean;
}

export interface RegistryReleaseCompletionInput {
  actor: RegistryPublisherIdentity;
  releaseId: string;
  artifactKey: string;
  request: RegistryReleaseCompletionRequest;
  now?: Date;
}

export interface RegistryReleaseCompletionResult {
  completion: RegistryReleaseCompletionResponse;
  replayed: boolean;
}

export interface RegistryReleaseUploadRepository {
  reserveArtifactUpload(input: RegistryArtifactUploadInput): Promise<RegistryArtifactUploadResult>;
  completeRelease(input: RegistryReleaseCompletionInput): Promise<RegistryReleaseCompletionResult>;
}

export interface RegistryScanJob {
  jobId: string;
  releaseId: string;
  status: "running";
  attempts: number;
  leaseUntil: string;
}

/** Queue-only operational counters; this shape never contains package data. */
export interface RegistryScanQueueStats {
  queued: number;
  failed: number;
  running: number;
  staleLeases: number;
  oldestAvailableAt: string | null;
}

export interface RegistryScanRelease {
  releaseId: string;
  coordinate: RegistryReleaseCoordinate;
  artifactKey: string;
  completion: RegistryReleaseCompletionRequest;
}

export interface RegistryScanJobRepository {
  enqueuePending(now?: Date): Promise<number>;
  claim(now?: Date, leaseMs?: number): Promise<RegistryScanJob | null>;
  succeed(jobId: string, scan: RegistryScanSummary, now?: Date): Promise<void>;
  fail(jobId: string, message: string, retryAt: Date, now?: Date): Promise<void>;
  getQueueStats?(now?: Date): Promise<RegistryScanQueueStats>;
}

export interface RegistryReleaseScanRepository {
  getForScan(releaseId: string): Promise<RegistryScanRelease | null>;
  activate(releaseId: string, release: RegistryRelease): Promise<void>;
  reject(releaseId: string, scan: RegistryScanSummary, reason: string, now?: Date): Promise<void>;
}

export class RegistryScanJobError extends Error {
  constructor(
    public readonly code:
      | "REGISTRY_SCAN_JOB_NOT_FOUND"
      | "REGISTRY_SCAN_RELEASE_NOT_FOUND"
      | "REGISTRY_SCAN_ACTIVATION_CONFLICT"
      | "REGISTRY_SCAN_INVALID"
      | "REGISTRY_SCAN_DENYLISTED",
    message: string,
  ) {
    super(message);
    this.name = "RegistryScanJobError";
  }
}

export interface RegistryNamespaceClaimInput {
  actor: RegistryPublisherIdentity;
  namespace: string;
  now?: Date;
}

export interface RegistryNamespaceClaimResult {
  namespace: string;
  created: boolean;
}

export interface RegistryNamespaceRepository {
  claimNamespace(input: RegistryNamespaceClaimInput): Promise<RegistryNamespaceClaimResult>;
}

export interface RegistryPublisherWorkspaceRepository {
  getWorkspace(actor: RegistryPublisherIdentity): Promise<RegistryPublisherWorkspaceResponse>;
}

export interface RegistryReportInput {
  actor: RegistryPublisherIdentity;
  request: RegistryReportRequest;
  requestId: string;
  now?: Date;
}

export interface RegistryReportResult {
  report: RegistryReport;
  replayed: boolean;
}

export interface RegistryReleaseModerationInput {
  actor: RegistryPublisherIdentity;
  actorKind: "publisher" | "maintainer";
  coordinate: RegistryReleaseCoordinate;
  operation: RegistryReleaseModerationOperation;
  request: RegistryReleaseModerationRequest;
  requestId: string;
  now?: Date;
}

export interface RegistryReleaseModerationResult {
  response: RegistryReleaseModerationResponse;
  replayed: boolean;
}

export interface RegistryDigestDenylistMutationInput {
  actor: RegistryPublisherIdentity;
  request: RegistryDigestDenylistMutationRequest;
  requestId: string;
  now?: Date;
}

export interface RegistryDigestDenylistMutationResult {
  response: RegistryDigestDenylistMutationResponse;
  replayed: boolean;
}

export interface RegistryDigestDenylistReader {
  isDigestDenylisted(digest: string): Promise<boolean>;
}

export interface RegistryModerationRepository extends RegistryDigestDenylistReader {
  createReport(input: RegistryReportInput): Promise<RegistryReportResult>;
  moderateRelease(input: RegistryReleaseModerationInput): Promise<RegistryReleaseModerationResult>;
  mutateDenylist(input: RegistryDigestDenylistMutationInput): Promise<RegistryDigestDenylistMutationResult>;
  listDenylistedDigests(): Promise<RegistryDigestDenylistResponse>;
  isDigestDenylisted(digest: string): Promise<boolean>;
  listAuditEvents(input: RegistryModerationAuditEventListRequest): Promise<RegistryModerationAuditEventListResponse>;
}

export interface RegistryAuthSessionRow {
  provider: string;
  subject: string;
  login: string | null;
  scopes?: readonly string[];
  expires_at: string | Date;
}

/** Durable PostgreSQL session adapter for the API's provider-to-registry handoff. */
export class PostgresRegistrySessionStore {
  readonly #ttlSeconds: number;
  readonly #now: () => number;

  constructor(
    private readonly client: RegistrySqlClient,
    options: { now?: () => number; ttlSeconds?: number } = {},
  ) {
    this.#ttlSeconds = boundedSessionTtl(options.ttlSeconds ?? 900);
    this.#now = options.now ?? (() => Date.now());
  }

  async issue(identity: RegistryPublisherIdentity, options: { ttlSeconds?: number; scopes?: readonly RegistrySessionScope[] } = {}): Promise<RegistryAuthSession> {
    const validation = validateRegistryPublisherIdentity(identity);
    if (!validation.valid) throw new TypeError("Cannot issue a session for an invalid publisher identity.");
    const ttlSeconds = boundedSessionTtl(options.ttlSeconds ?? this.#ttlSeconds);
    const scopes = normalizeSessionScopes(options.scopes ?? DEFAULT_REGISTRY_SESSION_SCOPES);
    const issuedAt = this.#now();
    const expiresAt = issuedAt + ttlSeconds * 1000;
    const accessToken = `acs_${randomBytes(32).toString("base64url")}`;

    await this.query(
      `INSERT INTO registry_publishers (provider, subject, login)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, subject) DO UPDATE
       SET login = COALESCE(EXCLUDED.login, registry_publishers.login), updated_at = now()`,
      [identity.provider, identity.subject, identity.login ?? null],
    );
    await this.query(
      `INSERT INTO registry_auth_sessions
         (token_digest, provider, subject, scopes, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [hashSessionToken(accessToken), identity.provider, identity.subject, scopes, new Date(issuedAt).toISOString(), new Date(expiresAt).toISOString()],
    );
    return {
      accessToken,
      tokenType: "bearer",
      expiresAt: new Date(expiresAt).toISOString(),
      identity: clonePublisherIdentity(identity),
      scopes,
    };
  }

  async resolve(accessToken: string): Promise<RegistryPublisherIdentity | null> {
    const context = await this.resolveContext(accessToken);
    return context?.identity ?? null;
  }

  async resolveContext(accessToken: string): Promise<{ identity: RegistryPublisherIdentity; expiresAt: string; scopes: readonly RegistrySessionScope[] } | null> {
    const token = safeSessionToken(accessToken);
    if (!token) return null;
    const result = await this.query<RegistryAuthSessionRow>(
      `SELECT sessions.provider, sessions.subject, publishers.login, sessions.scopes, sessions.expires_at
       FROM registry_auth_sessions AS sessions
       JOIN registry_publishers AS publishers
         ON publishers.provider = sessions.provider AND publishers.subject = sessions.subject
       WHERE sessions.token_digest = $1
         AND sessions.revoked_at IS NULL
         AND sessions.expires_at > $2`,
      [hashSessionToken(token), new Date(this.#now()).toISOString()],
    );
    const row = result.rows[0];
    if (!row || row.provider !== "github") return null;
    const scopes = normalizeStoredSessionScopes(row.scopes);
    if (!scopes) return null;
    const expiresAt = dateValue(row.expires_at);
    if (Date.parse(expiresAt) <= this.#now()) return null;
    return {
      identity: {
        provider: "github",
        subject: row.subject,
        ...(row.login === null ? {} : { login: row.login }),
      },
      expiresAt,
      scopes,
    };
  }

  async inspect(accessToken: string): Promise<{ expiresAt: string; scopes: readonly RegistrySessionScope[] } | null> {
    const context = await this.resolveContext(accessToken);
    return context ? { expiresAt: context.expiresAt, scopes: [...context.scopes] } : null;
  }

  async revoke(accessToken: string): Promise<boolean> {
    const token = safeSessionToken(accessToken);
    if (!token) return false;
    const result = await this.query<{ token_digest: string }>(
      `UPDATE registry_auth_sessions
       SET revoked_at = $2
       WHERE token_digest = $1 AND revoked_at IS NULL
       RETURNING token_digest`,
      [hashSessionToken(token), new Date(this.#now()).toISOString()],
    );
    return Boolean(result.rows[0]);
  }

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }
}

export interface RegistryOAuthAuthorizationRequest {
  state: string;
  codeVerifier: string;
}

/** Durable, one-time OAuth callback state for a hosted deployment. */
export class PostgresRegistryOAuthStateStore {
  readonly #ttlSeconds: number;
  readonly #now: () => number;

  constructor(
    private readonly client: RegistrySqlClient,
    options: { now?: () => number; ttlSeconds?: number } = {},
  ) {
    this.#ttlSeconds = boundedSessionTtl(options.ttlSeconds ?? 600);
    this.#now = options.now ?? (() => Date.now());
  }

  async remember(
    request: RegistryOAuthAuthorizationRequest,
    redirectUri: string,
    options: { ttlSeconds?: number } = {},
  ): Promise<{ expiresAt: string }> {
    const state = validateOAuthStateValue(request.state, "OAuth state");
    const codeVerifier = validateOAuthStateValue(request.codeVerifier, "code verifier");
    const redirect = validateOAuthRedirectUri(redirectUri);
    const expiresAt = this.#now() + boundedSessionTtl(options.ttlSeconds ?? this.#ttlSeconds) * 1000;
    await this.query(
      `INSERT INTO registry_oauth_state (state_digest, code_verifier, redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (state_digest) DO UPDATE
       SET code_verifier = EXCLUDED.code_verifier,
           redirect_uri = EXCLUDED.redirect_uri,
           expires_at = EXCLUDED.expires_at`,
      [hashOpaqueValue(state), codeVerifier, redirect, new Date(expiresAt).toISOString()],
    );
    return { expiresAt: new Date(expiresAt).toISOString() };
  }

  async consume(state: string, redirectUri: string): Promise<{ codeVerifier: string } | null> {
    let normalizedState: string;
    let normalizedRedirect: string;
    try {
      normalizedState = validateOAuthStateValue(state, "OAuth state");
      normalizedRedirect = validateOAuthRedirectUri(redirectUri);
    } catch {
      return null;
    }
    const result = await this.query<{ code_verifier: string; redirect_uri: string; expires_at: string | Date }>(
      `DELETE FROM registry_oauth_state
       WHERE state_digest = $1
       RETURNING code_verifier, redirect_uri, expires_at`,
      [hashOpaqueValue(normalizedState)],
    );
    const row = result.rows[0];
    if (!row || row.redirect_uri !== normalizedRedirect || new Date(row.expires_at).getTime() <= this.#now()) return null;
    return { codeVerifier: row.code_verifier };
  }

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }
}

export interface RegistrySqlResult<Row> {
  rows: Row[];
}

/** The smallest pg-compatible surface needed by the repository. */
export interface RegistrySqlClient {
  query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>>;
}

export interface RegistryArtifactDownloadRequest {
  digest: string;
  artifactKey: string;
}

export type RegistryArtifactDownloadFactory = (
  request: RegistryArtifactDownloadRequest,
) => Promise<{ url: string; expiresAt: string }>;

export interface RegistryReleaseRow {
  release_json: unknown;
  artifact_key: string;
  status?: "active" | "deprecated";
}

export interface RegistryPackageRow {
  package_json: unknown;
}

export interface RegistrySearchRow {
  package_json: unknown;
}

interface RegistryNamespaceOwnerRow {
  namespace: string;
  owner_provider: string;
  owner_subject: string;
}

interface RegistryReleaseReservationRow {
  release_id: string;
  namespace: string;
  name: string;
  version: string;
  created_at: string | Date;
  expires_at: string | Date;
}

interface RegistryReleaseUploadRow extends RegistryReleaseReservationRow {
  digest: string;
  artifact_key: string;
  format: string;
  media_type: string;
  bytes: number;
  upload_status: "reserved" | "uploaded" | "scanning" | "rejected";
  completion_json: unknown;
  completed_at: string | Date | null;
}

interface RegistryPublisherWorkspaceRow {
  namespace: string;
  release_id: string | null;
  name: string | null;
  version: string | null;
  reservation_created_at: string | Date | null;
  expires_at: string | Date | null;
  upload_status: "reserved" | "uploaded" | "scanning" | "rejected" | null;
  digest: string | null;
  completed_at: string | Date | null;
  public_status: "reserved" | "uploaded" | "scanning" | "active" | "deprecated" | "quarantined" | "rejected" | null;
  published_at: string | Date | null;
}

interface RegistryReportRow {
  report_id: string;
  namespace: string;
  name: string;
  release_version: string | null;
  category: RegistryReportCategory;
  status: RegistryReportStatus;
  evidence: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface RegistryModerationAuditEventRow {
  event_id: string;
  action: RegistryModerationAuditEvent["action"];
  actor_kind: RegistryModerationAuditEvent["actor"]["kind"];
  actor_provider: string | null;
  actor_subject: string | null;
  target_type: RegistryModerationAuditTarget["type"];
  target_report_id: string | null;
  target_namespace: string | null;
  target_name: string | null;
  target_version: string | null;
  target_digest: string | null;
  occurred_at: string | Date;
  request_id: string;
  idempotency_key: string | null;
  metadata_json: unknown;
}

interface RegistryReleaseModerationRow {
  namespace: string;
  name: string;
  version: string;
  status: RegistryReleaseStatus;
  changed_at: string | Date;
  audit_event_id: string;
}

interface RegistryReleaseModerationAuditRow {
  event_id: string;
  action: RegistryModerationAuditEvent["action"];
  occurred_at: string | Date;
  metadata_json: unknown;
}

interface RegistryDigestDenylistRow {
  digest: string;
  reason: string;
  added_at: string | Date;
  updated_at?: string | Date;
  active?: boolean;
}

interface RegistryDenylistAuditRow {
  event_id: string;
  action: RegistryModerationAuditEvent["action"];
  occurred_at: string | Date;
  metadata_json: unknown;
}

interface RegistryDenylistMutationRow {
  digest: string;
  reason?: string;
  added_at?: string | Date;
  active: boolean;
  changed_at: string | Date;
  audit_event_id: string;
}

interface RegistryScanJobRow {
  job_id: string;
  release_id: string;
  status: "running";
  attempts: number;
  lease_until: string | Date;
}

interface RegistryScanReleaseRow {
  release_id: string;
  namespace: string;
  name: string;
  version: string;
  artifact_key: string;
  completion_json: unknown;
}

interface RegistryScanQueueStatsRow {
  queued: number | string;
  failed: number | string;
  running: number | string;
  stale_leases: number | string;
  oldest_available_at: string | Date | null;
}

export class RegistryRepositoryError extends Error {
  constructor(
    public readonly code:
      | "REGISTRY_ROW_INVALID"
      | "REGISTRY_SEARCH_RESULT_INVALID"
      | "REGISTRY_DB_QUERY_FAILED"
      | "REGISTRY_MODERATION_RESULT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "RegistryRepositoryError";
  }
}

export class RegistryModerationError extends Error {
  constructor(
    public readonly code:
      | "REGISTRY_REPORT_IDEMPOTENCY_CONFLICT"
      | "REGISTRY_REPORT_INVALID"
      | "REGISTRY_AUDIT_EVENT_INVALID"
      | "REGISTRY_RELEASE_MODERATION_INVALID"
      | "REGISTRY_RELEASE_MODERATION_FORBIDDEN"
      | "REGISTRY_RELEASE_MODERATION_NOT_FOUND"
      | "REGISTRY_RELEASE_MODERATION_CONFLICT"
      | "REGISTRY_RELEASE_MODERATION_IDEMPOTENCY_CONFLICT"
      | "REGISTRY_DIGEST_DENYLIST_INVALID"
      | "REGISTRY_DIGEST_DENYLIST_IDEMPOTENCY_CONFLICT"
      | "REGISTRY_DIGEST_DENYLIST_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "RegistryModerationError";
  }
}

export class RegistryReleaseReservationError extends Error {
  constructor(
    public readonly code:
      | "REGISTRY_IDEMPOTENCY_CONFLICT"
      | "REGISTRY_RELEASE_VERSION_RESERVED"
      | "REGISTRY_NAMESPACE_NOT_FOUND"
      | "REGISTRY_NAMESPACE_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "RegistryReleaseReservationError";
  }
}

export class RegistryNamespaceError extends Error {
  constructor(public readonly code: "REGISTRY_NAMESPACE_OWNED", message: string) {
    super(message);
    this.name = "RegistryNamespaceError";
  }
}

export class RegistryReleaseUploadError extends Error {
  constructor(
    public readonly code:
      | "REGISTRY_RELEASE_UPLOAD_NOT_FOUND"
      | "REGISTRY_ARTIFACT_UPLOAD_CONFLICT"
      | "REGISTRY_ARTIFACT_METADATA_CONFLICT"
      | "REGISTRY_RELEASE_COMPLETION_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "RegistryReleaseUploadError";
  }
}

/**
 * Deterministic in-memory reservation semantics for API tests and local
 * development. Production persistence belongs in the PostgreSQL repository;
 * this class deliberately stores no artifact or credential data.
 */
export class InMemoryRegistryReleaseReservationRepository implements RegistryReleaseReservationRepository {
  readonly #byIdempotency = new Map<string, { fingerprint: string; reservation: RegistryReleaseReservation }>();
  readonly #byCoordinate = new Map<string, RegistryReleaseReservation>();
  readonly #reservationTtlMs: number;

  constructor(options: { reservationTtlMs?: number } = {}) {
    this.#reservationTtlMs = options.reservationTtlMs ?? 30 * 60 * 1000;
  }

  async reserveRelease(input: RegistryReleaseReservationInput): Promise<RegistryReleaseReservationResult> {
    const actorKey = `${input.actor.provider}:${input.actor.subject}`;
    const idempotencyKey = `${actorKey}:${input.idempotencyKey}`;
    const fingerprint = `${input.coordinate.namespace}/${input.coordinate.name}@${input.coordinate.version}`;
    const existingRequest = this.#byIdempotency.get(idempotencyKey);
    if (existingRequest) {
      if (existingRequest.fingerprint !== fingerprint) {
        throw new RegistryReleaseReservationError(
          "REGISTRY_IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used for a different release coordinate.",
        );
      }
      return { reservation: structuredClone(existingRequest.reservation), replayed: true };
    }

    if (this.#byCoordinate.has(fingerprint)) {
      throw new RegistryReleaseReservationError(
        "REGISTRY_RELEASE_VERSION_RESERVED",
        "That release version has already been reserved and cannot be reused.",
      );
    }

    const createdAt = input.now ?? new Date();
    const reservation: RegistryReleaseReservation = {
      apiVersion: REGISTRY_API_VERSION,
      releaseId: randomUUID(),
      coordinate: structuredClone(input.coordinate),
      status: "reserved",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.#reservationTtlMs).toISOString(),
    };
    this.#byIdempotency.set(idempotencyKey, { fingerprint, reservation });
    this.#byCoordinate.set(fingerprint, reservation);
    return { reservation: structuredClone(reservation), replayed: false };
  }
}

export class PostgresRegistryNamespaceRepository implements RegistryNamespaceRepository {
  constructor(private readonly client: RegistrySqlClient) {}

  async claimNamespace(input: RegistryNamespaceClaimInput): Promise<RegistryNamespaceClaimResult> {
    await this.query(
      `INSERT INTO registry_publishers (provider, subject, login)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, subject) DO UPDATE
       SET login = COALESCE(EXCLUDED.login, registry_publishers.login), updated_at = now()`,
      [input.actor.provider, input.actor.subject, input.actor.login ?? null],
    );
    const inserted = await this.query<{ namespace: string }>(
      `INSERT INTO registry_namespaces (namespace, owner_provider, owner_subject, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (namespace) DO NOTHING
       RETURNING namespace`,
      [input.namespace, input.actor.provider, input.actor.subject, (input.now ?? new Date()).toISOString()],
    );
    if (inserted.rows[0]) return { namespace: inserted.rows[0].namespace, created: true };

    const existing = await this.query<RegistryNamespaceOwnerRow>(
      `SELECT namespace, owner_provider, owner_subject
       FROM registry_namespaces
       WHERE namespace = $1`,
      [input.namespace],
    );
    const owner = existing.rows[0];
    if (owner && owner.owner_provider === input.actor.provider && owner.owner_subject === input.actor.subject) {
      return { namespace: owner.namespace, created: false };
    }
    throw new RegistryNamespaceError("REGISTRY_NAMESPACE_OWNED", "That namespace is already owned by another publisher.");
  }

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }
}

/** Authenticated, read-only package and immutable version history for one publisher. */
export class PostgresRegistryPublisherWorkspaceRepository implements RegistryPublisherWorkspaceRepository {
  readonly #now: () => number;

  constructor(
    private readonly client: RegistrySqlClient,
    options: { now?: () => number } = {},
  ) {
    this.#now = options.now ?? (() => Date.now());
  }

  async getWorkspace(actor: RegistryPublisherIdentity): Promise<RegistryPublisherWorkspaceResponse> {
    const identity = validateRegistryPublisherIdentity(actor);
    if (!identity.valid) throw new TypeError("Cannot load a workspace for an invalid publisher identity.");
    const result = await this.query<RegistryPublisherWorkspaceRow>(
      `SELECT namespaces.namespace,
              reservations.release_id, reservations.name, reservations.version,
              reservations.created_at AS reservation_created_at, reservations.expires_at,
              uploads.status AS upload_status, uploads.digest, uploads.completed_at,
              public_releases.status AS public_status, public_releases.published_at
       FROM registry_namespaces AS namespaces
       LEFT JOIN registry_release_reservations AS reservations
         ON reservations.namespace = namespaces.namespace
        AND reservations.publisher_provider = namespaces.owner_provider
        AND reservations.publisher_subject = namespaces.owner_subject
       LEFT JOIN registry_release_uploads AS uploads
         ON uploads.release_id = reservations.release_id
       LEFT JOIN registry_public_releases AS public_releases
         ON public_releases.namespace = reservations.namespace
        AND public_releases.name = reservations.name
        AND public_releases.version = reservations.version
       WHERE namespaces.owner_provider = $1 AND namespaces.owner_subject = $2
       ORDER BY namespaces.namespace ASC, reservations.name ASC,
                reservations.created_at DESC NULLS LAST, reservations.version DESC NULLS LAST`,
      [identity.value.provider, identity.value.subject],
    );

    let response: RegistryPublisherWorkspaceResponse;
    try {
      response = publisherWorkspaceFromRows(result.rows, this.#now());
    } catch (error) {
      if (error instanceof RegistryRepositoryError) throw error;
      throw new RegistryRepositoryError(
        "REGISTRY_ROW_INVALID",
        error instanceof Error ? `Publisher workspace row is invalid: ${error.message}` : "Publisher workspace row is invalid.",
      );
    }
    const validation = validateRegistryPublisherWorkspaceResponse(response);
    if (!validation.valid) {
      throw new RegistryRepositoryError(
        "REGISTRY_ROW_INVALID",
        `Publisher workspace row is invalid: ${validation.issues[0]?.message ?? "unknown error"}`,
      );
    }
    return validation.value;
  }

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }
}

/** In-memory moderation semantics for API tests and local development. */
export class InMemoryRegistryModerationRepository implements RegistryModerationRepository {
  readonly #reports = new Map<string, { fingerprint: string; report: RegistryReport }>();
  readonly #events: RegistryModerationAuditEvent[] = [];
  readonly #releases = new Map<string, { status: RegistryReleaseStatus; quarantinePreviousStatus?: "active" | "deprecated" }>();
  readonly #releaseOwners: ReadonlyMap<string, string>;
  readonly #releaseOperations = new Map<string, { fingerprint: string; response: RegistryReleaseModerationResponse }>();
  readonly #denylist = new Map<string, RegistryDigestDenylistEntry>();
  readonly #denylistOperations = new Map<string, { fingerprint: string; response: RegistryDigestDenylistMutationResponse }>();

  constructor(options: {
    releases?: readonly { coordinate: RegistryReleaseCoordinate; status?: RegistryReleaseStatus }[];
    releaseOwners?: Readonly<Record<string, string>>;
  } = {}) {
    for (const release of options.releases ?? []) {
      this.#releases.set(formatReleaseCoordinate(release.coordinate), { status: release.status ?? "active" });
    }
    this.#releaseOwners = new Map(Object.entries(options.releaseOwners ?? {}));
  }

  async createReport(input: RegistryReportInput): Promise<RegistryReportResult> {
    const request = validateModerationInput(input);
    const actorKey = `${input.actor.provider}:${input.actor.subject}`;
    const key = `${actorKey}:${request.idempotencyKey}`;
    const fingerprint = JSON.stringify({ target: request.target, category: request.category, evidence: request.evidence });
    const existing = this.#reports.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new RegistryModerationError("REGISTRY_REPORT_IDEMPOTENCY_CONFLICT", "The report idempotency key was already used for different evidence.");
      }
      return { report: structuredClone(existing.report), replayed: true };
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    const report: RegistryReport = {
      apiVersion: REGISTRY_API_VERSION,
      reportId: randomUUID(),
      target: structuredClone(request.target),
      category: request.category,
      status: "open",
      evidence: request.evidence,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.#reports.set(key, { fingerprint, report });
    this.#events.unshift({
      eventId: randomUUID(),
      action: "report_created",
      actor: { kind: "publisher", identity: clonePublisherIdentity(input.actor) },
      target: { type: "report", reportId: report.reportId },
      occurredAt: timestamp,
      requestId: input.requestId,
      metadata: { category: report.category, targetType: report.target.releaseVersion ? "release" : "package" },
    });
    return { report: structuredClone(report), replayed: false };
  }

  async moderateRelease(input: RegistryReleaseModerationInput): Promise<RegistryReleaseModerationResult> {
    const request = validateReleaseModerationInput(input);
    const key = `${input.actor.provider}:${input.actor.subject}:${input.operation}:${formatReleaseCoordinate(input.coordinate)}:${request.idempotencyKey}`;
    const fingerprint = JSON.stringify({ reason: request.reason, coordinate: input.coordinate, operation: input.operation });
    const existingOperation = this.#releaseOperations.get(key);
    if (existingOperation) {
      if (existingOperation.fingerprint !== fingerprint) {
        throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_IDEMPOTENCY_CONFLICT", "The release moderation idempotency key was already used for a different operation.");
      }
      return { response: structuredClone(existingOperation.response), replayed: true };
    }
    const coordinateKey = formatReleaseCoordinate(input.coordinate);
    const release = this.#releases.get(coordinateKey);
    if (!release) throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_NOT_FOUND", "The release was not found.");
    if (input.operation === "deprecate" && this.#releaseOwners.get(input.coordinate.namespace) !== undefined && this.#releaseOwners.get(input.coordinate.namespace) !== `${input.actor.provider}:${input.actor.subject}`) {
      throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_FORBIDDEN", "The publisher does not own this release namespace.");
    }
    const previousStatus = release.status;
    if (input.operation === "deprecate") {
      if (release.status !== "active") throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_CONFLICT", "Only an active release can be deprecated.");
      release.status = "deprecated";
    } else if (input.operation === "quarantine") {
      if (release.status !== "active" && release.status !== "deprecated") throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_CONFLICT", "Only a public release can be quarantined.");
      release.quarantinePreviousStatus = release.status;
      release.status = "quarantined";
    } else {
      if (release.status !== "quarantined") throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_CONFLICT", "Only a quarantined release can be restored.");
      release.status = release.quarantinePreviousStatus ?? "active";
      delete release.quarantinePreviousStatus;
    }
    const changedAt = (input.now ?? new Date()).toISOString();
    const response: RegistryReleaseModerationResponse = {
      apiVersion: REGISTRY_API_VERSION,
      coordinate: structuredClone(input.coordinate),
      operation: input.operation,
      status: release.status,
      changedAt,
      auditEventId: randomUUID(),
    };
    this.#releaseOperations.set(key, { fingerprint, response });
    this.#events.unshift({
      eventId: response.auditEventId,
      action: releaseModerationAuditAction(input.operation),
      actor: { kind: input.actorKind, identity: clonePublisherIdentity(input.actor) },
      target: { type: "release", release: structuredClone(input.coordinate) },
      occurredAt: changedAt,
      requestId: input.requestId,
      metadata: { reason: request.reason, operation: input.operation, previousStatus },
    });
    return { response: structuredClone(response), replayed: false };
  }

  async mutateDenylist(input: RegistryDigestDenylistMutationInput): Promise<RegistryDigestDenylistMutationResult> {
    const request = validateDenylistInput(input);
    const key = `${input.actor.provider}:${input.actor.subject}:${request.idempotencyKey}`;
    const fingerprint = JSON.stringify(request);
    const existing = this.#denylistOperations.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new RegistryModerationError("REGISTRY_DIGEST_DENYLIST_IDEMPOTENCY_CONFLICT", "The denylist idempotency key was already used for a different digest operation.");
      return { response: structuredClone(existing.response), replayed: true };
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    if (request.action === "add") {
      this.#denylist.set(request.digest, { digest: request.digest, reason: request.reason, addedAt: timestamp });
    } else {
      this.#denylist.delete(request.digest);
    }
    const response: RegistryDigestDenylistMutationResponse = {
      apiVersion: REGISTRY_API_VERSION,
      action: request.action,
      digest: request.digest,
      active: request.action === "add",
      changedAt: timestamp,
      auditEventId: randomUUID(),
    };
    this.#denylistOperations.set(key, { fingerprint, response });
    this.#events.unshift({
      eventId: response.auditEventId,
      action: request.action === "add" ? "digest_denylisted" : "digest_denylist_removed",
      actor: { kind: "maintainer", identity: clonePublisherIdentity(input.actor) },
      target: { type: "artifact", digest: request.digest },
      occurredAt: timestamp,
      requestId: input.requestId,
      metadata: { reason: request.reason, action: request.action, active: String(response.active) },
    });
    return { response: structuredClone(response), replayed: false };
  }

  async listDenylistedDigests(): Promise<RegistryDigestDenylistResponse> {
    const response: RegistryDigestDenylistResponse = {
      apiVersion: REGISTRY_API_VERSION,
      items: [...this.#denylist.values()].sort((left, right) => left.digest.localeCompare(right.digest)).map((entry) => structuredClone(entry)),
    };
    const validation = validateRegistryDigestDenylistResponse(response);
    if (!validation.valid) throw new RegistryRepositoryError("REGISTRY_MODERATION_RESULT_INVALID", validation.issues[0]?.message ?? "Invalid digest denylist.");
    return validation.value;
  }

  async isDigestDenylisted(digest: string): Promise<boolean> {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new RegistryModerationError("REGISTRY_DIGEST_DENYLIST_INVALID", "The digest is invalid.");
    return this.#denylist.has(digest);
  }

  async listAuditEvents(input: RegistryModerationAuditEventListRequest): Promise<RegistryModerationAuditEventListResponse> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const offset = decodeCursor(input.cursor);
    const items = this.#events.slice(offset, offset + limit + 1);
    return {
      apiVersion: REGISTRY_API_VERSION,
      items: structuredClone(items.slice(0, limit)),
      ...(items.length > limit ? { nextCursor: encodeCursor(offset + limit) } : {}),
    };
  }
}

/** PostgreSQL-backed report intake and append-only moderation audit reads. */
export class PostgresRegistryModerationRepository implements RegistryModerationRepository {
  constructor(private readonly client: RegistrySqlClient) {}

  async createReport(input: RegistryReportInput): Promise<RegistryReportResult> {
    const request = validateModerationInput(input);
    const reportId = randomUUID();
    const eventId = randomUUID();
    const createdAt = (input.now ?? new Date()).toISOString();
    const targetType = request.target.releaseVersion ? "release" : "package";
    const metadata = JSON.stringify({ category: request.category, targetType });
    const inserted = await this.query<RegistryReportRow>(
      `WITH inserted AS (
         INSERT INTO registry_reports
           (report_id, namespace, name, release_version, category, status, evidence,
            reporter_provider, reporter_subject, idempotency_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10, $10)
         ON CONFLICT (reporter_provider, reporter_subject, idempotency_key) DO NOTHING
         RETURNING report_id, namespace, name, release_version, category, status, evidence, created_at, updated_at
       ), audit AS (
         INSERT INTO registry_moderation_audit_events
           (event_id, action, actor_kind, actor_provider, actor_subject, target_type,
            target_report_id, occurred_at, request_id, metadata_json)
         SELECT $11, 'report_created', 'publisher', $7, $8, 'report', report_id, $10, $12, $13::jsonb
         FROM inserted
         RETURNING event_id
       )
       SELECT inserted.* FROM inserted CROSS JOIN audit`,
      [
        reportId,
        request.target.package.namespace,
        request.target.package.name,
        request.target.releaseVersion ?? null,
        request.category,
        request.evidence,
        input.actor.provider,
        input.actor.subject,
        request.idempotencyKey,
        createdAt,
        eventId,
        input.requestId,
        metadata,
      ],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow) return { report: reportFromRow(insertedRow), replayed: false };

    const existing = await this.query<RegistryReportRow & { reporter_provider: string; reporter_subject: string; idempotency_key: string }>(
      `SELECT report_id, namespace, name, release_version, category, status, evidence, created_at, updated_at,
              reporter_provider, reporter_subject, idempotency_key
       FROM registry_reports
       WHERE reporter_provider = $1 AND reporter_subject = $2 AND idempotency_key = $3`,
      [input.actor.provider, input.actor.subject, request.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new RegistryModerationError("REGISTRY_REPORT_INVALID", "The report replay could not be resolved.");
    const report = reportFromRow(row);
    const existingFingerprint = JSON.stringify({ target: report.target, category: report.category, evidence: report.evidence });
    if (existingFingerprint !== JSON.stringify({ target: request.target, category: request.category, evidence: request.evidence })) {
      throw new RegistryModerationError("REGISTRY_REPORT_IDEMPOTENCY_CONFLICT", "The report idempotency key was already used for different evidence.");
    }
    return { report, replayed: true };
  }

  async moderateRelease(input: RegistryReleaseModerationInput): Promise<RegistryReleaseModerationResult> {
    const request = validateReleaseModerationInput(input);
    const eventId = randomUUID();
    const changedAt = (input.now ?? new Date()).toISOString();
    const action = releaseModerationAuditAction(input.operation);
    const metadata = JSON.stringify({ reason: request.reason, operation: input.operation });
    const updated = await this.query<RegistryReleaseModerationRow>(
      `WITH updated AS (
         UPDATE registry_public_releases AS releases
         SET status = CASE $4
               WHEN 'deprecate' THEN 'deprecated'
               WHEN 'quarantine' THEN 'quarantined'
               ELSE COALESCE(releases.quarantine_previous_status, 'active')
             END,
             quarantine_previous_status = CASE $4
               WHEN 'quarantine' THEN releases.status
               ELSE NULL
             END
         WHERE releases.namespace = $1 AND releases.name = $2 AND releases.version = $3
           AND (
             ($4 = 'deprecate' AND releases.status = 'active'
              AND EXISTS (
                SELECT 1 FROM registry_namespaces AS namespaces
                WHERE namespaces.namespace = releases.namespace
                  AND namespaces.owner_provider = $8
                  AND namespaces.owner_subject = $9
              ))
             OR ($4 = 'quarantine' AND releases.status IN ('active', 'deprecated'))
             OR ($4 = 'unquarantine' AND releases.status = 'quarantined')
           )
         RETURNING releases.namespace, releases.name, releases.version, releases.status,
                   $10::timestamptz AS changed_at
       ), audit AS (
         INSERT INTO registry_moderation_audit_events
           (event_id, action, actor_kind, actor_provider, actor_subject, target_type,
            target_namespace, target_name, target_version, occurred_at, request_id,
            idempotency_key, metadata_json)
         SELECT $5, $6, $7, $8, $9, 'release', namespace, name, version,
                $10, $11, $12,
                jsonb_set($13::jsonb, '{resultStatus}', to_jsonb(updated.status), true)
         FROM updated
         ON CONFLICT DO NOTHING
         RETURNING event_id
       )
       SELECT updated.namespace, updated.name, updated.version, updated.status,
              updated.changed_at, audit.event_id AS audit_event_id
       FROM updated CROSS JOIN audit`,
      [
        input.coordinate.namespace,
        input.coordinate.name,
        input.coordinate.version,
        input.operation,
        eventId,
        action,
        input.actorKind,
        input.actor.provider,
        input.actor.subject,
        changedAt,
        input.requestId,
        request.idempotencyKey,
        metadata,
      ],
    );
    const row = updated.rows[0];
    if (row) {
      const response = releaseModerationResponseFromRow(row, input.operation);
      return { response, replayed: false };
    }

    const existingAudit = await this.query<RegistryReleaseModerationAuditRow>(
      `SELECT event_id, action, occurred_at, metadata_json
       FROM registry_moderation_audit_events
       WHERE actor_kind = $1 AND actor_provider = $2 AND actor_subject = $3
         AND target_type = 'release' AND target_namespace = $4 AND target_name = $5
         AND target_version = $6 AND idempotency_key = $7
       LIMIT 1`,
      [input.actorKind, input.actor.provider, input.actor.subject, input.coordinate.namespace, input.coordinate.name, input.coordinate.version, request.idempotencyKey],
    );
    const audit = existingAudit.rows[0];
    const current = await this.query<{ status: RegistryReleaseStatus; quarantine_previous_status: "active" | "deprecated" | null }>(
      `SELECT status, quarantine_previous_status
       FROM registry_public_releases
       WHERE namespace = $1 AND name = $2 AND version = $3
       LIMIT 1`,
      [input.coordinate.namespace, input.coordinate.name, input.coordinate.version],
    );
    const currentRow = current.rows[0];
    if (!currentRow) throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_NOT_FOUND", "The release was not found.");
    if (audit) {
      if (audit.action !== action) throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_IDEMPOTENCY_CONFLICT", "The release moderation idempotency key was already used for a different operation.");
      const response = releaseModerationResponseFromRow({
        namespace: input.coordinate.namespace,
        name: input.coordinate.name,
        version: input.coordinate.version,
        status: moderationResultStatus(audit.metadata_json, currentRow.status),
        changed_at: audit.occurred_at,
        audit_event_id: audit.event_id,
      }, input.operation);
      return { response, replayed: true };
    }
    if (input.operation === "deprecate") {
      const owner = await this.query<{ namespace: string }>(
        `SELECT namespace FROM registry_namespaces
         WHERE namespace = $1 AND owner_provider = $2 AND owner_subject = $3
         LIMIT 1`,
        [input.coordinate.namespace, input.actor.provider, input.actor.subject],
      );
      if (!owner.rows[0]) throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_FORBIDDEN", "The publisher does not own this release namespace.");
    }
    throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_CONFLICT", `The release cannot transition from ${currentRow.status}.`);
  }

  async mutateDenylist(input: RegistryDigestDenylistMutationInput): Promise<RegistryDigestDenylistMutationResult> {
    const request = validateDenylistInput(input);
    const eventId = randomUUID();
    const changedAt = (input.now ?? new Date()).toISOString();
    const action = request.action === "add" ? "digest_denylisted" : "digest_denylist_removed";
    const metadata = JSON.stringify({ reason: request.reason, action: request.action, active: request.action === "add" });
    const changed = await this.query<RegistryDenylistMutationRow>(
      request.action === "add"
        ? `WITH changed AS (
             INSERT INTO registry_digest_denylist (digest, reason, active, added_at, updated_at)
             VALUES ($1, $2, true, $3, $3)
             ON CONFLICT (digest) DO UPDATE
             SET reason = EXCLUDED.reason, active = true, updated_at = EXCLUDED.updated_at
             RETURNING digest, reason, added_at, active
           ), audit AS (
             INSERT INTO registry_moderation_audit_events
               (event_id, action, actor_kind, actor_provider, actor_subject, target_type,
                target_digest, occurred_at, request_id, idempotency_key, metadata_json)
             SELECT $4, $5, 'maintainer', $6, $7, 'artifact', digest,
                    $3, $8, $9, $10::jsonb
             FROM changed
             ON CONFLICT DO NOTHING
             RETURNING event_id
           )
           SELECT changed.digest, changed.reason, changed.added_at, changed.active,
                  $3::timestamptz AS changed_at, audit.event_id AS audit_event_id
           FROM changed CROSS JOIN audit`
        : `WITH changed AS (
             UPDATE registry_digest_denylist
             SET active = false, updated_at = $3
             WHERE digest = $1 AND active = true
             RETURNING digest, reason, added_at, active
           ), audit AS (
             INSERT INTO registry_moderation_audit_events
               (event_id, action, actor_kind, actor_provider, actor_subject, target_type,
                target_digest, occurred_at, request_id, idempotency_key, metadata_json)
             SELECT $4, $5, 'maintainer', $6, $7, 'artifact', digest,
                    $3, $8, $9, $10::jsonb
             FROM changed
             ON CONFLICT DO NOTHING
             RETURNING event_id
           )
           SELECT changed.digest, changed.reason, changed.added_at, changed.active,
                  $3::timestamptz AS changed_at, audit.event_id AS audit_event_id
           FROM changed CROSS JOIN audit`,
      [request.digest, request.reason, changedAt, eventId, action, input.actor.provider, input.actor.subject, input.requestId, request.idempotencyKey, metadata],
    );
    const row = changed.rows[0];
    if (row) return { response: denylistMutationResponseFromRow(row, request.action), replayed: false };

    const existingAudit = await this.query<RegistryDenylistAuditRow>(
      `SELECT event_id, action, occurred_at, metadata_json
       FROM registry_moderation_audit_events
       WHERE actor_kind = 'maintainer' AND actor_provider = $1 AND actor_subject = $2
         AND target_type = 'artifact' AND target_digest = $3 AND idempotency_key = $4
       LIMIT 1`,
      [input.actor.provider, input.actor.subject, request.digest, request.idempotencyKey],
    );
    const audit = existingAudit.rows[0];
    const current = await this.query<RegistryDigestDenylistRow>(
      `SELECT digest, reason, added_at, active
       FROM registry_digest_denylist
       WHERE digest = $1
       LIMIT 1`,
      [request.digest],
    );
    const currentRow = current.rows[0];
    if (audit) {
      const expectedAction = request.action === "add" ? "digest_denylisted" : "digest_denylist_removed";
      if (audit.action !== expectedAction) throw new RegistryModerationError("REGISTRY_DIGEST_DENYLIST_IDEMPOTENCY_CONFLICT", "The denylist idempotency key was already used for a different action.");
      return {
        response: denylistMutationResponseFromRow({
          digest: request.digest,
          active: denylistResultActive(audit.metadata_json, currentRow?.active ?? false),
          changed_at: audit.occurred_at,
          audit_event_id: audit.event_id,
        }, request.action),
        replayed: true,
      };
    }
    throw new RegistryModerationError("REGISTRY_DIGEST_DENYLIST_CONFLICT", currentRow?.active ? "The digest denylist operation could not be committed." : "The digest is not active on the denylist.");
  }

  async listDenylistedDigests(): Promise<RegistryDigestDenylistResponse> {
    const result = await this.query<RegistryDigestDenylistRow>(
      `SELECT digest, reason, added_at
       FROM registry_digest_denylist
       WHERE active = true
       ORDER BY digest ASC
       LIMIT 1000`,
      [],
    );
    const response: RegistryDigestDenylistResponse = {
      apiVersion: REGISTRY_API_VERSION,
      items: result.rows.map((row) => ({ digest: row.digest as `sha256:${string}`, reason: row.reason, addedAt: dateValue(row.added_at) })),
    };
    const validation = validateRegistryDigestDenylistResponse(response);
    if (!validation.valid) throw new RegistryRepositoryError("REGISTRY_MODERATION_RESULT_INVALID", validation.issues[0]?.message ?? "Invalid digest denylist.");
    return validation.value;
  }

  async isDigestDenylisted(digest: string): Promise<boolean> {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new RegistryModerationError("REGISTRY_DIGEST_DENYLIST_INVALID", "The digest is invalid.");
    const result = await this.query<{ active: boolean }>(
      `SELECT active FROM registry_digest_denylist WHERE digest = $1 AND active = true LIMIT 1`,
      [digest],
    );
    return Boolean(result.rows[0]?.active);
  }

  async listAuditEvents(input: RegistryModerationAuditEventListRequest): Promise<RegistryModerationAuditEventListResponse> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const offset = decodeCursor(input.cursor);
    const result = await this.query<RegistryModerationAuditEventRow>(
      `SELECT event_id, action, actor_kind, actor_provider, actor_subject, target_type,
              target_report_id, target_namespace, target_name, target_version, target_digest,
              occurred_at, request_id, idempotency_key, metadata_json
       FROM registry_moderation_audit_events
       ORDER BY occurred_at DESC, event_id DESC
       LIMIT $1 OFFSET $2`,
      [limit + 1, offset],
    );
    const events = result.rows.map((row) => auditEventFromRow(row));
    const response: RegistryModerationAuditEventListResponse = {
      apiVersion: REGISTRY_API_VERSION,
      items: events.slice(0, limit),
      ...(events.length > limit ? { nextCursor: encodeCursor(offset + limit) } : {}),
    };
    const validation = validateRegistryModerationAuditEventListResponse(response);
    if (!validation.valid) throw new RegistryRepositoryError("REGISTRY_MODERATION_RESULT_INVALID", validation.issues[0]?.message ?? "Invalid moderation audit result.");
    return validation.value;
  }

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }
}

export class PostgresRegistryReleaseReservationRepository implements RegistryReleaseReservationRepository {
  readonly #reservationTtlMs: number;

  constructor(
    private readonly client: RegistrySqlClient,
    options: { reservationTtlMs?: number } = {},
  ) {
    this.#reservationTtlMs = options.reservationTtlMs ?? 30 * 60 * 1000;
    if (!Number.isSafeInteger(this.#reservationTtlMs) || this.#reservationTtlMs <= 0) {
      throw new RangeError("reservationTtlMs must be a positive safe integer.");
    }
  }

  async reserveRelease(input: RegistryReleaseReservationInput): Promise<RegistryReleaseReservationResult> {
    const ownership = await this.query<{ namespace: string }>(
      `SELECT namespace
       FROM registry_namespaces
       WHERE namespace = $1
         AND owner_provider = $2
         AND owner_subject = $3`,
      [input.coordinate.namespace, input.actor.provider, input.actor.subject],
    );
    if (!ownership.rows[0]) {
      const namespace = await this.query<{ namespace: string }>(
        `SELECT namespace FROM registry_namespaces WHERE namespace = $1`,
        [input.coordinate.namespace],
      );
      throw new RegistryReleaseReservationError(
        namespace.rows[0] ? "REGISTRY_NAMESPACE_FORBIDDEN" : "REGISTRY_NAMESPACE_NOT_FOUND",
        namespace.rows[0]
          ? "The authenticated publisher does not own this namespace."
          : "The publisher namespace does not exist.",
      );
    }

    const createdAt = input.now ?? new Date();
    const expiresAt = new Date(createdAt.getTime() + this.#reservationTtlMs);
    const inserted = await this.query<RegistryReleaseReservationRow>(
      `INSERT INTO registry_release_reservations
         (release_id, namespace, name, version, publisher_provider, publisher_subject, idempotency_key, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING
       RETURNING release_id, namespace, name, version, created_at, expires_at`,
      [
        randomUUID(),
        input.coordinate.namespace,
        input.coordinate.name,
        input.coordinate.version,
        input.actor.provider,
        input.actor.subject,
        input.idempotencyKey,
        createdAt.toISOString(),
        expiresAt.toISOString(),
      ],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow) return { reservation: reservationFromRow(insertedRow), replayed: false };

    const existingByKey = await this.query<RegistryReleaseReservationRow>(
      `SELECT release_id, namespace, name, version, created_at, expires_at
       FROM registry_release_reservations
       WHERE publisher_provider = $1 AND publisher_subject = $2 AND idempotency_key = $3`,
      [input.actor.provider, input.actor.subject, input.idempotencyKey],
    );
    const idempotent = existingByKey.rows[0];
    if (idempotent) {
      if (
        idempotent.namespace !== input.coordinate.namespace ||
        idempotent.name !== input.coordinate.name ||
        idempotent.version !== input.coordinate.version
      ) {
        throw new RegistryReleaseReservationError(
          "REGISTRY_IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used for a different release coordinate.",
        );
      }
      return { reservation: reservationFromRow(idempotent), replayed: true };
    }

    const existingByCoordinate = await this.query<RegistryReleaseReservationRow>(
      `SELECT release_id, namespace, name, version, created_at, expires_at
       FROM registry_release_reservations
       WHERE namespace = $1 AND name = $2 AND version = $3`,
      [input.coordinate.namespace, input.coordinate.name, input.coordinate.version],
    );
    if (existingByCoordinate.rows[0]) {
      throw new RegistryReleaseReservationError(
        "REGISTRY_RELEASE_VERSION_RESERVED",
        "That release version has already been reserved and cannot be reused.",
      );
    }
    throw new RegistryRepositoryError("REGISTRY_DB_QUERY_FAILED", "The registry could not resolve a reservation conflict.");
  }

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }
}

/** PostgreSQL upload-intent and completion boundary used before worker activation. */
export class PostgresRegistryReleaseUploadRepository implements RegistryReleaseUploadRepository {
  async reserveArtifactUpload(input: RegistryArtifactUploadInput): Promise<RegistryArtifactUploadResult> {
    const reservation = await this.findReservation(input);
    if (!reservation) {
      throw new RegistryReleaseUploadError(
        "REGISTRY_RELEASE_UPLOAD_NOT_FOUND",
        "The release reservation was not found, is expired, or is owned by another publisher.",
      );
    }
    const digest = input.digest;
    const bytes = input.bytes;
    const inserted = await this.query<RegistryReleaseUploadRow>(
      `INSERT INTO registry_release_uploads
         (release_id, digest, artifact_key, format, media_type, bytes, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7)
       ON CONFLICT (release_id) DO NOTHING
       RETURNING release_id, digest, artifact_key, format, media_type, bytes, status AS upload_status,
                 completion_json, completed_at, namespace, name, version, created_at, expires_at`,
      [
        input.releaseId,
        digest,
        artifactObjectKey(digest),
        AGENTCARGO_ARTIFACT_FORMAT,
        AGENTCARGO_ARTIFACT_MEDIA_TYPE,
        bytes,
        (input.now ?? new Date()).toISOString(),
      ],
    );
    if (inserted.rows[0]) return { reservation, replayed: false };

    const existing = await this.query<RegistryReleaseUploadRow>(
      `SELECT uploads.release_id, uploads.digest, uploads.artifact_key, uploads.format, uploads.media_type,
              uploads.bytes, uploads.status AS upload_status, uploads.completion_json, uploads.completed_at,
              reservations.namespace, reservations.name, reservations.version,
              reservations.created_at, reservations.expires_at
       FROM registry_release_uploads AS uploads
       JOIN registry_release_reservations AS reservations ON reservations.release_id = uploads.release_id
       WHERE uploads.release_id = $1`,
      [input.releaseId],
    );
    const row = existing.rows[0];
    if (!row || row.digest !== digest || row.bytes !== bytes) {
      throw new RegistryReleaseUploadError(
        "REGISTRY_ARTIFACT_UPLOAD_CONFLICT",
        "A different artifact has already been reserved for this release.",
      );
    }
    return { reservation, replayed: true };
  }

  async completeRelease(input: RegistryReleaseCompletionInput): Promise<RegistryReleaseCompletionResult> {
    const validation = validateRegistryReleaseCompletionRequest(input.request);
    if (!validation.valid) {
      throw new RegistryReleaseUploadError(
        "REGISTRY_RELEASE_COMPLETION_INVALID",
        validation.issues[0]?.message ?? "The release completion metadata is invalid.",
      );
    }
    const rowResult = await this.query<RegistryReleaseUploadRow>(
      `SELECT uploads.release_id, uploads.digest, uploads.artifact_key, uploads.format, uploads.media_type,
              uploads.bytes, uploads.status AS upload_status, uploads.completion_json, uploads.completed_at,
              reservations.namespace, reservations.name, reservations.version,
              reservations.created_at, reservations.expires_at
       FROM registry_release_uploads AS uploads
       JOIN registry_release_reservations AS reservations ON reservations.release_id = uploads.release_id
       WHERE uploads.release_id = $1
         AND reservations.publisher_provider = $2
         AND reservations.publisher_subject = $3
         AND reservations.expires_at > $4`,
      [input.releaseId, input.actor.provider, input.actor.subject, (input.now ?? new Date()).toISOString()],
    );
    const row = rowResult.rows[0];
    if (!row) {
      throw new RegistryReleaseUploadError(
        "REGISTRY_RELEASE_UPLOAD_NOT_FOUND",
        "The release upload was not found, is expired, or is owned by another publisher.",
      );
    }
    if (row.digest !== validation.value.artifact.digest || row.bytes !== validation.value.artifact.bytes || row.artifact_key !== input.artifactKey) {
      throw new RegistryReleaseUploadError(
        "REGISTRY_ARTIFACT_METADATA_CONFLICT",
        "The completion metadata does not match the reserved artifact.",
      );
    }
    if (row.upload_status === "scanning" && row.completion_json && row.completed_at) {
      return { completion: completionFromRow(row), replayed: true };
    }

    await this.query(
      `INSERT INTO registry_artifacts (digest, artifact_key, format, media_type, bytes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (digest) DO NOTHING`,
      [validation.value.artifact.digest, input.artifactKey, validation.value.artifact.format, validation.value.artifact.mediaType, validation.value.artifact.bytes],
    );
    const artifactRow = await this.query<{ digest: string; artifact_key: string; format: string; media_type: string; bytes: number }>(
      `SELECT digest, artifact_key, format, media_type, bytes
       FROM registry_artifacts
       WHERE digest = $1`,
      [validation.value.artifact.digest],
    );
    const storedArtifact = artifactRow.rows[0];
    if (
      !storedArtifact ||
      storedArtifact.artifact_key !== input.artifactKey ||
      storedArtifact.format !== validation.value.artifact.format ||
      storedArtifact.media_type !== validation.value.artifact.mediaType ||
      storedArtifact.bytes !== validation.value.artifact.bytes
    ) {
      throw new RegistryReleaseUploadError("REGISTRY_ARTIFACT_METADATA_CONFLICT", "The stored artifact metadata does not match the completion metadata.");
    }
    const completedAt = (input.now ?? new Date()).toISOString();
    const updated = await this.query<RegistryReleaseUploadRow>(
      `UPDATE registry_release_uploads
       SET status = 'scanning', completion_json = $2::jsonb, completed_at = $3
       WHERE release_id = $1 AND status IN ('reserved', 'uploaded')
       RETURNING release_id, digest, artifact_key, format, media_type, bytes,
                 status AS upload_status, completion_json, completed_at,
                 '' AS namespace, '' AS name, '' AS version, created_at, NULL::timestamptz AS expires_at`,
      [input.releaseId, JSON.stringify(validation.value), completedAt],
    );
    if (!updated.rows[0]) {
      const replay = await this.query<RegistryReleaseUploadRow>(
        `SELECT uploads.release_id, uploads.digest, uploads.artifact_key, uploads.format, uploads.media_type,
                uploads.bytes, uploads.status AS upload_status, uploads.completion_json, uploads.completed_at,
                reservations.namespace, reservations.name, reservations.version,
                reservations.created_at, reservations.expires_at
         FROM registry_release_uploads AS uploads
         JOIN registry_release_reservations AS reservations ON reservations.release_id = uploads.release_id
         WHERE uploads.release_id = $1`,
        [input.releaseId],
      );
      const replayRow = replay.rows[0];
      if (replayRow?.upload_status === "scanning" && replayRow.completion_json && replayRow.completed_at) {
        return { completion: completionFromRow(replayRow), replayed: true };
      }
      throw new RegistryReleaseUploadError("REGISTRY_RELEASE_COMPLETION_INVALID", "The release completion could not be committed.");
    }
    const completion = {
      apiVersion: REGISTRY_API_VERSION,
      releaseId: input.releaseId,
      coordinate: { namespace: row.namespace, name: row.name, version: row.version },
      status: "scanning" as const,
      artifact: validation.value.artifact,
      completedAt,
    } satisfies RegistryReleaseCompletionResponse;
    return { completion, replayed: false };
  }

  private async findReservation(input: RegistryArtifactUploadInput): Promise<RegistryReleaseReservation | null> {
    const result = await this.query<RegistryReleaseReservationRow>(
      `SELECT release_id, namespace, name, version, created_at, expires_at
       FROM registry_release_reservations
       WHERE release_id = $1
         AND publisher_provider = $2
         AND publisher_subject = $3
         AND expires_at > $4`,
      [input.releaseId, input.actor.provider, input.actor.subject, (input.now ?? new Date()).toISOString()],
    );
    const row = result.rows[0];
    return row ? reservationFromRow(row) : null;
  }

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }

  constructor(private readonly client: RegistrySqlClient) {}
}

/** PostgreSQL-backed durable queue used by the validation/scanning worker. */
export class PostgresRegistryScanJobRepository implements RegistryScanJobRepository {
  readonly #defaultLeaseMs: number;

  constructor(
    private readonly client: RegistrySqlClient,
    options: { defaultLeaseMs?: number } = {},
  ) {
    this.#defaultLeaseMs = options.defaultLeaseMs ?? 5 * 60 * 1000;
    if (!Number.isSafeInteger(this.#defaultLeaseMs) || this.#defaultLeaseMs < 1_000) {
      throw new RangeError("defaultLeaseMs must be at least one second.");
    }
  }

  async enqueuePending(now = new Date()): Promise<number> {
    const pending = await this.query<{ release_id: string }>(
      `SELECT uploads.release_id
       FROM registry_release_uploads AS uploads
       WHERE uploads.status = 'scanning'
         AND NOT EXISTS (
           SELECT 1 FROM registry_scan_jobs AS jobs WHERE jobs.release_id = uploads.release_id
         )
       ORDER BY uploads.created_at ASC
       LIMIT 100`,
      [],
    );
    let inserted = 0;
    for (const row of pending.rows) {
      const result = await this.query<{ job_id: string }>(
        `INSERT INTO registry_scan_jobs (job_id, release_id, status, available_at, created_at, updated_at)
         VALUES ($1, $2, 'queued', $3, $3, $3)
         ON CONFLICT (release_id) DO NOTHING
         RETURNING job_id`,
        [randomUUID(), row.release_id, now.toISOString()],
      );
      if (result.rows[0]) inserted += 1;
    }
    return inserted;
  }

  async claim(now = new Date(), leaseMs = this.#defaultLeaseMs): Promise<RegistryScanJob | null> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) {
      throw new RangeError("leaseMs must be at least one second.");
    }
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const result = await this.query<RegistryScanJobRow>(
      `WITH candidate AS (
         SELECT job_id
         FROM registry_scan_jobs
         WHERE (
           status = 'queued'
           OR (status = 'failed' AND available_at <= $1)
           OR (status = 'running' AND lease_until <= $1)
         )
         AND available_at <= $1
         ORDER BY available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE registry_scan_jobs AS jobs
       SET status = 'running',
           attempts = jobs.attempts + 1,
           lease_until = $2,
           started_at = COALESCE(jobs.started_at, $1),
           updated_at = $1
       FROM candidate
       WHERE jobs.job_id = candidate.job_id
       RETURNING jobs.job_id, jobs.release_id, jobs.status, jobs.attempts, jobs.lease_until`,
      [now.toISOString(), leaseUntil.toISOString()],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      jobId: row.job_id,
      releaseId: row.release_id,
      status: "running",
      attempts: row.attempts,
      leaseUntil: dateValue(row.lease_until),
    };
  }

  async succeed(jobId: string, scan: RegistryScanSummary, now = new Date()): Promise<void> {
    const updated = await this.query<{ job_id: string }>(
      `UPDATE registry_scan_jobs
       SET status = 'succeeded', lease_until = NULL, completed_at = $2,
           updated_at = $2, scan_json = $3::jsonb, last_error = NULL
       WHERE job_id = $1 AND status = 'running'
       RETURNING job_id`,
      [jobId, now.toISOString(), JSON.stringify(scan)],
    );
    if (!updated.rows[0]) {
      throw new RegistryScanJobError("REGISTRY_SCAN_JOB_NOT_FOUND", "The scan job is no longer running.");
    }
  }

  async fail(jobId: string, message: string, retryAt: Date, now = new Date()): Promise<void> {
    const boundedMessage = message.trim().slice(0, 2_048) || "The scan job failed.";
    const updated = await this.query<{ job_id: string }>(
      `UPDATE registry_scan_jobs
       SET status = 'failed', lease_until = NULL, available_at = $2,
           updated_at = $3, last_error = $4
       WHERE job_id = $1 AND status = 'running'
       RETURNING job_id`,
      [jobId, retryAt.toISOString(), now.toISOString(), boundedMessage],
    );
    if (!updated.rows[0]) {
      throw new RegistryScanJobError("REGISTRY_SCAN_JOB_NOT_FOUND", "The scan job is no longer running.");
    }
  }

  async getQueueStats(now = new Date()): Promise<RegistryScanQueueStats> {
    const result = await this.query<RegistryScanQueueStatsRow>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'queued') AS queued,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed,
         COUNT(*) FILTER (WHERE status = 'running') AS running,
         COUNT(*) FILTER (WHERE status = 'running' AND lease_until <= $1) AS stale_leases,
         MIN(available_at) FILTER (WHERE status IN ('queued', 'failed') AND available_at <= $1) AS oldest_available_at
       FROM registry_scan_jobs`,
      [now.toISOString()],
    );
    const row = result.rows[0];
    if (!row) throw new RegistryRepositoryError("REGISTRY_ROW_INVALID", "The scan queue returned no statistics row.");
    return {
      queued: queueCount(row.queued),
      failed: queueCount(row.failed),
      running: queueCount(row.running),
      staleLeases: queueCount(row.stale_leases),
      oldestAvailableAt: row.oldest_available_at === null ? null : dateValue(row.oldest_available_at),
    };
  }

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }
}

/** PostgreSQL release input and public-projection boundary for the worker. */
export class PostgresRegistryReleaseScanRepository implements RegistryReleaseScanRepository {
  constructor(
    private readonly client: RegistrySqlClient,
    private readonly denylist: RegistryDigestDenylistReader,
  ) {
    if (!denylist || typeof denylist.isDigestDenylisted !== "function") {
      throw new TypeError("A digest denylist reader is required for release activation.");
    }
  }

  async getForScan(releaseId: string): Promise<RegistryScanRelease | null> {
    const result = await this.query<RegistryScanReleaseRow>(
      `SELECT uploads.release_id, reservations.namespace, reservations.name, reservations.version,
              uploads.artifact_key, uploads.completion_json
       FROM registry_release_uploads AS uploads
       JOIN registry_release_reservations AS reservations ON reservations.release_id = uploads.release_id
       WHERE uploads.release_id = $1 AND uploads.status = 'scanning'`,
      [releaseId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (!row.completion_json || typeof row.completion_json !== "object" || Array.isArray(row.completion_json)) {
      throw new RegistryScanJobError("REGISTRY_SCAN_INVALID", "Stored release completion metadata is invalid.");
    }
    const completion = validateRegistryReleaseCompletionRequest(row.completion_json);
    if (!completion.valid) {
      throw new RegistryScanJobError("REGISTRY_SCAN_INVALID", completion.issues[0]?.message ?? "Stored release completion metadata is invalid.");
    }
    return {
      releaseId: row.release_id,
      coordinate: { namespace: row.namespace, name: row.name, version: row.version },
      artifactKey: row.artifact_key,
      completion: completion.value,
    };
  }

  async activate(releaseId: string, release: RegistryRelease): Promise<void> {
    const validation = validateRegistryRelease(release);
    if (!validation.valid || release.status !== "active") {
      throw new RegistryScanJobError("REGISTRY_SCAN_INVALID", "The worker produced an invalid active release.");
    }
    if (await this.denylist.isDigestDenylisted(release.artifact.digest)) {
      throw new RegistryScanJobError("REGISTRY_SCAN_DENYLISTED", "The release artifact digest is on the emergency denylist.");
    }
    const reservation = await this.query<{ namespace: string; name: string; version: string }>(
      `SELECT reservations.namespace, reservations.name, reservations.version
       FROM registry_release_uploads AS uploads
       JOIN registry_release_reservations AS reservations ON reservations.release_id = uploads.release_id
       WHERE uploads.release_id = $1 AND uploads.status = 'scanning'`,
      [releaseId],
    );
    const reserved = reservation.rows[0];
    if (
      !reserved
      || reserved.namespace !== release.coordinate.namespace
      || reserved.name !== release.coordinate.name
      || reserved.version !== release.coordinate.version
    ) {
      throw new RegistryScanJobError("REGISTRY_SCAN_ACTIVATION_CONFLICT", "The worker release does not match its scanning reservation.");
    }
    await this.query(
      `INSERT INTO registry_artifacts (digest, artifact_key, format, media_type, bytes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (digest) DO NOTHING`,
      [release.artifact.digest, artifactObjectKey(release.artifact.digest), release.artifact.format, release.artifact.mediaType, release.artifact.bytes],
    );
    const inserted = await this.query<{ namespace: string }>(
      `INSERT INTO registry_public_releases
         (namespace, name, version, status, artifact_digest, artifact_key, release_json, published_at)
       VALUES ($1, $2, $3, 'active', $4, $5, $6::jsonb, $7)
       ON CONFLICT (namespace, name, version) DO NOTHING
       RETURNING namespace`,
      [
        release.coordinate.namespace,
        release.coordinate.name,
        release.coordinate.version,
        release.artifact.digest,
        artifactObjectKey(release.artifact.digest),
        JSON.stringify(release),
        release.publishedAt,
      ],
    );
    if (!inserted.rows[0]) {
      const existing = await this.query<{ artifact_digest: string; release_json: unknown }>(
        `SELECT artifact_digest, release_json
         FROM registry_public_releases
         WHERE namespace = $1 AND name = $2 AND version = $3`,
        [release.coordinate.namespace, release.coordinate.name, release.coordinate.version],
      );
      const row = existing.rows[0];
      if (!row || row.artifact_digest !== release.artifact.digest || !equalJson(row.release_json, release)) {
        throw new RegistryScanJobError("REGISTRY_SCAN_ACTIVATION_CONFLICT", "A different release already occupies this immutable coordinate.");
      }
    }
    const existingPackage = await this.query<RegistryPackageRow>(
      `SELECT package_json
       FROM registry_public_packages
       WHERE namespace = $1 AND name = $2`,
      [release.coordinate.namespace, release.coordinate.name],
    );
    let latestVersion = release.coordinate.version;
    const existingPackageRow = existingPackage.rows[0];
    if (existingPackageRow) {
      const existingSummary = parsePackage(existingPackageRow.package_json, "existing package");
      if (existingSummary.latestVersion && compareVersions(existingSummary.latestVersion, latestVersion) > 0) {
        latestVersion = existingSummary.latestVersion;
      }
    }
    const packageJson = {
      apiVersion: release.apiVersion,
      package: { namespace: release.coordinate.namespace, name: release.coordinate.name },
      description: release.declared.description,
      latestVersion,
      compatibility: release.declared.compatibility,
      tags: release.declared.tags,
      hasScripts: release.files.some((file) => file.scriptLike),
      status: "active" as const,
    };
    const searchText = [
      release.coordinate.namespace,
      release.coordinate.name,
      release.declared.description,
      ...release.declared.tags,
    ].join(" ");
    await this.query(
      `INSERT INTO registry_public_packages
         (namespace, name, status, package_json, compatibility, search_document, search_text)
       VALUES ($1, $2, 'active', $3::jsonb, $4::jsonb, lower($5), to_tsvector('simple', $5))
       ON CONFLICT (namespace, name) DO UPDATE
       SET status = 'active', package_json = EXCLUDED.package_json,
           compatibility = EXCLUDED.compatibility, search_document = EXCLUDED.search_document,
           search_text = EXCLUDED.search_text, updated_at = now()`,
      [release.coordinate.namespace, release.coordinate.name, JSON.stringify(packageJson), JSON.stringify(release.declared.compatibility), searchText],
    );
    await this.query(
      `UPDATE registry_release_uploads
       SET status = 'scanning'
       WHERE release_id = $1 AND status = 'scanning'`,
      [releaseId],
    );
  }

  async reject(releaseId: string, scan: RegistryScanSummary, reason: string, now = new Date()): Promise<void> {
    await this.query(
      `UPDATE registry_release_uploads
       SET status = 'rejected', rejection_json = $2::jsonb
       WHERE release_id = $1 AND status = 'scanning'`,
      [releaseId, JSON.stringify({ reason: reason.slice(0, 2_048), scan, rejectedAt: now.toISOString() })],
    );
  }

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }

}

export class InMemoryRegistryReleaseRepository implements RegistryReleaseRepository {
  readonly #releases: RegistryRelease[];
  readonly #denylist: RegistryDigestDenylistReader | undefined;

  constructor(releases: readonly RegistryRelease[], options: { denylist?: RegistryDigestDenylistReader } = {}) {
    this.#releases = releases.map((release) => cloneRelease(release));
    this.#denylist = options.denylist;
  }

  async getPackage(coordinate: RegistryPackageCoordinate): Promise<RegistryPackageSummary | null> {
    const matching = (await this.publicReleases()).filter(
      (release) =>
        release.coordinate.namespace === coordinate.namespace && release.coordinate.name === coordinate.name,
    );
    return matching.length === 0 ? null : toPackageSummary(matching);
  }

  async getRelease(coordinate: RegistryReleaseCoordinate): Promise<RegistryRelease | null> {
    const release = (await this.publicReleases()).find(
      (candidate) =>
        candidate.coordinate.namespace === coordinate.namespace &&
        candidate.coordinate.name === coordinate.name &&
        candidate.coordinate.version === coordinate.version &&
        (candidate.status === "active" || candidate.status === "deprecated"),
    );
    return release ? cloneRelease(release) : null;
  }

  async search(request: RegistrySearchRequest): Promise<RegistrySearchResponse> {
    const query = request.query.toLocaleLowerCase();
    const matching = (await this.publicReleases()).filter((release) => {
      const compatibleHosts = request.host
        ? [release.declared.compatibility[request.host]].filter((entry): entry is { scopes: readonly ("project" | "user")[] } => Boolean(entry))
        : Object.values(release.declared.compatibility);
      if (compatibleHosts.length === 0) return false;
      if (request.scope && !compatibleHosts.some((entry) => entry.scopes.includes(request.scope!))) return false;
      const haystack = [
        formatPackageCoordinate(release.coordinate),
        release.declared.description,
        ...release.declared.tags,
      ].join(" ").toLocaleLowerCase();
      return haystack.includes(query);
    });
    const summaries = dedupePackageSummaries(matching);
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 100);
    const offset = decodeCursor(request.cursor);
    const items = summaries.slice(offset, offset + limit);
    return {
      apiVersion: REGISTRY_API_VERSION,
      items,
      ...(offset + limit < summaries.length ? { nextCursor: encodeCursor(offset + limit) } : {}),
    };
  }

  private async publicReleases(): Promise<RegistryRelease[]> {
    const releases = this.#releases.filter((release) => release.status === "active" || release.status === "deprecated");
    if (!this.#denylist) return releases;
    const allowed: RegistryRelease[] = [];
    for (const release of releases) {
      if (!(await this.#denylist.isDigestDenylisted(release.artifact.digest))) allowed.push(release);
    }
    return allowed;
  }
}

export class PostgresRegistryReleaseRepository implements RegistryReleaseRepository {
  constructor(
    private readonly client: RegistrySqlClient,
    private readonly createArtifactDownload: RegistryArtifactDownloadFactory,
  ) {}

  async getPackage(coordinate: RegistryPackageCoordinate): Promise<RegistryPackageSummary | null> {
    const result = await this.query<RegistryPackageRow>(
      `SELECT package_json
       FROM registry_public_packages
       WHERE namespace = $1 AND name = $2 AND status IN ('active', 'deprecated')
         AND EXISTS (
           SELECT 1 FROM registry_public_releases AS releases
           WHERE releases.namespace = registry_public_packages.namespace
             AND releases.name = registry_public_packages.name
             AND releases.status IN ('active', 'deprecated')
             AND NOT EXISTS (
               SELECT 1 FROM registry_digest_denylist AS denylist
               WHERE denylist.digest = releases.artifact_digest AND denylist.active = true
             )
         )
       LIMIT 1`,
      [coordinate.namespace, coordinate.name],
    );
    const row = result.rows[0];
    if (!row) return null;
    return parsePackage(row.package_json, `${formatPackageCoordinate(coordinate)} package`);
  }

  async getRelease(coordinate: RegistryReleaseCoordinate): Promise<RegistryRelease | null> {
    const result = await this.query<RegistryReleaseRow>(
      `SELECT release_json, artifact_key, status
       FROM registry_public_releases
       WHERE namespace = $1 AND name = $2 AND version = $3
         AND status IN ('active', 'deprecated')
         AND NOT EXISTS (
           SELECT 1 FROM registry_digest_denylist AS denylist
           WHERE denylist.digest = registry_public_releases.artifact_digest AND denylist.active = true
         )
       LIMIT 1`,
      [coordinate.namespace, coordinate.name, coordinate.version],
    );
    const row = result.rows[0];
    if (!row) return null;
    const release = parseRelease(row.release_json, `${formatReleaseCoordinate(coordinate)} release`);
    const download = await this.createArtifactDownload({ digest: release.artifact.digest, artifactKey: row.artifact_key });
    return {
      ...release,
      status: row.status ?? release.status,
      artifact: { ...release.artifact, download },
    };
  }

  async search(request: RegistrySearchRequest): Promise<RegistrySearchResponse> {
    const result = await this.query<RegistrySearchRow>(
      `SELECT package_json
       FROM registry_public_packages
       WHERE status IN ('active', 'deprecated')
         AND EXISTS (
           SELECT 1 FROM registry_public_releases AS releases
           WHERE releases.namespace = registry_public_packages.namespace
             AND releases.name = registry_public_packages.name
             AND releases.status IN ('active', 'deprecated')
             AND NOT EXISTS (
               SELECT 1 FROM registry_digest_denylist AS denylist
               WHERE denylist.digest = releases.artifact_digest AND denylist.active = true
             )
         )
         AND (
           search_text @@ plainto_tsquery('simple', $1)
           OR search_document LIKE '%' || lower($1) || '%'
           OR search_document % lower($1)
         )
         AND ($2::text IS NULL OR compatibility ? $2)
         AND (
           $3::text IS NULL OR EXISTS (
             SELECT 1
             FROM jsonb_each(compatibility) AS compatibility_entry(host, declaration)
             WHERE ($2::text IS NULL OR compatibility_entry.host = $2)
               AND compatibility_entry.declaration->'scopes' ? $3
           )
         )
       ORDER BY GREATEST(
           ts_rank_cd(search_text, plainto_tsquery('simple', $1)),
           similarity(search_document, lower($1)),
           search_rank
         ) DESC,
         namespace ASC,
         name ASC
       LIMIT $4`,
      [request.query, request.host ?? null, request.scope ?? null, Math.min(Math.max(request.limit ?? 20, 1), 100)],
    );
    const response: RegistrySearchResponse = {
      apiVersion: REGISTRY_API_VERSION,
      items: result.rows.map((row, index) => parsePackage(row.package_json, `search item ${index}`)),
    };
    const validation = validateRegistrySearchResponse(response);
    if (!validation.valid) {
      throw new RegistryRepositoryError("REGISTRY_SEARCH_RESULT_INVALID", validation.issues[0]?.message ?? "Invalid search result.");
    }
    return response;
  }

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }
}

async function queryRegistry<Row>(
  client: RegistrySqlClient,
  text: string,
  values: readonly unknown[],
): Promise<RegistrySqlResult<Row>> {
  try {
    return await client.query<Row>(text, values);
  } catch (error) {
    throw new RegistryRepositoryError(
      "REGISTRY_DB_QUERY_FAILED",
      error instanceof Error ? `Registry database query failed: ${error.message}` : "Registry database query failed.",
    );
  }
}

function validateModerationInput(input: RegistryReportInput): RegistryReportRequest {
  const identity = validateRegistryPublisherIdentity(input.actor);
  if (!identity.valid) throw new RegistryModerationError("REGISTRY_REPORT_INVALID", "The report actor identity is invalid.");
  const request = validateRegistryReportRequest(input.request);
  if (!request.valid) throw new RegistryModerationError("REGISTRY_REPORT_INVALID", request.issues[0]?.message ?? "The report request is invalid.");
  if (typeof input.requestId !== "string" || input.requestId.length < 1 || input.requestId.length > 128 || /[\u0000-\u001f\u007f]/.test(input.requestId)) {
    throw new RegistryModerationError("REGISTRY_REPORT_INVALID", "The report request ID is invalid.");
  }
  return request.value;
}

function validateReleaseModerationInput(input: RegistryReleaseModerationInput): RegistryReleaseModerationRequest {
  const identity = validateRegistryPublisherIdentity(input.actor);
  if (!identity.valid) throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_INVALID", "The release moderation actor identity is invalid.");
  if (input.actorKind !== "publisher" && input.actorKind !== "maintainer") {
    throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_INVALID", "The release moderation actor kind is invalid.");
  }
  if (input.operation !== "deprecate" && input.operation !== "quarantine" && input.operation !== "unquarantine") {
    throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_INVALID", "The release moderation operation is invalid.");
  }
  const coordinate = validateRegistryReleaseCoordinate(input.coordinate);
  if (!coordinate.valid) throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_INVALID", coordinate.issues[0]?.message ?? "The release coordinate is invalid.");
  const request = validateRegistryReleaseModerationRequest(input.request);
  if (!request.valid) throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_INVALID", request.issues[0]?.message ?? "The release moderation request is invalid.");
  if (typeof input.requestId !== "string" || input.requestId.length < 1 || input.requestId.length > 128 || /[\u0000-\u001f\u007f]/.test(input.requestId)) {
    throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_INVALID", "The release moderation request ID is invalid.");
  }
  return request.value;
}

function moderationResultStatus(metadata: unknown, fallback: RegistryReleaseStatus): RegistryReleaseStatus {
  let value: unknown = metadata;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const resultStatus = (value as Record<string, unknown>).resultStatus;
    if (resultStatus === "active" || resultStatus === "deprecated" || resultStatus === "quarantined") return resultStatus;
  }
  return fallback;
}

function validateDenylistInput(input: RegistryDigestDenylistMutationInput): RegistryDigestDenylistMutationRequest {
  const identity = validateRegistryPublisherIdentity(input.actor);
  if (!identity.valid) throw new RegistryModerationError("REGISTRY_DIGEST_DENYLIST_INVALID", "The denylist actor identity is invalid.");
  const request = validateRegistryDigestDenylistMutationRequest(input.request);
  if (!request.valid) throw new RegistryModerationError("REGISTRY_DIGEST_DENYLIST_INVALID", request.issues[0]?.message ?? "The denylist request is invalid.");
  if (typeof input.requestId !== "string" || input.requestId.length < 1 || input.requestId.length > 128 || /[\u0000-\u001f\u007f]/.test(input.requestId)) {
    throw new RegistryModerationError("REGISTRY_DIGEST_DENYLIST_INVALID", "The denylist request ID is invalid.");
  }
  return request.value;
}

function releaseModerationAuditAction(operation: RegistryReleaseModerationOperation): RegistryModerationAuditEvent["action"] {
  if (operation === "deprecate") return "release_deprecated";
  if (operation === "quarantine") return "release_quarantined";
  return "release_unquarantined";
}

function releaseModerationResponseFromRow(row: RegistryReleaseModerationRow, operation: RegistryReleaseModerationOperation): RegistryReleaseModerationResponse {
  const response: RegistryReleaseModerationResponse = {
    apiVersion: REGISTRY_API_VERSION,
    coordinate: { namespace: row.namespace, name: row.name, version: row.version },
    operation,
    status: row.status,
    changedAt: dateValue(row.changed_at),
    auditEventId: row.audit_event_id,
  };
  const validation = validateRegistryReleaseModerationResponse(response);
  if (!validation.valid) throw new RegistryModerationError("REGISTRY_RELEASE_MODERATION_INVALID", validation.issues[0]?.message ?? "Stored release moderation metadata is invalid.");
  return validation.value;
}

function denylistMutationResponseFromRow(row: RegistryDenylistMutationRow, action: RegistryDigestDenylistAction): RegistryDigestDenylistMutationResponse {
  const response: RegistryDigestDenylistMutationResponse = {
    apiVersion: REGISTRY_API_VERSION,
    action,
    digest: row.digest as `sha256:${string}`,
    active: row.active,
    changedAt: dateValue(row.changed_at),
    auditEventId: row.audit_event_id,
  };
  const validation = validateRegistryDigestDenylistMutationResponse(response);
  if (!validation.valid) throw new RegistryModerationError("REGISTRY_DIGEST_DENYLIST_INVALID", validation.issues[0]?.message ?? "Stored denylist metadata is invalid.");
  return validation.value;
}

function denylistResultActive(metadata: unknown, fallback: boolean): boolean {
  let value: unknown = metadata;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const active = (value as Record<string, unknown>).active;
    if (typeof active === "boolean") return active;
  }
  return fallback;
}

function reportFromRow(row: RegistryReportRow): RegistryReport {
  const report: RegistryReport = {
    apiVersion: REGISTRY_API_VERSION,
    reportId: row.report_id,
    target: {
      package: { namespace: row.namespace, name: row.name },
      ...(row.release_version === null ? {} : { releaseVersion: row.release_version }),
    },
    category: row.category,
    status: row.status,
    evidence: row.evidence,
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  };
  const validation = validateRegistryReport(report);
  if (!validation.valid) throw new RegistryModerationError("REGISTRY_REPORT_INVALID", validation.issues[0]?.message ?? "Stored report metadata is invalid.");
  return validation.value;
}

function auditEventFromRow(row: RegistryModerationAuditEventRow): RegistryModerationAuditEvent {
  const actor = row.actor_kind === "system"
    ? { kind: "system" as const }
    : row.actor_provider === null || row.actor_subject === null
      ? (() => { throw new RegistryModerationError("REGISTRY_AUDIT_EVENT_INVALID", "Stored audit actor identity is incomplete."); })()
      : { kind: row.actor_kind, identity: { provider: row.actor_provider as "github", subject: row.actor_subject } };
  const target = moderationTargetFromRow(row);
  let metadata: unknown = row.metadata_json;
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch { metadata = null; }
  }
  const event: RegistryModerationAuditEvent = {
    eventId: row.event_id,
    action: row.action,
    actor,
    target,
    occurredAt: dateValue(row.occurred_at),
    requestId: row.request_id,
    metadata: metadata as Readonly<Record<string, string>>,
  };
  const validation = validateRegistryModerationAuditEventListResponse({ apiVersion: REGISTRY_API_VERSION, items: [event] });
  if (!validation.valid) throw new RegistryModerationError("REGISTRY_AUDIT_EVENT_INVALID", validation.issues[0]?.message ?? "Stored audit event is invalid.");
  return validation.value.items[0]!;
}

function moderationTargetFromRow(row: RegistryModerationAuditEventRow): RegistryModerationAuditTarget {
  if (row.target_type === "report" && row.target_report_id !== null) return { type: "report", reportId: row.target_report_id };
  if (row.target_type === "package" && row.target_namespace !== null && row.target_name !== null) {
    return { type: "package", package: { namespace: row.target_namespace, name: row.target_name } };
  }
  if (row.target_type === "release" && row.target_namespace !== null && row.target_name !== null && row.target_version !== null) {
    return { type: "release", release: { namespace: row.target_namespace, name: row.target_name, version: row.target_version } };
  }
  if (row.target_type === "artifact" && row.target_digest !== null) return { type: "artifact", digest: row.target_digest as `sha256:${string}` };
  throw new RegistryModerationError("REGISTRY_AUDIT_EVENT_INVALID", "Stored audit target is incomplete.");
}

function publisherWorkspaceFromRows(rows: readonly RegistryPublisherWorkspaceRow[], now: number): RegistryPublisherWorkspaceResponse {
  const namespaces = new Map<string, Map<string, RegistryPublisherPackageHistory & { releases: RegistryPublisherReleaseSummary[] }>>();
  for (const row of rows) {
    let packages = namespaces.get(row.namespace);
    if (!packages) {
      packages = new Map();
      namespaces.set(row.namespace, packages);
    }
    if (row.release_id === null) continue;
    if (
      row.name === null || row.version === null || row.reservation_created_at === null || row.expires_at === null
    ) {
      throw new RegistryRepositoryError("REGISTRY_ROW_INVALID", "Publisher release history is incomplete.");
    }

    const release: RegistryPublisherReleaseSummary = {
      releaseId: row.release_id,
      version: row.version,
      status: publisherReleaseStatus(row, now),
      createdAt: dateValue(row.reservation_created_at),
      expiresAt: dateValue(row.expires_at),
      ...(row.digest === null ? {} : { digest: row.digest as `sha256:${string}` }),
      ...(row.completed_at === null ? {} : { completedAt: dateValue(row.completed_at) }),
      ...(row.published_at === null ? {} : { publishedAt: dateValue(row.published_at) }),
    };
    const existing = packages.get(row.name);
    if (existing) {
      existing.releases.push(release);
      if (isPublishedPublisherStatus(release.status) && (!existing.latestVersion || compareVersions(release.version, existing.latestVersion) > 0)) {
        existing.latestVersion = release.version;
      }
      continue;
    }
    packages.set(row.name, {
      package: { namespace: row.namespace, name: row.name },
      ...(isPublishedPublisherStatus(release.status) ? { latestVersion: release.version } : {}),
      releases: [release],
    });
  }

  return {
    apiVersion: REGISTRY_API_VERSION,
    namespaces: [...namespaces.entries()].map(([namespace, packages]) => ({
      namespace,
      packages: [...packages.values()],
    })),
  };
}

function publisherReleaseStatus(row: RegistryPublisherWorkspaceRow, now: number): RegistryPublisherReleaseStatus {
  if (row.public_status !== null) return row.public_status;
  if (row.upload_status === "reserved") return "uploading";
  if (row.upload_status !== null) return row.upload_status;
  if (row.expires_at === null) throw new RegistryRepositoryError("REGISTRY_ROW_INVALID", "Publisher release expiry is missing.");
  return new Date(row.expires_at).getTime() <= now ? "expired" : "reserved";
}

function isPublishedPublisherStatus(status: RegistryPublisherReleaseStatus): boolean {
  return status === "active" || status === "deprecated";
}

function reservationFromRow(row: RegistryReleaseReservationRow): RegistryReleaseReservation {
  return {
    apiVersion: REGISTRY_API_VERSION,
    releaseId: row.release_id,
    coordinate: { namespace: row.namespace, name: row.name, version: row.version },
    status: "reserved",
    createdAt: dateValue(row.created_at),
    expiresAt: dateValue(row.expires_at),
  };
}

function completionFromRow(row: RegistryReleaseUploadRow): RegistryReleaseCompletionResponse {
  const completion = row.completion_json;
  if (!completion || typeof completion !== "object" || Array.isArray(completion)) {
    throw new RegistryReleaseUploadError("REGISTRY_RELEASE_COMPLETION_INVALID", "Stored release completion metadata is invalid.");
  }
  const value = completion as RegistryReleaseCompletionRequest;
  return {
    apiVersion: REGISTRY_API_VERSION,
    releaseId: row.release_id,
    coordinate: { namespace: row.namespace, name: row.name, version: row.version },
    status: "scanning",
    artifact: value.artifact,
    completedAt: dateValue(row.completed_at ?? new Date()),
  };
}

function artifactObjectKey(digest: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new RegistryReleaseUploadError("REGISTRY_ARTIFACT_METADATA_CONFLICT", "The artifact digest is invalid.");
  }
  const hex = digest.slice("sha256:".length);
  return `artifacts/sha256/${hex.slice(0, 2)}/${hex}.agentcargo`;
}

function dateValue(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function queueCount(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RegistryRepositoryError("REGISTRY_ROW_INVALID", "The scan queue returned an invalid counter.");
  }
  return parsed;
}

function equalJson(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
  }
  if (left && typeof left === "object" || right && typeof right === "object") {
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    const leftEntries = Object.entries(left as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const rightEntries = Object.entries(right as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return leftEntries.length === rightEntries.length
      && leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && equalJson(value, rightEntries[index]![1]));
  }
  return left === right;
}

function boundedSessionTtl(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), 3600);
}

function normalizeSessionScopes(scopes: readonly RegistrySessionScope[]): readonly RegistrySessionScope[] {
  const normalized = [...new Set(scopes)];
  if (normalized.length !== scopes.length || normalized.length === 0 || normalized.some((scope) => scope !== "publisher:read" && scope !== "publisher:write")) {
    throw new TypeError("Cannot issue a session with invalid registry scopes.");
  }
  return normalized;
}

function normalizeStoredSessionScopes(scopes: readonly string[] | undefined): readonly RegistrySessionScope[] | null {
  const values = scopes ?? DEFAULT_REGISTRY_SESSION_SCOPES;
  return values.every((scope): scope is RegistrySessionScope => scope === "publisher:read" || scope === "publisher:write")
    ? normalizeSessionScopes(values)
    : null;
}

function safeSessionToken(value: string): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 16384) return null;
  if (/[^\u0021-\u007e]/.test(value)) return null;
  return value;
}

function hashSessionToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashOpaqueValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateOAuthStateValue(value: string, label: string): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`The ${label} is invalid.`);
  }
  return value;
}

function validateOAuthRedirectUri(value: string): string {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((!localHttp && url.protocol !== "https:") || url.username || url.password || url.hash || value.length > 2048) throw new Error();
    return url.href;
  } catch {
    throw new TypeError("The OAuth redirect URI is invalid.");
  }
}

function clonePublisherIdentity(identity: RegistryPublisherIdentity): RegistryPublisherIdentity {
  return identity.login === undefined
    ? { provider: identity.provider, subject: identity.subject }
    : { provider: identity.provider, subject: identity.subject, login: identity.login };
}

function parseRelease(value: unknown, label: string): RegistryRelease {
  const result = validateRegistryRelease(value);
  if (!result.valid) {
    throw new RegistryRepositoryError("REGISTRY_ROW_INVALID", `${label} is invalid: ${result.issues[0]?.message ?? "unknown error"}`);
  }
  return cloneRelease(result.value);
}

function parsePackage(value: unknown, label: string): RegistryPackageSummary {
  const result = validateRegistrySearchResponse({ apiVersion: REGISTRY_API_VERSION, items: [value] });
  if (!result.valid) {
    throw new RegistryRepositoryError("REGISTRY_ROW_INVALID", `${label} is invalid: ${result.issues[0]?.message ?? "unknown error"}`);
  }
  return result.value.items[0]!;
}

function cloneRelease(release: RegistryRelease): RegistryRelease {
  return structuredClone(release);
}

function toPackageSummary(releases: readonly RegistryRelease[]): RegistryPackageSummary {
  const latest = [...releases].sort((a, b) => compareVersions(b.coordinate.version, a.coordinate.version))[0]!;
  return {
    apiVersion: REGISTRY_API_VERSION,
    package: { namespace: latest.coordinate.namespace, name: latest.coordinate.name },
    description: latest.declared.description,
    latestVersion: latest.coordinate.version,
    compatibility: latest.declared.compatibility,
    tags: latest.declared.tags,
    hasScripts: latest.files.some((file) => file.scriptLike),
    status: latest.status,
  };
}

function compareVersions(left: string, right: string): number {
  const leftCore = left.split("-", 1)[0]!.split("+")[0]!.split(".").map(Number);
  const rightCore = right.split("-", 1)[0]!.split("+")[0]!.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftCore[index] ?? 0) - (rightCore[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

function dedupePackageSummaries(releases: readonly RegistryRelease[]): RegistryPackageSummary[] {
  const byCoordinate = new Map<string, RegistryRelease[]>();
  for (const release of releases) {
    const key = formatPackageCoordinate(release.coordinate);
    const list = byCoordinate.get(key) ?? [];
    list.push(release);
    byCoordinate.set(key, list);
  }
  return [...byCoordinate.values()].map(toPackageSummary);
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const decoded = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
  return Number.isSafeInteger(decoded) && decoded >= 0 ? decoded : 0;
}
