import {
  REGISTRY_API_VERSION,
  AGENTCARGO_ARTIFACT_FORMAT,
  AGENTCARGO_ARTIFACT_MEDIA_TYPE,
  DEFAULT_REGISTRY_SESSION_SCOPES,
  formatPackageCoordinate,
  formatReleaseCoordinate,
  validateRegistryRelease,
  validateRegistryReleaseCompletionRequest,
  validateRegistryPublisherIdentity,
  validateRegistrySearchResponse,
  type RegistryAuthSession,
  type RegistryReleaseCompletionRequest,
  type RegistryReleaseCompletionResponse,
  type RegistryPackageCoordinate,
  type RegistryPackageSummary,
  type RegistryPublisherIdentity,
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
      | "REGISTRY_SCAN_INVALID",
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

export interface RegistryAuthSessionRow {
  provider: string;
  subject: string;
  login: string | null;
  scopes?: readonly string[];
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

  async resolveContext(accessToken: string): Promise<{ identity: RegistryPublisherIdentity; scopes: readonly RegistrySessionScope[] } | null> {
    const token = safeSessionToken(accessToken);
    if (!token) return null;
    const result = await this.query<RegistryAuthSessionRow>(
      `SELECT sessions.provider, sessions.subject, publishers.login, sessions.scopes
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
    return {
      identity: {
        provider: "github",
        subject: row.subject,
        ...(row.login === null ? {} : { login: row.login }),
      },
      scopes,
    };
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

export class RegistryRepositoryError extends Error {
  constructor(
    public readonly code: "REGISTRY_ROW_INVALID" | "REGISTRY_SEARCH_RESULT_INVALID" | "REGISTRY_DB_QUERY_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "RegistryRepositoryError";
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

  private async query<Row>(text: string, values: readonly unknown[]): Promise<RegistrySqlResult<Row>> {
    return queryRegistry(this.client, text, values);
  }
}

/** PostgreSQL release input and public-projection boundary for the worker. */
export class PostgresRegistryReleaseScanRepository implements RegistryReleaseScanRepository {
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

  constructor(private readonly client: RegistrySqlClient) {}
}

export class InMemoryRegistryReleaseRepository implements RegistryReleaseRepository {
  readonly #releases: RegistryRelease[];

  constructor(releases: readonly RegistryRelease[]) {
    this.#releases = releases.map((release) => cloneRelease(release));
  }

  async getPackage(coordinate: RegistryPackageCoordinate): Promise<RegistryPackageSummary | null> {
    const matching = this.#releases.filter(
      (release) =>
        release.coordinate.namespace === coordinate.namespace && release.coordinate.name === coordinate.name,
    );
    return matching.length === 0 ? null : toPackageSummary(matching);
  }

  async getRelease(coordinate: RegistryReleaseCoordinate): Promise<RegistryRelease | null> {
    const release = this.#releases.find(
      (candidate) =>
        candidate.coordinate.namespace === coordinate.namespace &&
        candidate.coordinate.name === coordinate.name &&
        candidate.coordinate.version === coordinate.version,
    );
    return release ? cloneRelease(release) : null;
  }

  async search(request: RegistrySearchRequest): Promise<RegistrySearchResponse> {
    const query = request.query.toLocaleLowerCase();
    const matching = this.#releases.filter((release) => {
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
       LIMIT 1`,
      [coordinate.namespace, coordinate.name],
    );
    const row = result.rows[0];
    if (!row) return null;
    return parsePackage(row.package_json, `${formatPackageCoordinate(coordinate)} package`);
  }

  async getRelease(coordinate: RegistryReleaseCoordinate): Promise<RegistryRelease | null> {
    const result = await this.query<RegistryReleaseRow>(
      `SELECT release_json, artifact_key
       FROM registry_public_releases
       WHERE namespace = $1 AND name = $2 AND version = $3
         AND status IN ('active', 'deprecated')
       LIMIT 1`,
      [coordinate.namespace, coordinate.name, coordinate.version],
    );
    const row = result.rows[0];
    if (!row) return null;
    const release = parseRelease(row.release_json, `${formatReleaseCoordinate(coordinate)} release`);
    const download = await this.createArtifactDownload({ digest: release.artifact.digest, artifactKey: row.artifact_key });
    return {
      ...release,
      artifact: { ...release.artifact, download },
    };
  }

  async search(request: RegistrySearchRequest): Promise<RegistrySearchResponse> {
    const result = await this.query<RegistrySearchRow>(
      `SELECT package_json
       FROM registry_public_packages
       WHERE status IN ('active', 'deprecated')
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
