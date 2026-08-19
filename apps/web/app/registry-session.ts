import type { ChatGPTUser } from "./chatgpt-auth";

export const PUBLISHER_READ_SCOPE = "publisher:read" as const;
export const REGISTRY_SESSION_STATUS_PATH = "/api/registry-session" as const;
export const REGISTRY_SESSION_COOKIE_NAME = "agentcargo_session" as const;

export type BrowserRegistrySessionState = "not-issued";

export type BrowserRegistrySessionSummary = {
  workspaceIdentity: ChatGPTUser | null;
  state: BrowserRegistrySessionState;
  plannedScopes: readonly [typeof PUBLISHER_READ_SCOPE];
  writesAvailable: false;
};

export type BrowserRegistrySessionStatus = {
  apiVersion: "local";
  state: "anonymous" | "identity-only";
  workspaceIdentity: boolean;
  registrySession: BrowserRegistrySessionInspection["state"];
  registrySessionExpiresAt: string | null;
  plannedScopes: readonly [typeof PUBLISHER_READ_SCOPE];
  writesAvailable: false;
};

export type RegistryReadSession = {
  accessToken: string;
  tokenType: "bearer";
  expiresAt: string;
  scopes: readonly [typeof PUBLISHER_READ_SCOPE];
};

export type RegistryReadSessionMetadata = Pick<RegistryReadSession, "expiresAt" | "scopes">;

export type RegistryProviderCredentialResolver = (input: {
  request: Request;
  workspaceIdentity: ChatGPTUser;
}) => Promise<string | null>;

export type RegistryReadSessionExchange = (
  providerToken: string,
  options: { scopes: readonly [typeof PUBLISHER_READ_SCOPE] },
) => Promise<RegistryReadSession | null>;

export type RegistryReadSessionResolver = (input: {
  request: Request;
  accessToken: string;
}) => Promise<RegistryReadSessionMetadata | null>;

export type RegistrySessionBridgeConfig = {
  resolveProviderCredential: RegistryProviderCredentialResolver;
  exchange: RegistryReadSessionExchange;
  resolveSession?: RegistryReadSessionResolver;
};

export type RegistryReadSessionResult =
  | { state: "unconfigured" }
  | { state: "missing-provider-credential" }
  | { state: "exchange-failed" }
  | { state: "issued"; session: RegistryReadSession };

export type BrowserRegistrySessionInspection =
  | { state: "absent" }
  | { state: "active"; expiresAt: string; scopes: readonly [typeof PUBLISHER_READ_SCOPE] }
  | { state: "invalid" }
  | { state: "unconfigured" }
  | { state: "unavailable" };

/**
 * Keep the local publisher shell explicit about the missing trust boundary.
 * Workspace headers are display-only; they are never treated as a registry
 * session or converted into a publisher credential.
 */
export function describeBrowserRegistrySession(
  workspaceIdentity: ChatGPTUser | null,
): BrowserRegistrySessionSummary {
  return {
    workspaceIdentity,
    state: "not-issued",
    plannedScopes: [PUBLISHER_READ_SCOPE],
    writesAvailable: false,
  };
}

export function toBrowserRegistrySessionStatus(
  summary: BrowserRegistrySessionSummary,
  inspection: BrowserRegistrySessionInspection = { state: "absent" },
): BrowserRegistrySessionStatus {
  return {
    apiVersion: "local",
    state: summary.workspaceIdentity ? "identity-only" : "anonymous",
    workspaceIdentity: summary.workspaceIdentity !== null,
    registrySession: inspection.state,
    registrySessionExpiresAt: inspection.state === "active" ? inspection.expiresAt : null,
    plannedScopes: summary.plannedScopes,
    writesAvailable: false,
  };
}

/**
 * Compose the web boundary with a host-owned provider resolver. The resolver
 * is intentionally injected: workspace identity headers identify a viewer,
 * but they do not contain a GitHub credential and cannot authorize exchange.
 */
export async function issueBrowserReadSession(
  request: Request,
  workspaceIdentity: ChatGPTUser,
  config: RegistrySessionBridgeConfig | null,
): Promise<RegistryReadSessionResult> {
  if (!config) return { state: "unconfigured" };

  let providerToken: string | null;
  try {
    providerToken = await config.resolveProviderCredential({ request, workspaceIdentity });
  } catch {
    return { state: "missing-provider-credential" };
  }
  if (!isSafeCredential(providerToken)) return { state: "missing-provider-credential" };

  let session: RegistryReadSession | null;
  try {
    session = await config.exchange(providerToken, { scopes: [PUBLISHER_READ_SCOPE] });
  } catch {
    return { state: "exchange-failed" };
  }
  return isValidReadSession(session) ? { state: "issued", session } : { state: "exchange-failed" };
}

/**
 * Resolve an opaque browser cookie through the host-owned registry session
 * store. The cookie is never treated as proof by itself and the resolver's
 * response is reduced to read-only metadata before it crosses this boundary.
 */
export async function inspectBrowserReadSession(
  request: Request,
  config: RegistrySessionBridgeConfig | null,
): Promise<BrowserRegistrySessionInspection> {
  const accessToken = readBrowserRegistrySessionCookie(request);
  if (!accessToken) return { state: "absent" };
  if (!config?.resolveSession) return { state: "unconfigured" };

  let metadata: RegistryReadSessionMetadata | null;
  try {
    metadata = await config.resolveSession({ request, accessToken });
  } catch {
    return { state: "unavailable" };
  }
  if (!isValidReadSessionMetadata(metadata)) return { state: "invalid" };
  return { state: "active", expiresAt: metadata.expiresAt, scopes: metadata.scopes };
}

export function serializeBrowserRegistrySessionCookie(
  session: Pick<RegistryReadSession, "accessToken" | "expiresAt">,
  options: { now?: () => number; secure?: boolean } = {},
): string {
  const expiresAt = Date.parse(session.expiresAt);
  const now = options.now ?? Date.now;
  const maxAge = Math.max(1, Math.min(3600, Math.floor((expiresAt - now()) / 1000)));
  const secure = options.secure === true ? "; Secure" : "";
  return `${REGISTRY_SESSION_COOKIE_NAME}=${encodeURIComponent(session.accessToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function readBrowserRegistrySessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header || header.length > 8_192) return null;

  const matches = header.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== REGISTRY_SESSION_COOKIE_NAME) return [];
    const encoded = part.slice(separator + 1).trim();
    if (!encoded || encoded.length > 16_384) return [null];
    try {
      const decoded = decodeURIComponent(encoded);
      return [isSafeCredential(decoded) ? decoded : null];
    } catch {
      return [null];
    }
  });

  return matches.length === 1 ? matches[0] : null;
}

function isSafeCredential(value: string | null): value is string {
  return value !== null && value.length >= 8 && value.length <= 16_384 && /^[\u0021-\u007e]+$/.test(value);
}

function isValidReadSession(value: RegistryReadSession | null): value is RegistryReadSession {
  if (!value || !isSafeCredential(value.accessToken) || value.tokenType !== "bearer") return false;
  return isValidReadSessionMetadata(value);
}

function isValidReadSessionMetadata(value: RegistryReadSessionMetadata | null): value is RegistryReadSessionMetadata {
  if (!value || !Array.isArray(value.scopes) || value.scopes.length !== 1 || value.scopes[0] !== PUBLISHER_READ_SCOPE) return false;
  const expiresAt = Date.parse(value.expiresAt);
  return typeof value.expiresAt === "string" && Number.isFinite(expiresAt) && expiresAt > Date.now();
}
