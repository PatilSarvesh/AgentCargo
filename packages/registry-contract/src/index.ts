import type {
  RegistryApiVersion,
  RegistryArtifactFormat,
  RegistryArtifactMediaType,
} from "./constants.js";

export {
  AGENTCARGO_ARTIFACT_FORMAT,
  AGENTCARGO_ARTIFACT_MEDIA_TYPE,
  REGISTRY_API_PREFIX,
  REGISTRY_API_VERSION,
} from "./constants.js";
export type { RegistryApiVersion, RegistryArtifactFormat, RegistryArtifactMediaType } from "./constants.js";
export type RegistryScope = "project" | "user";
export type RegistrySessionScope = "publisher:read" | "publisher:write";
export const DEFAULT_REGISTRY_SESSION_SCOPES: readonly RegistrySessionScope[] = ["publisher:read", "publisher:write"];
export type RegistryReleaseStatus = "active" | "deprecated" | "quarantined";
export type Sha256Digest = `sha256:${string}`;

/**
 * Identity asserted by an authentication adapter. The registry never treats
 * the display login as an authorization key; `subject` is the provider's
 * stable account identifier.
 */
export interface RegistryPublisherIdentity {
  provider: "github";
  subject: string;
  login?: string;
}

/** A short-lived credential held by the local auth handoff, never a lockfile field. */
export interface RegistryAuthCredential {
  provider: "github";
  tokenType: "bearer";
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  refreshTokenExpiresAt?: string;
  scopes?: readonly string[];
}

/** A short-lived AgentCargo session returned after provider-token exchange. */
export interface RegistryAuthSession {
  accessToken: string;
  tokenType: "bearer";
  expiresAt: string;
  identity: RegistryPublisherIdentity;
  scopes: readonly RegistrySessionScope[];
}

export interface RegistryAuthSessionResponse {
  apiVersion: RegistryApiVersion;
  session: RegistryAuthSession;
}

/** Token-free metadata returned when a registry session is introspected. */
export interface RegistryAuthSessionMetadata {
  expiresAt: string;
  scopes: readonly RegistrySessionScope[];
}

export interface RegistryAuthSessionMetadataResponse {
  apiVersion: RegistryApiVersion;
  session: RegistryAuthSessionMetadata;
}

export interface RegistryAuthSessionRequest {
  scopes?: readonly RegistrySessionScope[];
}

export type RegistryOperationalStatus = "operational" | "degraded" | "unavailable" | "not_configured";
export type RegistryStatusOverall = "operational" | "degraded" | "outage";

export interface RegistryStatusComponent {
  status: RegistryOperationalStatus;
  checkedAt: string;
  detail?: string;
}

export interface RegistryStatusQueue {
  queued: number;
  failed: number;
  running: number;
  staleLeases: number;
  oldestAvailableAt: string | null;
  lagMs: number;
}

export interface RegistryStatusWorkerComponent extends RegistryStatusComponent {
  ready: boolean;
  reason: string;
  totalRuns: number;
  claimedJobs: number;
  consecutiveFailures: number;
  lastRunAgeMs: number | null;
  queue: RegistryStatusQueue | null;
}

export interface RegistryStatusModerationComponent extends RegistryStatusComponent {
  activeDenylistEntries: number | null;
}

export interface RegistryStatusResponse {
  apiVersion: RegistryApiVersion;
  generatedAt: string;
  overall: RegistryStatusOverall;
  components: {
    api: RegistryStatusComponent;
    database: RegistryStatusComponent;
    storage: RegistryStatusComponent;
    worker: RegistryStatusWorkerComponent;
    moderation: RegistryStatusModerationComponent;
  };
}

export type RegistryPublisherReleaseStatus =
  | "reserved"
  | "expired"
  | "uploading"
  | "uploaded"
  | "scanning"
  | "active"
  | "deprecated"
  | "quarantined"
  | "rejected";

/** Authenticated publisher view of one immutable release reservation. */
export interface RegistryPublisherReleaseSummary {
  releaseId: string;
  version: string;
  status: RegistryPublisherReleaseStatus;
  createdAt: string;
  expiresAt: string;
  digest?: Sha256Digest;
  completedAt?: string;
  publishedAt?: string;
}

export interface RegistryPublisherPackageHistory {
  package: RegistryPackageCoordinate;
  latestVersion?: string;
  releases: readonly RegistryPublisherReleaseSummary[];
}

export interface RegistryPublisherNamespaceSummary {
  namespace: string;
  packages: readonly RegistryPublisherPackageHistory[];
}

export interface RegistryPublisherWorkspaceResponse {
  apiVersion: RegistryApiVersion;
  namespaces: readonly RegistryPublisherNamespaceSummary[];
}

export type RegistryReportCategory = "malware" | "impersonation" | "spam" | "copyright" | "policy" | "other";
export type RegistryReportStatus = "open" | "triaged" | "resolved" | "dismissed";
export type RegistryModerationAuditAction =
  | "report_created"
  | "report_triaged"
  | "report_resolved"
  | "report_dismissed"
  | "release_deprecated"
  | "release_quarantined"
  | "release_unquarantined"
  | "digest_denylisted"
  | "digest_denylist_removed";

/** A package or exact release selected as the subject of an abuse report. */
export interface RegistryReportTarget {
  package: RegistryPackageCoordinate;
  releaseVersion?: string;
}

export interface RegistryReportRequest {
  target: RegistryReportTarget;
  category: RegistryReportCategory;
  evidence: string;
  idempotencyKey: string;
}

export interface RegistryReport {
  apiVersion: RegistryApiVersion;
  reportId: string;
  target: RegistryReportTarget;
  category: RegistryReportCategory;
  status: RegistryReportStatus;
  evidence: string;
  createdAt: string;
  updatedAt: string;
}

export type RegistryReleaseModerationOperation = "deprecate" | "quarantine" | "unquarantine";

export interface RegistryReleaseModerationRequest {
  reason: string;
  idempotencyKey: string;
}

export interface RegistryReleaseModerationResponse {
  apiVersion: RegistryApiVersion;
  coordinate: RegistryReleaseCoordinate;
  operation: RegistryReleaseModerationOperation;
  status: RegistryReleaseStatus;
  changedAt: string;
  auditEventId: string;
}

export interface RegistryDigestDenylistEntry {
  digest: Sha256Digest;
  reason: string;
  addedAt: string;
}

export interface RegistryDigestDenylistResponse {
  apiVersion: RegistryApiVersion;
  items: readonly RegistryDigestDenylistEntry[];
}

export type RegistryDigestDenylistAction = "add" | "remove";

export interface RegistryDigestDenylistMutationRequest {
  action: RegistryDigestDenylistAction;
  digest: Sha256Digest;
  reason: string;
  idempotencyKey: string;
}

export interface RegistryDigestDenylistMutationResponse {
  apiVersion: RegistryApiVersion;
  action: RegistryDigestDenylistAction;
  digest: Sha256Digest;
  active: boolean;
  changedAt: string;
  auditEventId: string;
}

export interface RegistryModerationActor {
  kind: "publisher" | "maintainer" | "system";
  identity?: RegistryPublisherIdentity;
}

export type RegistryModerationAuditTarget =
  | { type: "report"; reportId: string }
  | { type: "package"; package: RegistryPackageCoordinate }
  | { type: "release"; release: RegistryReleaseCoordinate }
  | { type: "artifact"; digest: Sha256Digest };

export interface RegistryModerationAuditEvent {
  eventId: string;
  action: RegistryModerationAuditAction;
  actor: RegistryModerationActor;
  target: RegistryModerationAuditTarget;
  occurredAt: string;
  requestId: string;
  metadata: Readonly<Record<string, string>>;
}

export interface RegistryModerationAuditEventListRequest {
  cursor?: string;
  limit?: number;
}

export interface RegistryModerationAuditEventListResponse {
  apiVersion: RegistryApiVersion;
  items: readonly RegistryModerationAuditEvent[];
  nextCursor?: string;
}

export interface RegistryReleaseReservationRequest {
  version: string;
  idempotencyKey: string;
}

export interface RegistryReleaseReservation {
  apiVersion: RegistryApiVersion;
  releaseId: string;
  coordinate: RegistryReleaseCoordinate;
  status: "reserved";
  createdAt: string;
  expiresAt: string;
}

export interface RegistryPackageCoordinate {
  namespace: string;
  name: string;
}

export interface RegistryReleaseCoordinate extends RegistryPackageCoordinate {
  version: string;
}

export interface RegistryHostCompatibility {
  scopes: readonly RegistryScope[];
}

export interface RegistryDeclaredMetadata {
  description: string;
  license?: string;
  repositoryUrl?: string;
  tags: readonly string[];
  compatibility: Readonly<Record<string, RegistryHostCompatibility>>;
  capabilities?: Readonly<Record<string, unknown>>;
  /** Descriptive runtime requirements; the MVP does not resolve them. */
  dependencies?: readonly string[];
}

export interface RegistryArtifactDownload {
  url: string;
  expiresAt: string;
}

export interface RegistryArtifactMetadata {
  format: RegistryArtifactFormat;
  mediaType: RegistryArtifactMediaType;
  digest: Sha256Digest;
  bytes: number;
}

export interface RegistryArtifactReference extends RegistryArtifactMetadata {
  download: RegistryArtifactDownload;
}

export interface RegistryArtifactUploadRequest {
  digest: Sha256Digest;
  bytes: number;
}

export interface RegistryArtifactUploadResponse {
  apiVersion: RegistryApiVersion;
  releaseId: string;
  coordinate: RegistryReleaseCoordinate;
  digest: Sha256Digest;
  bytes: number;
  uploadUrl: string;
  expiresAt: string;
}

export interface RegistryFileSummary {
  path: string;
  bytes: number;
  executable: boolean;
  scriptLike: boolean;
}

export interface RegistryFindingSummary {
  ruleId: string;
  ruleVersion: string;
  severity: "info" | "warning" | "error";
  path?: string;
  evidence?: string;
  message: string;
  explanation: string;
  remediation: string;
}

export interface RegistryScanSummary {
  scannerVersion: string;
  completedAt: string;
  findings: readonly RegistryFindingSummary[];
}

export interface RegistrySourceReference {
  repositoryUrl?: string;
  commit?: string;
}

export interface RegistryReleaseCompletionRequest {
  artifact: RegistryArtifactMetadata;
  declared: RegistryDeclaredMetadata;
  files: readonly RegistryFileSummary[];
  scan: RegistryScanSummary;
  source: RegistrySourceReference;
}

export interface RegistryReleaseCompletionResponse {
  apiVersion: RegistryApiVersion;
  releaseId: string;
  coordinate: RegistryReleaseCoordinate;
  status: "scanning";
  artifact: RegistryArtifactMetadata;
  completedAt: string;
}

/**
 * A public release response. The coordinate, manifest metadata, artifact
 * digest, file inventory, and scan result are immutable after activation.
 * Only the signed download URL and its expiry are request-scoped values.
 */
export interface RegistryRelease {
  apiVersion: RegistryApiVersion;
  coordinate: RegistryReleaseCoordinate;
  status: Exclude<RegistryReleaseStatus, "quarantined">;
  declared: RegistryDeclaredMetadata;
  artifact: RegistryArtifactReference;
  files: readonly RegistryFileSummary[];
  scan: RegistryScanSummary;
  source: RegistrySourceReference;
  publishedAt: string;
}

export interface RegistryPackageSummary {
  apiVersion: RegistryApiVersion;
  package: RegistryPackageCoordinate;
  description: string;
  latestVersion?: string;
  compatibility: Readonly<Record<string, RegistryHostCompatibility>>;
  tags: readonly string[];
  hasScripts: boolean;
  status: "active" | "deprecated";
}

export interface RegistrySearchRequest {
  query: string;
  host?: string;
  scope?: RegistryScope;
  cursor?: string;
  limit?: number;
}

export interface RegistrySearchResponse {
  apiVersion: RegistryApiVersion;
  items: readonly RegistryPackageSummary[];
  nextCursor?: string;
}

export interface RegistryReleaseLookupResponse {
  apiVersion: RegistryApiVersion;
  release: RegistryRelease;
}

export interface RegistryApiError {
  apiVersion: RegistryApiVersion;
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Readonly<Record<string, unknown>>;
  };
}

export function formatPackageCoordinate(coordinate: RegistryPackageCoordinate): string {
  return `@${coordinate.namespace}/${coordinate.name}`;
}

export function formatReleaseCoordinate(coordinate: RegistryReleaseCoordinate): string {
  return `${formatPackageCoordinate(coordinate)}@${coordinate.version}`;
}

export function isSha256Digest(value: string): value is Sha256Digest {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

export function assertPublicReleaseStatus(
  status: RegistryReleaseStatus,
): asserts status is Exclude<RegistryReleaseStatus, "quarantined"> {
  if (status === "quarantined") {
    throw new Error("Quarantined releases are not public read-path results.");
  }
}

export * from "./validation.js";
