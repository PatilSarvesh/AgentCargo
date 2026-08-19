import { createHash, randomBytes } from "node:crypto";
import {
  validateRegistryAuthCredential,
  type RegistryAuthCredential,
  type RegistryPublisherIdentity,
} from "@agentcargo/registry-contract";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_USER_URL = "https://api.github.com/user";
const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_DEVICE_INTERVAL_SECONDS = 5;
const DEFAULT_USER_AGENT = "AgentCargo/0.1";

export interface GitHubOAuthClientOptions {
  clientId: string;
  clientSecret?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  userAgent?: string;
}

export interface GitHubAuthorizationRequest {
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
}

export interface GitHubDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export interface GitHubOAuthStateStore {
  remember(
    request: GitHubAuthorizationRequest,
    redirectUri: string,
    options?: { ttlSeconds?: number },
  ): Promise<{ expiresAt: string }>;
  consume(state: string, redirectUri: string): Promise<{ codeVerifier: string } | null>;
}

export type GitHubOAuthErrorCode =
  | "GITHUB_OAUTH_CONFIG_INVALID"
  | "GITHUB_OAUTH_REDIRECT_INVALID"
  | "GITHUB_OAUTH_NETWORK_ERROR"
  | "GITHUB_OAUTH_HTTP_ERROR"
  | "GITHUB_OAUTH_RESPONSE_INVALID"
  | "GITHUB_OAUTH_TOKEN_REJECTED"
  | "GITHUB_OAUTH_DEVICE_EXPIRED"
  | "GITHUB_OAUTH_ACCESS_DENIED"
  | "GITHUB_OAUTH_REFRESH_UNAVAILABLE"
  | "GITHUB_OAUTH_STATE_INVALID"
  | "GITHUB_OAUTH_IDENTITY_INVALID";

export class GitHubOAuthError extends Error {
  constructor(public readonly code: GitHubOAuthErrorCode, message: string, public readonly status?: number) {
    super(message);
    this.name = "GitHubOAuthError";
  }
}

/**
 * One-time callback state for a hosted OAuth flow. State digests are retained
 * instead of raw state values; the verifier is kept only until callback
 * completion and the record is deleted on every consume attempt.
 */
export class InMemoryGitHubOAuthStateStore implements GitHubOAuthStateStore {
  readonly #records = new Map<string, { codeVerifier: string; redirectUri: string; expiresAt: number }>();
  readonly #now: () => number;
  readonly #ttlSeconds: number;

  constructor(options: { now?: () => number; ttlSeconds?: number } = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#ttlSeconds = boundedStateTtl(options.ttlSeconds ?? 600);
  }

  async remember(
    request: GitHubAuthorizationRequest,
    redirectUri: string,
    options: { ttlSeconds?: number } = {},
  ): Promise<{ expiresAt: string }> {
    validateRedirectUri(redirectUri);
    const state = validateStateValue(request.state, "OAuth state");
    const codeVerifier = validateStateValue(request.codeVerifier, "code verifier");
    const expiresAt = this.#now() + boundedStateTtl(options.ttlSeconds ?? this.#ttlSeconds) * 1000;
    this.#records.set(hashState(state), { codeVerifier, redirectUri, expiresAt });
    return { expiresAt: new Date(expiresAt).toISOString() };
  }

  async consume(state: string, redirectUri: string): Promise<{ codeVerifier: string } | null> {
    let normalizedState: string;
    try {
      normalizedState = validateStateValue(state, "OAuth state");
      validateRedirectUri(redirectUri);
    } catch {
      return null;
    }
    const key = hashState(normalizedState);
    const record = this.#records.get(key);
    if (!record) return null;
    this.#records.delete(key);
    if (record.expiresAt <= this.#now() || record.redirectUri !== redirectUri) return null;
    return { codeVerifier: record.codeVerifier };
  }
}

/** Adapts GitHub's `/user` identity check to the registry API verifier shape. */
export class GitHubPublisherTokenVerifier {
  constructor(private readonly client: GitHubOAuthClient) {}

  async verify(accessToken: string): Promise<RegistryPublisherIdentity | null> {
    try {
      return await this.client.getAuthenticatedIdentity(accessToken);
    } catch (error) {
      if (error instanceof GitHubOAuthError && error.code === "GITHUB_OAUTH_HTTP_ERROR" && error.status === 401) {
        return null;
      }
      throw error;
    }
  }
}

/**
 * Small GitHub OAuth adapter shared by the CLI and a future hosted callback.
 * It never logs or includes access/refresh token values in thrown errors.
 */
export class GitHubOAuthClient {
  readonly #clientId: string;
  readonly #clientSecret: string | undefined;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #userAgent: string;

  constructor(options: GitHubOAuthClientOptions) {
    this.#clientId = validateClientValue(options.clientId, "client ID");
    this.#clientSecret = options.clientSecret === undefined ? undefined : validateClientValue(options.clientSecret, "client secret");
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") {
      throw new GitHubOAuthError("GITHUB_OAUTH_CONFIG_INVALID", "This Node.js runtime does not provide fetch.");
    }
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  createAuthorizationRequest(options: {
    redirectUri: string;
    scopes?: readonly string[];
    login?: string;
    allowSignup?: boolean;
  }): GitHubAuthorizationRequest {
    validateRedirectUri(options.redirectUri);
    const scopes = normalizeScopes(options.scopes);
    const state = randomToken(32);
    const codeVerifier = randomToken(32);
    const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
    const params = new URLSearchParams({
      client_id: this.#clientId,
      redirect_uri: options.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    if (scopes.length > 0) params.set("scope", scopes.join(" "));
    if (options.login !== undefined) params.set("login", validateScopeValue(options.login, "login"));
    if (options.allowSignup !== undefined) params.set("allow_signup", String(options.allowSignup));
    return { authorizationUrl: `${GITHUB_AUTHORIZE_URL}?${params.toString()}`, state, codeVerifier };
  }

  async exchangeCode(options: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<RegistryAuthCredential> {
    validateRedirectUri(options.redirectUri);
    const code = validateScopeValue(options.code, "authorization code");
    const codeVerifier = validateScopeValue(options.codeVerifier, "code verifier");
    if (!this.#clientSecret) {
      throw new GitHubOAuthError("GITHUB_OAUTH_CONFIG_INVALID", "A client secret is required for authorization-code exchange.");
    }
    const response = await this.#postForm(GITHUB_ACCESS_TOKEN_URL, {
      client_id: this.#clientId,
      client_secret: this.#clientSecret,
      code,
      redirect_uri: options.redirectUri,
      code_verifier: codeVerifier,
    });
    return credentialFromTokenResponse(response, this.#now());
  }

  async requestDeviceCode(options: { scopes?: readonly string[] } = {}): Promise<GitHubDeviceCode> {
    const scopes = normalizeScopes(options.scopes);
    const response = await this.#postForm(GITHUB_DEVICE_CODE_URL, {
      client_id: this.#clientId,
      ...(scopes.length > 0 ? { scope: scopes.join(" ") } : {}),
    });
    throwForOAuthResponseError(response);
    const deviceCode = stringResponseField(response, "device_code");
    const userCode = stringResponseField(response, "user_code");
    const verificationUri = httpsUrlResponseField(response, "verification_uri");
    const verificationUriComplete = optionalHttpsUrlResponseField(response, "verification_uri_complete");
    const expiresInSeconds = positiveIntegerResponseField(response, "expires_in");
    const intervalRaw = response.interval;
    const intervalSeconds = intervalRaw === undefined
      ? DEFAULT_DEVICE_INTERVAL_SECONDS
      : positiveIntegerResponseField(response, "interval");
    return {
      deviceCode,
      userCode,
      verificationUri,
      ...(verificationUriComplete ? { verificationUriComplete } : {}),
      expiresInSeconds,
      intervalSeconds,
    };
  }

  async pollDeviceToken(device: GitHubDeviceCode): Promise<RegistryAuthCredential> {
    const deviceCode = validateScopeValue(device.deviceCode, "device code");
    const expiresAt = this.#now() + device.expiresInSeconds * 1000;
    let intervalSeconds = Math.max(0, device.intervalSeconds);
    while (this.#now() < expiresAt) {
      await this.#sleep(intervalSeconds * 1000);
      const response = await this.#postForm(GITHUB_ACCESS_TOKEN_URL, {
        client_id: this.#clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        ...(this.#clientSecret ? { client_secret: this.#clientSecret } : {}),
      });
      const oauthError = readOAuthError(response);
      if (!oauthError) return credentialFromTokenResponse(response, this.#now());
      if (oauthError === "authorization_pending") continue;
      if (oauthError === "slow_down") {
        intervalSeconds += 5;
        continue;
      }
      if (oauthError === "expired_token") {
        throw new GitHubOAuthError("GITHUB_OAUTH_DEVICE_EXPIRED", "The GitHub device authorization expired before it was approved.");
      }
      if (oauthError === "access_denied") {
        throw new GitHubOAuthError("GITHUB_OAUTH_ACCESS_DENIED", "GitHub denied the device authorization.");
      }
      throw new GitHubOAuthError("GITHUB_OAUTH_TOKEN_REJECTED", oauthErrorMessage(oauthError));
    }
    throw new GitHubOAuthError("GITHUB_OAUTH_DEVICE_EXPIRED", "The GitHub device authorization expired before it was approved.");
  }

  async refreshAccessToken(credential: RegistryAuthCredential): Promise<RegistryAuthCredential> {
    const validation = validateRegistryAuthCredential(credential);
    if (!validation.valid) throw new GitHubOAuthError("GITHUB_OAUTH_REFRESH_UNAVAILABLE", "The stored GitHub credential is invalid.");
    if (!validation.value.refreshToken) {
      throw new GitHubOAuthError("GITHUB_OAUTH_REFRESH_UNAVAILABLE", "No GitHub refresh token is available for this credential.");
    }
    const response = await this.#postForm(GITHUB_ACCESS_TOKEN_URL, {
      client_id: this.#clientId,
      ...(this.#clientSecret ? { client_secret: this.#clientSecret } : {}),
      grant_type: "refresh_token",
      refresh_token: validation.value.refreshToken,
    });
    return credentialFromTokenResponse(response, this.#now(), validation.value);
  }

  async getAuthenticatedIdentity(accessToken: string): Promise<RegistryPublisherIdentity> {
    const token = validateScopeValue(accessToken, "access token");
    let response: Response;
    try {
      response = await this.#fetch(GITHUB_API_USER_URL, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": this.#userAgent,
          "x-github-api-version": GITHUB_API_VERSION,
        },
      });
    } catch {
      throw new GitHubOAuthError("GITHUB_OAUTH_NETWORK_ERROR", "The GitHub identity request failed.");
    }
    const body = await readJsonBody(response, "identity");
    if (!response.ok) throw new GitHubOAuthError("GITHUB_OAUTH_HTTP_ERROR", `GitHub identity request returned HTTP ${response.status}.`, response.status);
    if (!isRecord(body) || !isValidGitHubId(body.id) || typeof body.login !== "string" || !isSafeText(body.login, 64)) {
      throw new GitHubOAuthError("GITHUB_OAUTH_IDENTITY_INVALID", "GitHub returned an invalid authenticated identity.");
    }
    return { provider: "github", subject: String(body.id), login: body.login };
  }

  async #postForm(url: string, values: Record<string, string>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": this.#userAgent,
        },
        body: new URLSearchParams(values),
      });
    } catch {
      throw new GitHubOAuthError("GITHUB_OAUTH_NETWORK_ERROR", "The GitHub OAuth request failed.");
    }
    const body = await readJsonBody(response, "OAuth");
    if (!response.ok && !readOAuthError(body)) {
      throw new GitHubOAuthError("GITHUB_OAUTH_HTTP_ERROR", `GitHub OAuth returned HTTP ${response.status}.`, response.status);
    }
    return body;
  }
}

export interface GitHubHostedAuthorization {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

/** Wires PKCE code exchange to a one-time callback-state store. */
export class GitHubHostedOAuthFlow {
  constructor(
    private readonly client: GitHubOAuthClient,
    private readonly stateStore: GitHubOAuthStateStore,
  ) {}

  async begin(options: {
    redirectUri: string;
    scopes?: readonly string[];
    login?: string;
    allowSignup?: boolean;
    stateTtlSeconds?: number;
  }): Promise<GitHubHostedAuthorization> {
    const request = this.client.createAuthorizationRequest(options);
    const saved = await this.stateStore.remember(
      request,
      options.redirectUri,
      options.stateTtlSeconds === undefined ? {} : { ttlSeconds: options.stateTtlSeconds },
    );
    return { authorizationUrl: request.authorizationUrl, state: request.state, expiresAt: saved.expiresAt };
  }

  async complete(options: { code: string; state: string; redirectUri: string }): Promise<RegistryAuthCredential> {
    const callback = await this.stateStore.consume(options.state, options.redirectUri);
    if (!callback) throw new GitHubOAuthError("GITHUB_OAUTH_STATE_INVALID", "The OAuth callback state is invalid or expired.");
    return this.client.exchangeCode({ code: options.code, redirectUri: options.redirectUri, codeVerifier: callback.codeVerifier });
  }
}

function credentialFromTokenResponse(
  response: Record<string, unknown>,
  now: number,
  previous?: RegistryAuthCredential,
): RegistryAuthCredential {
  throwForOAuthResponseError(response);
  const accessToken = stringResponseField(response, "access_token");
  const tokenType = response.token_type;
  if (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer") {
    throw new GitHubOAuthError("GITHUB_OAUTH_RESPONSE_INVALID", "GitHub returned an unsupported token type.");
  }
  const expiresIn = optionalPositiveIntegerResponseField(response, "expires_in");
  const refreshToken = optionalStringResponseField(response, "refresh_token") ?? previous?.refreshToken;
  const refreshExpiresIn = optionalPositiveIntegerResponseField(response, "refresh_token_expires_in");
  const scope = typeof response.scope === "string" ? normalizeScopes(response.scope.split(",")) : previous?.scopes;
  const credential: RegistryAuthCredential = {
    provider: "github",
    tokenType: "bearer",
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresIn !== undefined ? { expiresAt: new Date(now + expiresIn * 1000).toISOString() } : {}),
    ...(refreshExpiresIn !== undefined ? { refreshTokenExpiresAt: new Date(now + refreshExpiresIn * 1000).toISOString() } : previous?.refreshTokenExpiresAt ? { refreshTokenExpiresAt: previous.refreshTokenExpiresAt } : {}),
    ...(scope && scope.length > 0 ? { scopes: scope } : {}),
  };
  const validation = validateRegistryAuthCredential(credential);
  if (!validation.valid) throw new GitHubOAuthError("GITHUB_OAUTH_RESPONSE_INVALID", "GitHub returned an invalid token response.");
  return validation.value;
}

function throwForOAuthResponseError(response: Record<string, unknown>): void {
  const error = readOAuthError(response);
  if (!error) return;
  throw new GitHubOAuthError("GITHUB_OAUTH_TOKEN_REJECTED", oauthErrorMessage(error));
}

function readOAuthError(response: Record<string, unknown>): string | undefined {
  return typeof response.error === "string" ? response.error : undefined;
}

function oauthErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    bad_verification_code: "GitHub rejected the authorization code.",
    incorrect_client_credentials: "GitHub rejected the OAuth client configuration.",
    unauthorized_client: "GitHub rejected this OAuth client.",
    unsupported_grant_type: "GitHub rejected the OAuth grant type.",
    invalid_grant: "GitHub rejected the OAuth grant.",
    invalid_request: "GitHub rejected the OAuth request.",
  };
  return messages[code] ?? "GitHub rejected the OAuth request.";
}

async function readJsonBody(response: Response, operation: string): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GitHubOAuthError("GITHUB_OAUTH_RESPONSE_INVALID", `GitHub returned invalid JSON for the ${operation} request.`, response.status);
  }
  if (!isRecord(body)) throw new GitHubOAuthError("GITHUB_OAUTH_RESPONSE_INVALID", `GitHub returned an invalid ${operation} response.`, response.status);
  return body;
}

function stringResponseField(response: Record<string, unknown>, field: string): string {
  const value = response[field];
  if (typeof value !== "string" || !isSafeText(value, 16384)) throw new GitHubOAuthError("GITHUB_OAUTH_RESPONSE_INVALID", `GitHub returned an invalid ${field} value.`);
  return value;
}

function optionalStringResponseField(response: Record<string, unknown>, field: string): string | undefined {
  if (!(field in response)) return undefined;
  return stringResponseField(response, field);
}

function positiveIntegerResponseField(response: Record<string, unknown>, field: string): number {
  const value = response[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new GitHubOAuthError("GITHUB_OAUTH_RESPONSE_INVALID", `GitHub returned an invalid ${field} value.`);
  return value;
}

function optionalPositiveIntegerResponseField(response: Record<string, unknown>, field: string): number | undefined {
  if (!(field in response)) return undefined;
  return positiveIntegerResponseField(response, field);
}

function httpsUrlResponseField(response: Record<string, unknown>, field: string): string {
  const value = stringResponseField(response, field);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch {
    throw new GitHubOAuthError("GITHUB_OAUTH_RESPONSE_INVALID", `GitHub returned an invalid ${field} URL.`);
  }
}

function optionalHttpsUrlResponseField(response: Record<string, unknown>, field: string): string | undefined {
  if (!(field in response)) return undefined;
  return httpsUrlResponseField(response, field);
}

function normalizeScopes(scopes: readonly string[] | string[] = []): string[] {
  const normalized = scopes.filter((scope) => scope.length > 0).map((scope) => validateScopeValue(scope, "scope"));
  return [...new Set(normalized)].sort();
}

function validateClientValue(value: string, label: string): string {
  if (typeof value !== "string" || !isSafeText(value, 1024)) throw new GitHubOAuthError("GITHUB_OAUTH_CONFIG_INVALID", `The GitHub ${label} is invalid.`);
  return value;
}

function validateScopeValue(value: string, label: string): string {
  if (typeof value !== "string" || !isSafeText(value, 16384)) throw new GitHubOAuthError("GITHUB_OAUTH_RESPONSE_INVALID", `The GitHub ${label} is invalid.`);
  return value;
}

function validateRedirectUri(value: string): void {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost");
    if ((!localHttp && url.protocol !== "https:") || url.username || url.password || url.hash) throw new Error();
  } catch {
    throw new GitHubOAuthError("GITHUB_OAUTH_REDIRECT_INVALID", "The OAuth redirect URI must use HTTPS, or HTTP on localhost.");
  }
}

function randomToken(bytes: number): string {
  return base64Url(randomBytes(bytes));
}

function boundedStateTtl(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), 900);
}

function validateStateValue(value: string, label: string): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new GitHubOAuthError("GITHUB_OAUTH_RESPONSE_INVALID", `The ${label} is invalid.`);
  }
  return value;
}

function hashState(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeText(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function isValidGitHubId(value: unknown): boolean {
  return (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && /^[1-9]\d{0,63}$/.test(value));
}
