import {
  AGENTCARGO_ARTIFACT_FORMAT,
  AGENTCARGO_ARTIFACT_MEDIA_TYPE,
  REGISTRY_API_VERSION,
} from "./constants.js";
import type {
  RegistryApiError,
  RegistryArtifactUploadRequest,
  RegistryArtifactUploadResponse,
  RegistryAuthCredential,
  RegistryAuthSession,
  RegistryAuthSessionMetadataResponse,
  RegistryAuthSessionRequest,
  RegistryAuthSessionResponse,
  RegistryDeclaredMetadata,
  RegistryFindingSummary,
  RegistryPackageSummary,
  RegistryModerationAuditEventListRequest,
  RegistryModerationAuditEventListResponse,
  RegistryPublisherIdentity,
  RegistryPublisherWorkspaceResponse,
  RegistryReport,
  RegistryReportRequest,
  RegistryDigestDenylistEntry,
  RegistryDigestDenylistMutationRequest,
  RegistryDigestDenylistMutationResponse,
  RegistryDigestDenylistResponse,
  RegistryReleaseModerationRequest,
  RegistryReleaseModerationResponse,
  RegistryRelease,
  RegistryReleaseCompletionRequest,
  RegistryReleaseCompletionResponse,
  RegistryReleaseCoordinate,
  RegistryReleaseLookupResponse,
  RegistryReleaseReservation,
  RegistryReleaseReservationRequest,
  RegistryScanSummary,
  RegistrySessionScope,
  RegistryStatusResponse,
  RegistrySearchRequest,
  RegistrySearchResponse,
} from "./index.js";

export interface RegistryValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type RegistryValidationResult<T> =
  | { valid: true; value: T; issues: readonly [] }
  | { valid: false; issues: readonly RegistryValidationIssue[] };

export class RegistryContractValidationError extends Error {
  constructor(public readonly issues: readonly RegistryValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "RegistryContractValidationError";
  }
}

export function validateRegistrySearchRequest(input: unknown): RegistryValidationResult<RegistrySearchRequest> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["query", "host", "scope", "cursor", "limit"], ["query"], "$", issues);
    stringField(value, "query", "$.query", issues, { minLength: 1, maxLength: 256 });
    optionalStringField(value, "host", "$.host", issues, { minLength: 1, maxLength: 64 });
    optionalEnumField(value, "scope", "$.scope", ["project", "user"], issues);
    optionalStringField(value, "cursor", "$.cursor", issues, { minLength: 1, maxLength: 512 });
    optionalIntegerField(value, "limit", "$.limit", issues, 1, 100);
  }
  return validationResult(input, issues);
}

export function validateRegistrySearchResponse(input: unknown): RegistryValidationResult<RegistrySearchResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "items", "nextCursor"], ["apiVersion", "items"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    const items = value.items;
    if (!Array.isArray(items)) {
      issue(issues, "$.items", "TYPE_INVALID", "Expected an array.");
    } else {
      items.forEach((item, index) => validatePackageSummary(item, `$.items[${index}]`, issues));
    }
    optionalStringField(value, "nextCursor", "$.nextCursor", issues, { minLength: 1, maxLength: 512 });
  }
  return validationResult(input, issues);
}

export function validateRegistryPackageSummary(input: unknown): RegistryValidationResult<RegistryPackageSummary> {
  const issues: RegistryValidationIssue[] = [];
  validatePackageSummary(input, "$", issues);
  return validationResult(input, issues);
}

export function validateRegistryPublisherIdentity(input: unknown): RegistryValidationResult<RegistryPublisherIdentity> {
  const issues: RegistryValidationIssue[] = [];
  validatePublisherIdentity(input, "$", issues);
  return validationResult(input, issues);
}

export function validateRegistryAuthCredential(input: unknown): RegistryValidationResult<RegistryAuthCredential> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(
      value,
      ["provider", "tokenType", "accessToken", "refreshToken", "expiresAt", "refreshTokenExpiresAt", "scopes"],
      ["provider", "tokenType", "accessToken"],
      "$",
      issues,
    );
    enumField(value, "provider", "$.provider", ["github"], issues);
    enumField(value, "tokenType", "$.tokenType", ["bearer"], issues);
    stringField(value, "accessToken", "$.accessToken", issues, { minLength: 1, maxLength: 16384, noControlCharacters: true });
    optionalStringField(value, "refreshToken", "$.refreshToken", issues, { minLength: 1, maxLength: 16384, noControlCharacters: true });
    optionalStringField(value, "expiresAt", "$.expiresAt", issues, { dateTime: true });
    optionalStringField(value, "refreshTokenExpiresAt", "$.refreshTokenExpiresAt", issues, { dateTime: true });
    optionalStringArrayField(value, "scopes", "$.scopes", issues, { maxItems: 64, itemMaxLength: 128 });
  }
  return validationResult(input, issues);
}

export function validateRegistryAuthSession(input: unknown): RegistryValidationResult<RegistryAuthSession> {
  const issues: RegistryValidationIssue[] = [];
  validateAuthSession(input, "$", issues);
  return validationResult(input, issues);
}

export function validateRegistryAuthSessionResponse(input: unknown): RegistryValidationResult<RegistryAuthSessionResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "session"], ["apiVersion", "session"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    validateAuthSession(value.session, "$.session", issues);
  }
  return validationResult(input, issues);
}

export function validateRegistryAuthSessionMetadataResponse(input: unknown): RegistryValidationResult<RegistryAuthSessionMetadataResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "session"], ["apiVersion", "session"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    validateAuthSessionMetadata(value.session, "$.session", issues);
  }
  return validationResult(input, issues);
}

export function validateRegistryStatusResponse(input: unknown): RegistryValidationResult<RegistryStatusResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "generatedAt", "overall", "components"], ["apiVersion", "generatedAt", "overall", "components"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    stringField(value, "generatedAt", "$.generatedAt", issues, { dateTime: true });
    enumField(value, "overall", "$.overall", ["operational", "degraded", "outage"], issues);
    const components = asRecord(value.components, "$.components", issues);
    if (components) {
      exactKeys(components, ["api", "database", "storage", "worker", "moderation"], ["api", "database", "storage", "worker", "moderation"], "$.components", issues);
      validateStatusComponent(components.api, "$.components.api", issues);
      validateStatusComponent(components.database, "$.components.database", issues);
      validateStatusComponent(components.storage, "$.components.storage", issues);
      validateStatusWorkerComponent(components.worker, "$.components.worker", issues);
      validateStatusModerationComponent(components.moderation, "$.components.moderation", issues);
    }
  }
  return validationResult(input, issues);
}

export function validateRegistryAuthSessionRequest(input: unknown): RegistryValidationResult<RegistryAuthSessionRequest> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["scopes"], [], "$", issues);
    optionalEnumStringArrayField(value, "scopes", "$.scopes", ["publisher:read", "publisher:write"], issues);
  }
  return validationResult(input, issues);
}

export function validateRegistryPublisherWorkspaceResponse(input: unknown): RegistryValidationResult<RegistryPublisherWorkspaceResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "namespaces"], ["apiVersion", "namespaces"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    const namespaces = value.namespaces;
    if (!Array.isArray(namespaces)) {
      issue(issues, "$.namespaces", "TYPE_INVALID", "Expected an array.");
    } else {
      if (namespaces.length > 100) issue(issues, "$.namespaces", "ARRAY_TOO_LARGE", "Expected at most 100 namespaces.");
      const seen = new Set<string>();
      namespaces.forEach((namespace, index) => {
        validatePublisherNamespace(namespace, `$.namespaces[${index}]`, issues);
        if (typeof namespace === "object" && namespace !== null && !Array.isArray(namespace)) {
          const name = (namespace as Record<string, unknown>).namespace;
          if (typeof name === "string") {
            if (seen.has(name)) issue(issues, `$.namespaces[${index}].namespace`, "DUPLICATE_VALUE", "Namespaces must be unique.");
            seen.add(name);
          }
        }
      });
    }
  }
  return validationResult(input, issues);
}

export function validateRegistryReportRequest(input: unknown): RegistryValidationResult<RegistryReportRequest> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["target", "category", "evidence", "idempotencyKey"], ["target", "category", "evidence", "idempotencyKey"], "$", issues);
    validateReportTarget(value.target, "$.target", issues);
    enumField(value, "category", "$.category", ["malware", "impersonation", "spam", "copyright", "policy", "other"], issues);
    stringField(value, "evidence", "$.evidence", issues, { minLength: 1, maxLength: 4096, noControlCharacters: true });
    stringField(value, "idempotencyKey", "$.idempotencyKey", issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
  }
  return validationResult(input, issues);
}

export function validateRegistryReport(input: unknown): RegistryValidationResult<RegistryReport> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "reportId", "target", "category", "status", "evidence", "createdAt", "updatedAt"], ["apiVersion", "reportId", "target", "category", "status", "evidence", "createdAt", "updatedAt"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    stringField(value, "reportId", "$.reportId", issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
    validateReportTarget(value.target, "$.target", issues);
    enumField(value, "category", "$.category", ["malware", "impersonation", "spam", "copyright", "policy", "other"], issues);
    enumField(value, "status", "$.status", ["open", "triaged", "resolved", "dismissed"], issues);
    stringField(value, "evidence", "$.evidence", issues, { minLength: 1, maxLength: 4096, noControlCharacters: true });
    stringField(value, "createdAt", "$.createdAt", issues, { dateTime: true });
    stringField(value, "updatedAt", "$.updatedAt", issues, { dateTime: true });
  }
  return validationResult(input, issues);
}

export function validateRegistryReleaseModerationRequest(input: unknown): RegistryValidationResult<RegistryReleaseModerationRequest> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["reason", "idempotencyKey"], ["reason", "idempotencyKey"], "$", issues);
    stringField(value, "reason", "$.reason", issues, { minLength: 1, maxLength: 512, noControlCharacters: true });
    stringField(value, "idempotencyKey", "$.idempotencyKey", issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
  }
  return validationResult(input, issues);
}

export function validateRegistryReleaseModerationResponse(input: unknown): RegistryValidationResult<RegistryReleaseModerationResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "coordinate", "operation", "status", "changedAt", "auditEventId"], ["apiVersion", "coordinate", "operation", "status", "changedAt", "auditEventId"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    validateReleaseCoordinate(value.coordinate, "$.coordinate", issues);
    enumField(value, "operation", "$.operation", ["deprecate", "quarantine", "unquarantine"], issues);
    enumField(value, "status", "$.status", ["active", "deprecated", "quarantined"], issues);
    stringField(value, "changedAt", "$.changedAt", issues, { dateTime: true });
    stringField(value, "auditEventId", "$.auditEventId", issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
    if (value.operation === "deprecate" && value.status !== "deprecated") issue(issues, "$.status", "STATE_INVALID", "Deprecation must produce a deprecated release.");
    if (value.operation === "quarantine" && value.status !== "quarantined") issue(issues, "$.status", "STATE_INVALID", "Quarantine must produce a quarantined release.");
    if (value.operation === "unquarantine" && value.status === "quarantined") issue(issues, "$.status", "STATE_INVALID", "Unquarantine must restore a public release status.");
  }
  return validationResult(input, issues);
}

export function validateRegistryDigestDenylistEntry(input: unknown): RegistryValidationResult<RegistryDigestDenylistEntry> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["digest", "reason", "addedAt"], ["digest", "reason", "addedAt"], "$", issues);
    stringField(value, "digest", "$.digest", issues, { digest: true });
    stringField(value, "reason", "$.reason", issues, { minLength: 1, maxLength: 512, noControlCharacters: true });
    stringField(value, "addedAt", "$.addedAt", issues, { dateTime: true });
  }
  return validationResult(input, issues);
}

export function validateRegistryDigestDenylistResponse(input: unknown): RegistryValidationResult<RegistryDigestDenylistResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "items"], ["apiVersion", "items"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    if (!Array.isArray(value.items)) {
      issue(issues, "$.items", "TYPE_INVALID", "Expected an array.");
    } else {
      if (value.items.length > 1000) issue(issues, "$.items", "ARRAY_TOO_LARGE", "Expected at most 1000 denylist entries.");
      value.items.forEach((item, index) => {
        const result = validateRegistryDigestDenylistEntry(item);
        if (!result.valid) issues.push(...result.issues.map((entry) => ({ ...entry, path: `$.items[${index}]${entry.path.slice(1)}` })));
      });
    }
  }
  return validationResult(input, issues);
}

export function validateRegistryDigestDenylistMutationRequest(input: unknown): RegistryValidationResult<RegistryDigestDenylistMutationRequest> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["action", "digest", "reason", "idempotencyKey"], ["action", "digest", "reason", "idempotencyKey"], "$", issues);
    enumField(value, "action", "$.action", ["add", "remove"], issues);
    stringField(value, "digest", "$.digest", issues, { digest: true });
    stringField(value, "reason", "$.reason", issues, { minLength: 1, maxLength: 512, noControlCharacters: true });
    stringField(value, "idempotencyKey", "$.idempotencyKey", issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
  }
  return validationResult(input, issues);
}

export function validateRegistryDigestDenylistMutationResponse(input: unknown): RegistryValidationResult<RegistryDigestDenylistMutationResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "action", "digest", "active", "changedAt", "auditEventId"], ["apiVersion", "action", "digest", "active", "changedAt", "auditEventId"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    enumField(value, "action", "$.action", ["add", "remove"], issues);
    stringField(value, "digest", "$.digest", issues, { digest: true });
    booleanField(value, "active", "$.active", issues);
    stringField(value, "changedAt", "$.changedAt", issues, { dateTime: true });
    stringField(value, "auditEventId", "$.auditEventId", issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
    if (value.action === "add" && value.active !== true) issue(issues, "$.active", "STATE_INVALID", "Adding a digest must leave it active on the denylist.");
    if (value.action === "remove" && value.active !== false) issue(issues, "$.active", "STATE_INVALID", "Removing a digest must leave it inactive on the denylist.");
  }
  return validationResult(input, issues);
}

export function validateRegistryModerationAuditEventListRequest(input: unknown): RegistryValidationResult<RegistryModerationAuditEventListRequest> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["cursor", "limit"], [], "$", issues);
    optionalStringField(value, "cursor", "$.cursor", issues, { minLength: 1, maxLength: 512 });
    optionalIntegerField(value, "limit", "$.limit", issues, 1, 100);
  }
  return validationResult(input, issues);
}

export function validateRegistryModerationAuditEventListResponse(input: unknown): RegistryValidationResult<RegistryModerationAuditEventListResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "items", "nextCursor"], ["apiVersion", "items"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    if (!Array.isArray(value.items)) {
      issue(issues, "$.items", "TYPE_INVALID", "Expected an array.");
    } else {
      if (value.items.length > 100) issue(issues, "$.items", "ARRAY_TOO_LARGE", "Expected at most 100 audit events.");
      value.items.forEach((item, index) => validateModerationAuditEvent(item, `$.items[${index}]`, issues));
    }
    optionalStringField(value, "nextCursor", "$.nextCursor", issues, { minLength: 1, maxLength: 512 });
  }
  return validationResult(input, issues);
}

export function validateRegistryReleaseReservationRequest(
  input: unknown,
): RegistryValidationResult<RegistryReleaseReservationRequest> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["version", "idempotencyKey"], ["version", "idempotencyKey"], "$", issues);
    stringField(value, "version", "$.version", issues, { semver: true });
    stringField(value, "idempotencyKey", "$.idempotencyKey", issues, {
      minLength: 1,
      maxLength: 128,
      noControlCharacters: true,
    });
  }
  return validationResult(input, issues);
}

export function validateRegistryReleaseReservation(
  input: unknown,
): RegistryValidationResult<RegistryReleaseReservation> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(
      value,
      ["apiVersion", "releaseId", "coordinate", "status", "createdAt", "expiresAt"],
      ["apiVersion", "releaseId", "coordinate", "status", "createdAt", "expiresAt"],
      "$",
      issues,
    );
    apiVersionField(value, "$.apiVersion", issues);
    stringField(value, "releaseId", "$.releaseId", issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
    validateReleaseCoordinate(value.coordinate, "$.coordinate", issues);
    enumField(value, "status", "$.status", ["reserved"], issues);
    stringField(value, "createdAt", "$.createdAt", issues, { dateTime: true });
    stringField(value, "expiresAt", "$.expiresAt", issues, { dateTime: true });
  }
  return validationResult(input, issues);
}

export function validateRegistryArtifactUploadRequest(
  input: unknown,
): RegistryValidationResult<RegistryArtifactUploadRequest> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["digest", "bytes"], ["digest", "bytes"], "$", issues);
    stringField(value, "digest", "$.digest", issues, { digest: true });
    integerField(value, "bytes", "$.bytes", issues, 0);
  }
  return validationResult(input, issues);
}

export function validateRegistryArtifactUploadResponse(
  input: unknown,
): RegistryValidationResult<RegistryArtifactUploadResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(
      value,
      ["apiVersion", "releaseId", "coordinate", "digest", "bytes", "uploadUrl", "expiresAt"],
      ["apiVersion", "releaseId", "coordinate", "digest", "bytes", "uploadUrl", "expiresAt"],
      "$",
      issues,
    );
    apiVersionField(value, "$.apiVersion", issues);
    stringField(value, "releaseId", "$.releaseId", issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
    validateReleaseCoordinate(value.coordinate, "$.coordinate", issues);
    stringField(value, "digest", "$.digest", issues, { digest: true });
    integerField(value, "bytes", "$.bytes", issues, 0);
    stringField(value, "uploadUrl", "$.uploadUrl", issues, { httpsUrl: true });
    stringField(value, "expiresAt", "$.expiresAt", issues, { dateTime: true });
  }
  return validationResult(input, issues);
}

export function validateRegistryReleaseCompletionRequest(
  input: unknown,
): RegistryValidationResult<RegistryReleaseCompletionRequest> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["artifact", "declared", "files", "scan", "source"], ["artifact", "declared", "files", "scan", "source"], "$", issues);
    validateArtifactMetadata(value.artifact, "$.artifact", issues);
    validateDeclared(value.declared, "$.declared", issues);
    validateFiles(value.files, "$.files", issues);
    validateScan(value.scan, "$.scan", issues);
    validateSource(value.source, "$.source", issues);
  }
  return validationResult(input, issues);
}

export function validateRegistryReleaseCompletionResponse(
  input: unknown,
): RegistryValidationResult<RegistryReleaseCompletionResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "releaseId", "coordinate", "status", "artifact", "completedAt"], ["apiVersion", "releaseId", "coordinate", "status", "artifact", "completedAt"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    stringField(value, "releaseId", "$.releaseId", issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
    validateReleaseCoordinate(value.coordinate, "$.coordinate", issues);
    enumField(value, "status", "$.status", ["scanning"], issues);
    validateArtifactMetadata(value.artifact, "$.artifact", issues);
    stringField(value, "completedAt", "$.completedAt", issues, { dateTime: true });
  }
  return validationResult(input, issues);
}

export function validateRegistryReleaseCoordinate(input: unknown): RegistryValidationResult<RegistryReleaseCoordinate> {
  const issues: RegistryValidationIssue[] = [];
  validateReleaseCoordinate(input, "$", issues);
  return validationResult(input, issues);
}

export function validateRegistryReleaseLookupResponse(
  input: unknown,
): RegistryValidationResult<RegistryReleaseLookupResponse> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "release"], ["apiVersion", "release"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    validateRelease(value.release, "$.release", issues);
  }
  return validationResult(input, issues);
}

export function validateRegistryRelease(input: unknown): RegistryValidationResult<RegistryRelease> {
  const issues: RegistryValidationIssue[] = [];
  validateRelease(input, "$", issues);
  return validationResult(input, issues);
}

export function validateRegistryApiError(input: unknown): RegistryValidationResult<RegistryApiError> {
  const issues: RegistryValidationIssue[] = [];
  const value = asRecord(input, "$", issues);
  if (value) {
    exactKeys(value, ["apiVersion", "error"], ["apiVersion", "error"], "$", issues);
    apiVersionField(value, "$.apiVersion", issues);
    const error = asRecord(value.error, "$.error", issues);
    if (error) {
      exactKeys(error, ["code", "message", "requestId", "details"], ["code", "message", "requestId"], "$.error", issues);
      stringField(error, "code", "$.error.code", issues, { minLength: 1, maxLength: 96 });
      stringField(error, "message", "$.error.message", issues, { minLength: 1, maxLength: 1024 });
      stringField(error, "requestId", "$.error.requestId", issues, { minLength: 1, maxLength: 128 });
      optionalRecordField(error, "details", "$.error.details", issues);
    }
  }
  return validationResult(input, issues);
}

export function assertRegistryRelease(input: unknown): asserts input is RegistryRelease {
  const result = validateRegistryRelease(input);
  if (!result.valid) throw new RegistryContractValidationError(result.issues);
}

export function assertRegistryReleaseLookupResponse(input: unknown): asserts input is RegistryReleaseLookupResponse {
  const result = validateRegistryReleaseLookupResponse(input);
  if (!result.valid) throw new RegistryContractValidationError(result.issues);
}

function validatePublisherIdentity(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["provider", "subject", "login"], ["provider", "subject"], path, issues);
  enumField(value, "provider", `${path}.provider`, ["github"], issues);
  stringField(value, "subject", `${path}.subject`, issues, { minLength: 1, maxLength: 256, noControlCharacters: true });
  optionalStringField(value, "login", `${path}.login`, issues, { minLength: 1, maxLength: 64, noControlCharacters: true });
}

function validateAuthSession(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["accessToken", "tokenType", "expiresAt", "identity", "scopes"], ["accessToken", "tokenType", "expiresAt", "identity", "scopes"], path, issues);
  stringField(value, "accessToken", `${path}.accessToken`, issues, { minLength: 1, maxLength: 16384, noControlCharacters: true });
  enumField(value, "tokenType", `${path}.tokenType`, ["bearer"], issues);
  stringField(value, "expiresAt", `${path}.expiresAt`, issues, { dateTime: true });
  validatePublisherIdentity(value.identity, `${path}.identity`, issues);
  enumStringArrayField(value, "scopes", `${path}.scopes`, ["publisher:read", "publisher:write"] satisfies readonly RegistrySessionScope[], issues);
}

function validateAuthSessionMetadata(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["expiresAt", "scopes"], ["expiresAt", "scopes"], path, issues);
  stringField(value, "expiresAt", `${path}.expiresAt`, issues, { dateTime: true });
  enumStringArrayField(value, "scopes", `${path}.scopes`, ["publisher:read", "publisher:write"] satisfies readonly RegistrySessionScope[], issues);
}

function validatePublisherNamespace(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["namespace", "packages"], ["namespace", "packages"], path, issues);
  stringField(value, "namespace", `${path}.namespace`, issues, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxLength: 64 });
  if (!Array.isArray(value.packages)) {
    issue(issues, `${path}.packages`, "TYPE_INVALID", "Expected an array.");
    return;
  }
  if (value.packages.length > 1_000) issue(issues, `${path}.packages`, "ARRAY_TOO_LARGE", "Expected at most 1000 packages.");
  const seen = new Set<string>();
  value.packages.forEach((item, index) => {
    validatePublisherPackage(item, `${path}.packages[${index}]`, issues);
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const coordinate = (item as Record<string, unknown>).package;
      if (typeof coordinate === "object" && coordinate !== null && !Array.isArray(coordinate)) {
        const name = (coordinate as Record<string, unknown>).name;
        if (typeof name === "string") {
          if (seen.has(name)) issue(issues, `${path}.packages[${index}].package.name`, "DUPLICATE_VALUE", "Package names must be unique within a namespace.");
          seen.add(name);
        }
      }
    }
  });
}

function validatePublisherPackage(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["package", "latestVersion", "releases"], ["package", "releases"], path, issues);
  validatePackageCoordinate(value.package, `${path}.package`, issues);
  optionalStringField(value, "latestVersion", `${path}.latestVersion`, issues, { semver: true });
  if (!Array.isArray(value.releases)) {
    issue(issues, `${path}.releases`, "TYPE_INVALID", "Expected an array.");
    return;
  }
  if (value.releases.length > 10_000) issue(issues, `${path}.releases`, "ARRAY_TOO_LARGE", "Expected at most 10000 releases.");
  const seen = new Set<string>();
  value.releases.forEach((release, index) => {
    validatePublisherRelease(release, `${path}.releases[${index}]`, issues);
    if (typeof release === "object" && release !== null && !Array.isArray(release)) {
      const version = (release as Record<string, unknown>).version;
      if (typeof version === "string") {
        if (seen.has(version)) issue(issues, `${path}.releases[${index}].version`, "DUPLICATE_VALUE", "Release versions must be unique.");
        seen.add(version);
      }
    }
  });
}

function validatePublisherRelease(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(
    value,
    ["releaseId", "version", "status", "createdAt", "expiresAt", "digest", "completedAt", "publishedAt"],
    ["releaseId", "version", "status", "createdAt", "expiresAt"],
    path,
    issues,
  );
  stringField(value, "releaseId", `${path}.releaseId`, issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
  stringField(value, "version", `${path}.version`, issues, { semver: true });
  enumField(value, "status", `${path}.status`, ["reserved", "expired", "uploading", "uploaded", "scanning", "active", "deprecated", "quarantined", "rejected"], issues);
  stringField(value, "createdAt", `${path}.createdAt`, issues, { dateTime: true });
  stringField(value, "expiresAt", `${path}.expiresAt`, issues, { dateTime: true });
  optionalStringField(value, "digest", `${path}.digest`, issues, { digest: true });
  optionalStringField(value, "completedAt", `${path}.completedAt`, issues, { dateTime: true });
  optionalStringField(value, "publishedAt", `${path}.publishedAt`, issues, { dateTime: true });
}

function validateReportTarget(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["package", "releaseVersion"], ["package"], path, issues);
  validatePackageCoordinate(value.package, `${path}.package`, issues);
  optionalStringField(value, "releaseVersion", `${path}.releaseVersion`, issues, { semver: true });
}

function validateModerationAuditEvent(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["eventId", "action", "actor", "target", "occurredAt", "requestId", "metadata"], ["eventId", "action", "actor", "target", "occurredAt", "requestId", "metadata"], path, issues);
  stringField(value, "eventId", `${path}.eventId`, issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
  enumField(value, "action", `${path}.action`, [
    "report_created", "report_triaged", "report_resolved", "report_dismissed",
    "release_deprecated", "release_quarantined", "release_unquarantined",
    "digest_denylisted", "digest_denylist_removed",
  ], issues);
  validateModerationActor(value.actor, `${path}.actor`, issues);
  validateModerationAuditTarget(value.target, `${path}.target`, issues);
  stringField(value, "occurredAt", `${path}.occurredAt`, issues, { dateTime: true });
  stringField(value, "requestId", `${path}.requestId`, issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
  validateAuditMetadata(value.metadata, `${path}.metadata`, issues);
}

function validateModerationActor(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["kind", "identity"], ["kind"], path, issues);
  enumField(value, "kind", `${path}.kind`, ["publisher", "maintainer", "system"], issues);
  if (value.kind === "system") {
    if (Object.hasOwn(value, "identity")) issue(issues, `${path}.identity`, "UNKNOWN_FIELD", "System actors must not include an identity.");
  } else if (!Object.hasOwn(value, "identity")) {
    issue(issues, `${path}.identity`, "REQUIRED", "Authenticated actors must include an identity.");
  } else {
    validatePublisherIdentity(value.identity, `${path}.identity`, issues);
  }
}

function validateModerationAuditTarget(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  if (value.type === "report") {
    exactKeys(value, ["type", "reportId"], ["type", "reportId"], path, issues);
    stringField(value, "reportId", `${path}.reportId`, issues, { minLength: 1, maxLength: 128, noControlCharacters: true });
    return;
  }
  if (value.type === "package") {
    exactKeys(value, ["type", "package"], ["type", "package"], path, issues);
    validatePackageCoordinate(value.package, `${path}.package`, issues);
    return;
  }
  if (value.type === "release") {
    exactKeys(value, ["type", "release"], ["type", "release"], path, issues);
    validateReleaseCoordinate(value.release, `${path}.release`, issues);
    return;
  }
  if (value.type === "artifact") {
    exactKeys(value, ["type", "digest"], ["type", "digest"], path, issues);
    stringField(value, "digest", `${path}.digest`, issues, { digest: true });
    return;
  }
  enumField(value, "type", `${path}.type`, ["report", "package", "release", "artifact"], issues);
}

function validateAuditMetadata(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    issue(issues, path, "TYPE_INVALID", "Expected an object.");
    return;
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 32) issue(issues, path, "OBJECT_TOO_LARGE", "Expected at most 32 metadata fields.");
  for (const [key, value] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) issue(issues, `${path}.${key}`, "KEY_INVALID", "Metadata keys must be bounded ASCII names.");
    if (typeof value !== "string" || value.length < 1 || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
      issue(issues, `${path}.${key}`, "VALUE_INVALID", "Metadata values must be bounded strings without control characters.");
    }
  }
}

function validateRelease(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(
    value,
    ["apiVersion", "coordinate", "status", "declared", "artifact", "files", "scan", "source", "publishedAt"],
    ["apiVersion", "coordinate", "status", "declared", "artifact", "files", "scan", "source", "publishedAt"],
    path,
    issues,
  );
  apiVersionField(value, `${path}.apiVersion`, issues);
  validateReleaseCoordinate(value.coordinate, `${path}.coordinate`, issues);
  optionalEnumField(value, "status", `${path}.status`, ["active", "deprecated"], issues);
  validateDeclared(value.declared, `${path}.declared`, issues);
  validateArtifact(value.artifact, `${path}.artifact`, issues);
  validateFiles(value.files, `${path}.files`, issues);
  validateScan(value.scan, `${path}.scan`, issues);
  validateSource(value.source, `${path}.source`, issues);
  stringField(value, "publishedAt", `${path}.publishedAt`, issues, { dateTime: true });
}

function validatePackageSummary(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["apiVersion", "package", "description", "latestVersion", "compatibility", "tags", "hasScripts", "status"], ["apiVersion", "package", "description", "compatibility", "tags", "hasScripts", "status"], path, issues);
  apiVersionField(value, `${path}.apiVersion`, issues);
  validatePackageCoordinate(value.package, `${path}.package`, issues);
  stringField(value, "description", `${path}.description`, issues, { minLength: 1, maxLength: 1024 });
  optionalStringField(value, "latestVersion", `${path}.latestVersion`, issues, { semver: true });
  validateCompatibility(value.compatibility, `${path}.compatibility`, issues);
  validateTags(value.tags, `${path}.tags`, issues);
  booleanField(value, "hasScripts", `${path}.hasScripts`, issues);
  optionalEnumField(value, "status", `${path}.status`, ["active", "deprecated"], issues);
}

function validatePackageCoordinate(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["namespace", "name"], ["namespace", "name"], path, issues);
  stringField(value, "namespace", `${path}.namespace`, issues, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxLength: 64 });
  stringField(value, "name", `${path}.name`, issues, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxLength: 64 });
}

function validateReleaseCoordinate(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["namespace", "name", "version"], ["namespace", "name", "version"], path, issues);
  stringField(value, "namespace", `${path}.namespace`, issues, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxLength: 64 });
  stringField(value, "name", `${path}.name`, issues, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxLength: 64 });
  stringField(value, "version", `${path}.version`, issues, { semver: true });
}

function validateDeclared(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["description", "license", "repositoryUrl", "tags", "compatibility", "capabilities", "dependencies"], ["description", "tags", "compatibility"], path, issues);
  stringField(value, "description", `${path}.description`, issues, { minLength: 1, maxLength: 1024 });
  optionalStringField(value, "license", `${path}.license`, issues, { minLength: 1, maxLength: 128 });
  optionalStringField(value, "repositoryUrl", `${path}.repositoryUrl`, issues, { httpsUrl: true });
  validateTags(value.tags, `${path}.tags`, issues);
  validateCompatibility(value.compatibility, `${path}.compatibility`, issues);
  optionalRecordField(value, "capabilities", `${path}.capabilities`, issues);
  optionalStringArrayField(value, "dependencies", `${path}.dependencies`, issues, {
    maxItems: 64,
    itemMaxLength: 128,
  });
}

function validateCompatibility(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  for (const [host, declaration] of Object.entries(value)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(host)) issue(issues, `${path}.${host}`, "HOST_INVALID", "Host identifiers must use lowercase letters, numbers, and single hyphens.");
    const entry = asRecord(declaration, `${path}.${host}`, issues);
    if (!entry) continue;
    exactKeys(entry, ["scopes"], ["scopes"], `${path}.${host}`, issues);
    const scopes = entry.scopes;
    if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some((scope) => scope !== "project" && scope !== "user") || new Set(scopes).size !== scopes.length) {
      issue(issues, `${path}.${host}.scopes`, "SCOPES_INVALID", "Scopes must be a non-empty unique array containing project or user.");
    }
  }
}

function validateArtifact(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["format", "mediaType", "digest", "bytes", "download"], ["format", "mediaType", "digest", "bytes", "download"], path, issues);
  validateArtifactMetadata(value, path, issues, true);
  const download = asRecord(value.download, `${path}.download`, issues);
  if (download) {
    exactKeys(download, ["url", "expiresAt"], ["url", "expiresAt"], `${path}.download`, issues);
    stringField(download, "url", `${path}.download.url`, issues, { httpsUrl: true });
    stringField(download, "expiresAt", `${path}.download.expiresAt`, issues, { dateTime: true });
  }
}

function validateArtifactMetadata(input: unknown, path: string, issues: RegistryValidationIssue[], allowDownload = false): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  const allowed = allowDownload ? ["format", "mediaType", "digest", "bytes", "download"] : ["format", "mediaType", "digest", "bytes"];
  exactKeys(value, allowed, ["format", "mediaType", "digest", "bytes"], path, issues);
  enumField(value, "format", `${path}.format`, [AGENTCARGO_ARTIFACT_FORMAT], issues);
  enumField(value, "mediaType", `${path}.mediaType`, [AGENTCARGO_ARTIFACT_MEDIA_TYPE], issues);
  stringField(value, "digest", `${path}.digest`, issues, { digest: true });
  integerField(value, "bytes", `${path}.bytes`, issues, 0);
}

function validateFiles(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  if (!Array.isArray(input)) {
    issue(issues, path, "TYPE_INVALID", "Expected an array.");
    return;
  }
  const paths = new Set<string>();
  input.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const value = asRecord(item, itemPath, issues);
    if (!value) return;
    exactKeys(value, ["path", "bytes", "executable", "scriptLike"], ["path", "bytes", "executable", "scriptLike"], itemPath, issues);
    stringField(value, "path", `${itemPath}.path`, issues, { relativePath: true });
    if (typeof value.path === "string") {
      if (paths.has(value.path)) issue(issues, `${itemPath}.path`, "DUPLICATE_PATH", "File paths must be unique.");
      paths.add(value.path);
    }
    integerField(value, "bytes", `${itemPath}.bytes`, issues, 0);
    booleanField(value, "executable", `${itemPath}.executable`, issues);
    booleanField(value, "scriptLike", `${itemPath}.scriptLike`, issues);
  });
}

function validateScan(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["scannerVersion", "completedAt", "findings"], ["scannerVersion", "completedAt", "findings"], path, issues);
  stringField(value, "scannerVersion", `${path}.scannerVersion`, issues, { minLength: 1, maxLength: 64 });
  stringField(value, "completedAt", `${path}.completedAt`, issues, { dateTime: true });
  if (!Array.isArray(value.findings)) {
    issue(issues, `${path}.findings`, "TYPE_INVALID", "Expected an array.");
  } else {
    value.findings.forEach((finding, index) => validateFinding(finding, `${path}.findings[${index}]`, issues));
  }
}

function validateFinding(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["ruleId", "ruleVersion", "severity", "path", "evidence", "message", "explanation", "remediation"], ["ruleId", "ruleVersion", "severity", "message", "explanation", "remediation"], path, issues);
  stringField(value, "ruleId", `${path}.ruleId`, issues, { minLength: 1, maxLength: 128 });
  stringField(value, "ruleVersion", `${path}.ruleVersion`, issues, { minLength: 1, maxLength: 64 });
  optionalEnumField(value, "severity", `${path}.severity`, ["info", "warning", "error"], issues);
  optionalStringField(value, "path", `${path}.path`, issues, { relativePath: true });
  optionalStringField(value, "evidence", `${path}.evidence`, issues, { maxLength: 2048 });
  stringField(value, "message", `${path}.message`, issues, { minLength: 1, maxLength: 1024 });
  stringField(value, "explanation", `${path}.explanation`, issues, { minLength: 1, maxLength: 2048 });
  stringField(value, "remediation", `${path}.remediation`, issues, { minLength: 1, maxLength: 2048 });
}

function validateSource(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["repositoryUrl", "commit"], [], path, issues);
  optionalStringField(value, "repositoryUrl", `${path}.repositoryUrl`, issues, { httpsUrl: true });
  optionalStringField(value, "commit", `${path}.commit`, issues, { minLength: 1, maxLength: 128 });
}

function validateTags(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  if (!Array.isArray(input)) {
    issue(issues, path, "TYPE_INVALID", "Expected an array.");
    return;
  }
  const tags = new Set<string>();
  input.forEach((tag, index) => {
    if (typeof tag !== "string" || tag.length < 1 || tag.length > 64) issue(issues, `${path}[${index}]`, "TAG_INVALID", "Tags must be non-empty strings up to 64 characters.");
    if (typeof tag === "string") {
      if (tags.has(tag)) issue(issues, `${path}[${index}]`, "DUPLICATE_TAG", "Tags must be unique.");
      tags.add(tag);
    }
  });
}

function validateStatusComponent(input: unknown, path: string, issues: RegistryValidationIssue[], additionalKeys: readonly string[] = []): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["status", "checkedAt", "detail", ...additionalKeys], ["status", "checkedAt"], path, issues);
  enumField(value, "status", `${path}.status`, ["operational", "degraded", "unavailable", "not_configured"], issues);
  stringField(value, "checkedAt", `${path}.checkedAt`, issues, { dateTime: true });
  optionalStringField(value, "detail", `${path}.detail`, issues, { minLength: 1, maxLength: 256, noControlCharacters: true });
}

function validateStatusWorkerComponent(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(
    value,
    ["status", "checkedAt", "detail", "ready", "reason", "totalRuns", "claimedJobs", "consecutiveFailures", "lastRunAgeMs", "queue"],
    ["status", "checkedAt", "ready", "reason", "totalRuns", "claimedJobs", "consecutiveFailures", "lastRunAgeMs", "queue"],
    path,
    issues,
  );
  validateStatusComponent(value, path, issues, ["ready", "reason", "totalRuns", "claimedJobs", "consecutiveFailures", "lastRunAgeMs", "queue"]);
  booleanField(value, "ready", `${path}.ready`, issues);
  stringField(value, "reason", `${path}.reason`, issues, { minLength: 1, maxLength: 64, noControlCharacters: true });
  integerField(value, "totalRuns", `${path}.totalRuns`, issues, 0);
  integerField(value, "claimedJobs", `${path}.claimedJobs`, issues, 0);
  integerField(value, "consecutiveFailures", `${path}.consecutiveFailures`, issues, 0);
  if (value.lastRunAgeMs !== null) integerField(value, "lastRunAgeMs", `${path}.lastRunAgeMs`, issues, 0);
  if (value.queue !== null) validateStatusQueue(value.queue, `${path}.queue`, issues);
}

function validateStatusModerationComponent(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["status", "checkedAt", "detail", "activeDenylistEntries"], ["status", "checkedAt", "activeDenylistEntries"], path, issues);
  validateStatusComponent(value, path, issues, ["activeDenylistEntries"]);
  if (value.activeDenylistEntries !== null) integerField(value, "activeDenylistEntries", `${path}.activeDenylistEntries`, issues, 0);
}

function validateStatusQueue(input: unknown, path: string, issues: RegistryValidationIssue[]): void {
  const value = asRecord(input, path, issues);
  if (!value) return;
  exactKeys(value, ["queued", "failed", "running", "staleLeases", "oldestAvailableAt", "lagMs"], ["queued", "failed", "running", "staleLeases", "oldestAvailableAt", "lagMs"], path, issues);
  integerField(value, "queued", `${path}.queued`, issues, 0);
  integerField(value, "failed", `${path}.failed`, issues, 0);
  integerField(value, "running", `${path}.running`, issues, 0);
  integerField(value, "staleLeases", `${path}.staleLeases`, issues, 0);
  if (value.oldestAvailableAt !== null) stringField(value, "oldestAvailableAt", `${path}.oldestAvailableAt`, issues, { dateTime: true });
  integerField(value, "lagMs", `${path}.lagMs`, issues, 0);
}

function asRecord(input: unknown, path: string, issues: RegistryValidationIssue[]): Record<string, unknown> | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    issue(issues, path, "TYPE_INVALID", "Expected an object.");
    return undefined;
  }
  return input as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[], path: string, issues: RegistryValidationIssue[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issue(issues, `${path}.${key}`, "UNKNOWN_FIELD", "Field is not part of the registry contract.");
  for (const key of required) if (!(key in value)) issue(issues, `${path}.${key}`, "REQUIRED_FIELD", "Field is required.");
}

function apiVersionField(value: Record<string, unknown>, path: string, issues: RegistryValidationIssue[]): void {
  if (value[path.slice(path.lastIndexOf(".") + 1)] !== REGISTRY_API_VERSION) issue(issues, path, "API_VERSION_INVALID", `Expected ${REGISTRY_API_VERSION}.`);
}

function stringField(value: Record<string, unknown>, key: string, path: string, issues: RegistryValidationIssue[], options: StringOptions = {}): void {
  const input = value[key];
  if (typeof input !== "string") {
    issue(issues, path, "TYPE_INVALID", "Expected a string.");
    return;
  }
  validateString(input, path, issues, options);
}

function optionalStringField(value: Record<string, unknown>, key: string, path: string, issues: RegistryValidationIssue[], options: StringOptions = {}): void {
  if (key in value) stringField(value, key, path, issues, options);
}

function optionalStringArrayField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: RegistryValidationIssue[],
  options: { maxItems: number; itemMaxLength: number },
): void {
  if (!(key in value)) return;
  const input = value[key];
  if (!Array.isArray(input)) {
    issue(issues, path, "TYPE_INVALID", "Expected an array.");
    return;
  }
  if (input.length > options.maxItems) issue(issues, path, "ARRAY_TOO_LARGE", `Expected at most ${options.maxItems} items.`);
  const seen = new Set<string>();
  input.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== "string") {
      issue(issues, itemPath, "TYPE_INVALID", "Expected a string.");
      return;
    }
    if (item.length < 1 || item.length > options.itemMaxLength) issue(issues, itemPath, "STRING_LENGTH_INVALID", `Expected a string from 1 to ${options.itemMaxLength} characters.`);
    if (/[\u0000-\u001f\u007f]/.test(item)) issue(issues, itemPath, "CONTROL_CHARACTER_INVALID", "Control characters are not allowed.");
    if (seen.has(item)) issue(issues, itemPath, "DUPLICATE_VALUE", "Values must be unique.");
    seen.add(item);
  });
}

function enumStringArrayField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly string[],
  issues: RegistryValidationIssue[],
): void {
  const input = value[key];
  if (!Array.isArray(input) || input.length === 0) {
    issue(issues, path, "SCOPES_INVALID", "Expected a non-empty array of supported unique scopes.");
    return;
  }
  const seen = new Set<string>();
  input.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== "string" || !allowed.includes(item)) {
      issue(issues, itemPath, "SCOPE_INVALID", `Expected one of: ${allowed.join(", ")}.`);
      return;
    }
    if (seen.has(item)) issue(issues, itemPath, "DUPLICATE_SCOPE", "Scopes must be unique.");
    seen.add(item);
  });
}

function optionalEnumStringArrayField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly string[],
  issues: RegistryValidationIssue[],
): void {
  if (key in value) enumStringArrayField(value, key, path, allowed, issues);
}

function validateString(input: string, path: string, issues: RegistryValidationIssue[], options: StringOptions): void {
  if (options.minLength !== undefined && input.length < options.minLength) issue(issues, path, "STRING_TOO_SHORT", `Expected at least ${options.minLength} characters.`);
  if (options.maxLength !== undefined && input.length > options.maxLength) issue(issues, path, "STRING_TOO_LONG", `Expected at most ${options.maxLength} characters.`);
  if (options.pattern && !options.pattern.test(input)) issue(issues, path, "STRING_PATTERN_INVALID", "String does not match the required pattern.");
  if (options.semver && !SEMVER_PATTERN.test(input)) issue(issues, path, "SEMVER_INVALID", "Expected a semantic version.");
  if (options.digest && !/^sha256:[a-f0-9]{64}$/.test(input)) issue(issues, path, "DIGEST_INVALID", "Expected sha256:<64 lowercase hexadecimal characters>.");
  if (options.relativePath && (!input || input.startsWith("/") || input.includes("\\") || input.split("/").includes(".."))) issue(issues, path, "PATH_INVALID", "Expected a non-empty normalized relative path.");
  if (options.httpsUrl && !isHttpsUrl(input)) issue(issues, path, "URL_INVALID", "Expected an HTTPS URL.");
  if (options.dateTime && !Number.isFinite(Date.parse(input))) issue(issues, path, "DATETIME_INVALID", "Expected an RFC 3339 date-time.");
  if (options.noControlCharacters && /[\u0000-\u001f\u007f]/.test(input)) issue(issues, path, "CONTROL_CHARACTER_INVALID", "Control characters are not allowed.");
}

function optionalEnumField(value: Record<string, unknown>, key: string, path: string, allowed: readonly string[], issues: RegistryValidationIssue[]): void {
  if (key in value) enumField(value, key, path, allowed, issues);
}

function enumField(value: Record<string, unknown>, key: string, path: string, allowed: readonly string[], issues: RegistryValidationIssue[]): void {
  if (typeof value[key] !== "string" || !allowed.includes(value[key])) issue(issues, path, "ENUM_INVALID", `Expected one of: ${allowed.join(", ")}.`);
}

function booleanField(value: Record<string, unknown>, key: string, path: string, issues: RegistryValidationIssue[]): void {
  if (typeof value[key] !== "boolean") issue(issues, path, "TYPE_INVALID", "Expected a boolean.");
}

function optionalRecordField(value: Record<string, unknown>, key: string, path: string, issues: RegistryValidationIssue[]): void {
  if (key in value) asRecord(value[key], path, issues);
}

function integerField(value: Record<string, unknown>, key: string, path: string, issues: RegistryValidationIssue[], minimum: number): void {
  const input = value[key];
  if (typeof input !== "number" || !Number.isInteger(input) || input < minimum) issue(issues, path, "INTEGER_INVALID", `Expected an integer greater than or equal to ${minimum}.`);
}

function optionalIntegerField(value: Record<string, unknown>, key: string, path: string, issues: RegistryValidationIssue[], minimum: number, maximum: number): void {
  if (!(key in value)) return;
  integerField(value, key, path, issues, minimum);
  if (typeof value[key] === "number" && value[key] > maximum) issue(issues, path, "INTEGER_TOO_LARGE", `Expected an integer less than or equal to ${maximum}.`);
}

interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  semver?: boolean;
  digest?: boolean;
  relativePath?: boolean;
  httpsUrl?: boolean;
  dateTime?: boolean;
  noControlCharacters?: boolean;
}

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validationResult<T>(value: unknown, issues: RegistryValidationIssue[]): RegistryValidationResult<T> {
  return issues.length === 0 ? { valid: true, value: value as T, issues: [] } : { valid: false, issues };
}

function issue(issues: RegistryValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}
