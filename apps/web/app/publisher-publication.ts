import type { ChatGPTUser } from "./chatgpt-auth";
import {
  issueBrowserReadSession,
  issueServerWriteSession,
  type RegistryReadSessionResult,
  type RegistrySessionBridgeConfig,
  type RegistryWriteSessionExchange,
  type RegistryWriteSessionResult,
} from "./registry-session.ts";
import { parsePublisherWorkspace, type PublisherWorkspace } from "./publisher-workspace.ts";
import type {
  RegistryPublisherReservationRequest,
  RegistryPublisherReservationResolver,
} from "./registry-session-config";

const PACKAGE_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+)?(?:\+[0-9A-Za-z-]+)?$/;
const MAX_BODY_BYTES = 8 * 1024;

export type PublisherPublicationIntentInput = Omit<RegistryPublisherReservationRequest, "namespace">;

export type PublisherPublicationResult = {
  status: number;
  body: Record<string, unknown>;
};

export interface PublisherPublicationDependencies {
  readBridge: RegistrySessionBridgeConfig | null;
  resolveWorkspace: ((accessToken: string) => Promise<unknown>) | null;
  writeSessionExchange: RegistryWriteSessionExchange | null;
  reserve: RegistryPublisherReservationResolver | null;
}

/**
 * Handles a browser publication intent without accepting package files or a
 * namespace selector. Namespace ownership is resolved from the read-scoped
 * workspace, then a write-only session is used once for the reservation.
 */
export async function handlePublisherPublicationIntent(
  request: Request,
  user: ChatGPTUser | null,
  dependencies: PublisherPublicationDependencies,
): Promise<PublisherPublicationResult> {
  if (!user) return errorResult(401, "REGISTRY_AUTH_REQUIRED", "Sign in before starting a publication.");
  const input = await readIntentInput(request);
  if (!input) return errorResult(400, "REGISTRY_REQUEST_INVALID", "The publication intent is invalid.");

  const read = await issueBrowserReadSession(request, user, dependencies.readBridge);
  if (read.state !== "issued") return mapSessionFailure(read);
  if (!dependencies.resolveWorkspace) return errorResult(501, "REGISTRY_PUBLISHING_NOT_CONFIGURED", "Publisher workspace access is not configured.");

  let workspaceValue: unknown;
  try {
    workspaceValue = await dependencies.resolveWorkspace(read.session.accessToken);
  } catch {
    return errorResult(503, "REGISTRY_AUTH_UNAVAILABLE", "Publisher workspace access is temporarily unavailable.");
  }
  const workspace = parsePublisherWorkspace(workspaceValue);
  if (!workspace) return errorResult(503, "REGISTRY_RESPONSE_INVALID", "Publisher workspace metadata was invalid.");
  const namespace = resolveOwnedNamespace(workspace, input.name);
  if (!namespace.ok) return errorResult(namespace.status, namespace.code, namespace.message);

  const write = await issueServerWriteSession(request, user, dependencies.readBridge && dependencies.writeSessionExchange
    ? { resolveProviderCredential: dependencies.readBridge.resolveProviderCredential, exchange: dependencies.writeSessionExchange }
    : null);
  if (write.state !== "issued") return mapSessionFailure(write);
  if (!dependencies.reserve) return errorResult(501, "REGISTRY_PUBLISHING_NOT_CONFIGURED", "Publisher release reservation is not configured.");

  const reservationInput = { namespace: namespace.value, ...input } satisfies RegistryPublisherReservationRequest;
  let remote: { status: number; body: unknown | null };
  try {
    remote = await dependencies.reserve(write.session.accessToken, reservationInput);
  } catch {
    return errorResult(503, "REGISTRY_UNAVAILABLE", "Publisher release reservation is temporarily unavailable.");
  }
  if (remote.status !== 200 && remote.status !== 201) return mapReservationFailure(remote.status);
  const reservation = parseReservation(remote.body, reservationInput);
  if (!reservation) return errorResult(502, "REGISTRY_RESPONSE_INVALID", "The registry returned invalid reservation metadata.");

  return {
    status: remote.status,
    body: {
      apiVersion: "local",
      state: "reserved",
      replayed: remote.status === 200,
      releaseId: reservation.releaseId,
      coordinate: reservation.coordinate,
      status: reservation.status,
      createdAt: reservation.createdAt,
      expiresAt: reservation.expiresAt,
      next: "Continue artifact upload, scanning, and activation through the authenticated CLI publication flow.",
    },
  };
}

export function resolveOwnedNamespace(
  workspace: PublisherWorkspace,
  packageName: string,
): { ok: true; value: string } | { ok: false; status: number; code: string; message: string } {
  const matching = workspace.namespaces.filter((namespace) => namespace.packages.some((item) => item.package.name === packageName));
  if (matching.length > 1) {
    return { ok: false, status: 409, code: "REGISTRY_NAMESPACE_SELECTION_REQUIRED", message: "This package name exists in more than one owned namespace; use the authenticated CLI flow." };
  }
  if (matching.length === 1) return { ok: true, value: matching[0]!.namespace };
  if (workspace.namespaces.length === 1) return { ok: true, value: workspace.namespaces[0]!.namespace };
  if (workspace.namespaces.length === 0) {
    return { ok: false, status: 409, code: "REGISTRY_NAMESPACE_NOT_AVAILABLE", message: "No publisher namespace is available for this session." };
  }
  return { ok: false, status: 409, code: "REGISTRY_NAMESPACE_SELECTION_REQUIRED", message: "A unique owned namespace could not be derived; use the authenticated CLI flow." };
}

async function readIntentInput(request: Request): Promise<PublisherPublicationIntentInput | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) return null;
  const contentType = request.headers.get("content-type");
  if (contentType !== null && !/^application\/json(?:\s*;|$)/i.test(contentType)) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isExactRecord(value, ["name", "version", "idempotencyKey"])) return null;
  if (!isPackagePart(value.name) || !SEMVER.test(value.version) || !isSafeIdempotencyKey(value.idempotencyKey)) return null;
  return { name: value.name, version: value.version, idempotencyKey: value.idempotencyKey };
}

function parseReservation(value: unknown, input: RegistryPublisherReservationRequest): {
  releaseId: string;
  coordinate: { namespace: string; name: string; version: string };
  status: "reserved";
  createdAt: string;
  expiresAt: string;
} | null {
  if (!isExactRecord(value, ["apiVersion", "releaseId", "coordinate", "status", "createdAt", "expiresAt"]) || value.apiVersion !== "v1") return null;
  if (!isSafeText(value.releaseId, 128) || value.status !== "reserved" || !isDateTime(value.createdAt) || !isDateTime(value.expiresAt)) return null;
  if (!isExactRecord(value.coordinate, ["namespace", "name", "version"]) || value.coordinate.namespace !== input.namespace || value.coordinate.name !== input.name || value.coordinate.version !== input.version) return null;
  return {
    releaseId: value.releaseId,
    coordinate: { namespace: value.coordinate.namespace, name: value.coordinate.name, version: value.coordinate.version },
    status: "reserved",
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  };
}

function mapSessionFailure(result: RegistryReadSessionResult | RegistryWriteSessionResult): PublisherPublicationResult {
  if (result.state === "unconfigured") return errorResult(501, "REGISTRY_AUTH_NOT_CONFIGURED", "The server-side registry session bridge is not configured.");
  if (result.state === "missing-provider-credential") return errorResult(401, "REGISTRY_AUTH_REQUIRED", "A server-side provider credential is required.");
  return errorResult(503, "REGISTRY_AUTH_UNAVAILABLE", "The registry session exchange is temporarily unavailable.");
}

function mapReservationFailure(status: number): PublisherPublicationResult {
  if (status === 401) return errorResult(401, "REGISTRY_AUTH_REQUIRED", "The publisher session was rejected.");
  if (status === 403) return errorResult(403, "REGISTRY_SCOPE_FORBIDDEN", "The publisher session is not authorized for this mutation.");
  if (status === 409) return errorResult(409, "REGISTRY_RELEASE_CONFLICT", "The release coordinate or idempotency key conflicts with an existing reservation.");
  if (status === 429) return errorResult(429, "REGISTRY_RATE_LIMITED", "Too many publication attempts; retry later.");
  if (status === 501) return errorResult(501, "REGISTRY_PUBLISHING_NOT_CONFIGURED", "Authenticated publishing is not configured on the registry.");
  return errorResult(status >= 500 ? 503 : 400, status >= 500 ? "REGISTRY_UNAVAILABLE" : "REGISTRY_REQUEST_INVALID", "The publication intent could not be accepted.");
}

function errorResult(status: number, code: string, message: string): PublisherPublicationResult {
  return { status, body: { apiVersion: "local", error: { code, message } } };
}

function isPackagePart(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 64 && PACKAGE_PART.test(value);
}

function isSafeIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && !hasControlCharacter(value);
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maxLength && !hasControlCharacter(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
