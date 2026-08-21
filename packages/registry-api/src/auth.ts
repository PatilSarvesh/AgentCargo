import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { DEFAULT_REGISTRY_SESSION_SCOPES, validateRegistryPublisherIdentity } from "@agentcargo/registry-contract";
import type {
  RegistryAuthSession,
  RegistryAuthSessionMetadata,
  RegistryPublisherIdentity,
  RegistryReleaseCoordinate,
  RegistrySessionScope,
} from "@agentcargo/registry-contract";

export interface RegistryPublisherTokenVerifier {
  verify(accessToken: string): Promise<RegistryPublisherIdentity | null>;
}

export interface RegistryPublisherContext {
  identity: RegistryPublisherIdentity;
  scopes: readonly RegistrySessionScope[];
}

export interface RegistrySessionContext extends RegistryPublisherContext, RegistryAuthSessionMetadata {}

export interface RegistrySessionStore {
  issue(identity: RegistryPublisherIdentity, options?: { ttlSeconds?: number; scopes?: readonly RegistrySessionScope[] }): Promise<RegistryAuthSession>;
  resolve(accessToken: string): Promise<RegistryPublisherIdentity | null>;
  resolveContext(accessToken: string): Promise<RegistrySessionContext | null>;
  inspect(accessToken: string): Promise<RegistryAuthSessionMetadata | null>;
  revoke(accessToken: string): Promise<boolean>;
}

export interface RegistrySessionExchange {
  exchange(providerToken: string, options?: { scopes?: readonly RegistrySessionScope[] }): Promise<RegistryAuthSession | null>;
}

/**
 * A small initial session adapter for local development and tests. Only a
 * SHA-256 digest of the opaque token is retained; the bearer value is returned
 * once to the client and is never persisted in the store.
 */
export class InMemoryRegistrySessionStore implements RegistrySessionStore {
  readonly #sessions = new Map<string, { identity: RegistryPublisherIdentity; scopes: readonly RegistrySessionScope[]; expiresAt: number }>();
  readonly #now: () => number;
  readonly #ttlSeconds: number;

  constructor(options: { now?: () => number; ttlSeconds?: number } = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#ttlSeconds = boundedTtl(options.ttlSeconds ?? 900);
  }

  async issue(identity: RegistryPublisherIdentity, options: { ttlSeconds?: number; scopes?: readonly RegistrySessionScope[] } = {}): Promise<RegistryAuthSession> {
    const validation = validateRegistryPublisherIdentity(identity);
    if (!validation.valid) throw new TypeError("Cannot issue a session for an invalid publisher identity.");
    const ttlSeconds = boundedTtl(options.ttlSeconds ?? this.#ttlSeconds);
    const scopes = normalizeSessionScopes(options.scopes ?? DEFAULT_REGISTRY_SESSION_SCOPES);
    const accessToken = `acs_${randomBytes(32).toString("base64url")}`;
    const expiresAt = this.#now() + ttlSeconds * 1000;
    this.#sessions.set(hashToken(accessToken), { identity: cloneIdentity(identity), scopes, expiresAt });
    return {
      accessToken,
      tokenType: "bearer",
      expiresAt: new Date(expiresAt).toISOString(),
      identity: cloneIdentity(identity),
      scopes,
    };
  }

  async resolve(accessToken: string): Promise<RegistryPublisherIdentity | null> {
    const context = await this.resolveContext(accessToken);
    return context?.identity ?? null;
  }

  async resolveContext(accessToken: string): Promise<RegistrySessionContext | null> {
    const key = safeToken(accessToken);
    if (!key) return null;
    const entry = this.#sessions.get(hashToken(key));
    if (!entry) return null;
    if (entry.expiresAt <= this.#now()) {
      this.#sessions.delete(hashToken(key));
      return null;
    }
    return {
      identity: cloneIdentity(entry.identity),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      scopes: [...entry.scopes],
    };
  }

  async inspect(accessToken: string): Promise<RegistryAuthSessionMetadata | null> {
    const context = await this.resolveContext(accessToken);
    return context ? { expiresAt: context.expiresAt, scopes: [...context.scopes] } : null;
  }

  async revoke(accessToken: string): Promise<boolean> {
    const key = safeToken(accessToken);
    return key ? this.#sessions.delete(hashToken(key)) : false;
  }
}

/** Exchanges a provider credential for an AgentCargo-scoped session. */
export class ProviderSessionExchange implements RegistrySessionExchange {
  constructor(
    private readonly provider: RegistryPublisherTokenVerifier,
    private readonly sessions: RegistrySessionStore,
  ) {}

  async exchange(providerToken: string, options: { scopes?: readonly RegistrySessionScope[] } = {}): Promise<RegistryAuthSession | null> {
    const identity = await this.provider.verify(providerToken);
    return identity ? this.sessions.issue(identity, options) : null;
  }
}

export class RegistryPublisherAuthError extends Error {
  constructor(message = "The publisher identity provider is unavailable.") {
    super(message);
    this.name = "RegistryPublisherAuthError";
  }
}

/**
 * Builds the API's generic bearer boundary. Provider-specific verification
 * (GitHub OAuth, a hosted session, or a future identity provider) is injected
 * and never implemented in the route package.
 */
export function createBearerPublisherResolver(
  verifier: RegistryPublisherTokenVerifier,
): (
  request: FastifyRequest,
  coordinate: RegistryReleaseCoordinate,
) => Promise<{ identity: RegistryPublisherIdentity } | null> {
  return async (request) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) return null;
    try {
      const identity = await verifier.verify(token);
      return identity ? { identity } : null;
    } catch {
      throw new RegistryPublisherAuthError();
    }
  };
}

/** Builds the browser-session boundary for an HttpOnly AgentCargo cookie. */
export function createSessionCookiePublisherResolver(
  verifier: RegistryPublisherTokenVerifier,
  cookieName = "agentcargo_session",
): (
  request: FastifyRequest,
  coordinate: RegistryReleaseCoordinate,
) => Promise<{ identity: RegistryPublisherIdentity } | null> {
  return async (request) => {
    const token = extractCookieToken(request.headers.cookie, cookieName);
    if (!token) return null;
    try {
      const identity = await verifier.verify(token);
      return identity ? { identity } : null;
    } catch {
      throw new RegistryPublisherAuthError();
    }
  };
}

/** Builds a scoped resolver for opaque AgentCargo sessions held in a cookie. */
export function createScopedSessionCookiePublisherResolver(
  sessions: RegistrySessionStore,
  cookieName = "agentcargo_session",
): (
  request: FastifyRequest,
  coordinate: RegistryReleaseCoordinate,
) => Promise<RegistryPublisherContext | null> {
  return async (request) => {
    const token = extractCookieToken(request.headers.cookie, cookieName);
    if (!token) return null;
    try {
      return await sessions.resolveContext(token);
    } catch {
      throw new RegistryPublisherAuthError();
    }
  };
}

export function extractBearerToken(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 16384) return null;
  const match = /^Bearer[ \t]+([^ \t,]+)$/i.exec(value);
  if (!match || !match[1] || /[\u0000-\u001f\u007f]/.test(match[1])) return null;
  return match[1];
}

export function extractCookieToken(value: string | string[] | undefined, cookieName = "agentcargo_session"): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(cookieName) || value.length > 16384) return null;
  let found: string | null = null;
  let seen = false;
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const token = part.slice(separator + 1).trim();
    if (name !== cookieName) continue;
    if (seen) return null;
    seen = true;
    found = safeToken(token);
  }
  return found;
}

function boundedTtl(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), 3600);
}

function safeToken(value: string): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 16384) return null;
  if (/[^\u0021-\u007e]/.test(value)) return null;
  return value;
}

function hashToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cloneIdentity(identity: RegistryPublisherIdentity): RegistryPublisherIdentity {
  return identity.login === undefined
    ? { provider: identity.provider, subject: identity.subject }
    : { provider: identity.provider, subject: identity.subject, login: identity.login };
}

function normalizeSessionScopes(scopes: readonly RegistrySessionScope[]): readonly RegistrySessionScope[] {
  const normalized = [...new Set(scopes)];
  if (normalized.length !== scopes.length || normalized.length === 0 || normalized.some((scope) => scope !== "publisher:read" && scope !== "publisher:write")) {
    throw new TypeError("Cannot issue a session with invalid registry scopes.");
  }
  return normalized;
}
