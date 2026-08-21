import type {
  RegistrySessionBridgeConfig,
  RegistryWriteSessionExchange,
} from "./registry-session";
import type { PublisherWorkspaceResolver } from "./publisher-workspace";

const REGISTRY_URL_ENV = "AGENTCARGO_REGISTRY_URL";
const PROVIDER_BROKER_URL_ENV = "AGENTCARGO_WEB_PROVIDER_BROKER_URL";
const PROVIDER_BROKER_TOKEN_ENV = "AGENTCARGO_WEB_PROVIDER_BROKER_TOKEN";
const MAX_JSON_BYTES = 64 * 1024;

export type RegistryPublisherReservationRequest = {
  namespace: string;
  name: string;
  version: string;
  idempotencyKey: string;
};

export type RegistryPublisherReservationResolver = (
  accessToken: string,
  input: RegistryPublisherReservationRequest,
) => Promise<{ status: number; body: unknown | null }>;

export type RegistrySessionBridgeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Compose the web bridge from server-only deployment settings.
 *
 * The broker is a trusted, authenticated server-to-server adapter owned by the
 * host. It maps the host-authenticated workspace user to a GitHub credential;
 * browser headers, cookies, and request bodies are never forwarded to it.
 */
export function createRegistrySessionBridgeFromEnvironment(
  environment: RegistrySessionBridgeEnvironment,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): RegistrySessionBridgeConfig | null {
  const registryUrl = parseServerUrl(environment[REGISTRY_URL_ENV], true);
  const providerBrokerUrl = parseServerUrl(environment[PROVIDER_BROKER_URL_ENV], false);
  const providerBrokerToken = safeCredential(environment[PROVIDER_BROKER_TOKEN_ENV]);
  if (!registryUrl || !providerBrokerUrl || !providerBrokerToken || typeof fetchImplementation !== "function") return null;

  return {
    async resolveProviderCredential({ workspaceIdentity }) {
      if (!isSafeWorkspaceUserId(workspaceIdentity.userId)) return null;
      const response = await fetchImplementation(providerBrokerUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${providerBrokerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ provider: "github", workspaceUserId: workspaceIdentity.userId }),
        cache: "no-store",
      });
      if (!response.ok) return null;
      const body = await readBoundedJson(response);
      if (!isExactRecord(body, ["provider", "accessToken"]) || body.provider !== "github") return null;
      return safeCredential(body.accessToken);
    },

    async exchange(providerToken, options) {
      const response = await fetchImplementation(new URL("v1/auth/github/session", registryUrl), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${providerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ scopes: options.scopes }),
        cache: "no-store",
      });
      if (!response.ok) return null;
      const body = await readBoundedJson(response);
      if (!isExactRecord(body, ["apiVersion", "session"]) || body.apiVersion !== "v1") return null;
      const session = body.session;
      if (!isExactRecord(session, ["accessToken", "tokenType", "expiresAt", "identity", "scopes"])) return null;
      const accessToken = safeCredential(session.accessToken);
      if (!accessToken || session.tokenType !== "bearer" || typeof session.expiresAt !== "string" || !isReadScope(session.scopes)) return null;
      return { accessToken, tokenType: "bearer", expiresAt: session.expiresAt, scopes: ["publisher:read"] };
    },

    async resolveSession({ accessToken }) {
      const response = await fetchImplementation(new URL("v1/auth/session", registryUrl), {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const body = await readBoundedJson(response);
      if (!isExactRecord(body, ["apiVersion", "session"]) || body.apiVersion !== "v1") return null;
      const session = body.session;
      if (!isExactRecord(session, ["expiresAt", "scopes"]) || typeof session.expiresAt !== "string" || !isReadScope(session.scopes)) return null;
      return { expiresAt: session.expiresAt, scopes: ["publisher:read"] };
    },
  };
}

export function createRegistryPublisherWorkspaceResolverFromEnvironment(
  environment: RegistrySessionBridgeEnvironment,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): PublisherWorkspaceResolver | null {
  const registryUrl = parseServerUrl(environment[REGISTRY_URL_ENV], true);
  if (!registryUrl || typeof fetchImplementation !== "function") return null;
  return async (accessToken) => {
    if (!safeCredential(accessToken)) return null;
    const response = await fetchImplementation(new URL("v1/publisher/workspace", registryUrl), {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error("Publisher workspace is unavailable.");
    return readBoundedJson(response);
  };
}

/** Create a server-only publisher:write exchange; write sessions are never cookies. */
export function createRegistryPublisherWriteSessionExchangeFromEnvironment(
  environment: RegistrySessionBridgeEnvironment,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): RegistryWriteSessionExchange | null {
  const registryUrl = parseServerUrl(environment[REGISTRY_URL_ENV], true);
  if (!registryUrl || typeof fetchImplementation !== "function") return null;
  return async (providerToken, options) => {
    if (!safeCredential(providerToken) || !isWriteScope(options.scopes)) return null;
    const response = await fetchImplementation(new URL("v1/auth/github/session", registryUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${providerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ scopes: options.scopes }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = await readBoundedJson(response);
    if (!isExactRecord(body, ["apiVersion", "session"]) || body.apiVersion !== "v1") return null;
    const session = body.session;
    if (!isExactRecord(session, ["accessToken", "tokenType", "expiresAt", "identity", "scopes"])) return null;
    const accessToken = safeCredential(session.accessToken);
    if (!accessToken || session.tokenType !== "bearer" || typeof session.expiresAt !== "string" || !isWriteScope(session.scopes)) return null;
    return { accessToken, tokenType: "bearer", expiresAt: session.expiresAt, scopes: ["publisher:write"] };
  };
}

/** Create the server-only reservation transport used by the publication intent route. */
export function createRegistryPublisherReservationResolverFromEnvironment(
  environment: RegistrySessionBridgeEnvironment,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): RegistryPublisherReservationResolver | null {
  const registryUrl = parseServerUrl(environment[REGISTRY_URL_ENV], true);
  if (!registryUrl || typeof fetchImplementation !== "function") return null;
  return async (accessToken, input) => {
    if (!safeCredential(accessToken) || !isPackagePart(input.namespace) || !isPackagePart(input.name) || !isSemver(input.version) || !isSafeIdempotencyKey(input.idempotencyKey)) {
      return { status: 400, body: null };
    }
    const response = await fetchImplementation(new URL(`v1/packages/${encodeURIComponent(input.namespace)}/${encodeURIComponent(input.name)}/releases`, registryUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: input.version, idempotencyKey: input.idempotencyKey }),
      cache: "no-store",
    });
    return { status: response.status, body: await readBoundedJson(response) };
  };
}

function parseServerUrl(value: unknown, directory: boolean): URL | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  if (url.username || url.password) return null;
  url.search = "";
  url.hash = "";
  if (directory) url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function safeCredential(value: unknown): string | null {
  return typeof value === "string" && value.length >= 8 && value.length <= 16_384 && /^[\u0021-\u007e]+$/.test(value)
    ? value
    : null;
}

function isSafeWorkspaceUserId(value: string): boolean {
  if (value.length < 1 || value.length > 512) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function isReadScope(value: unknown): value is readonly ["publisher:read"] {
  return Array.isArray(value) && value.length === 1 && value[0] === "publisher:read";
}

function isWriteScope(value: unknown): value is readonly ["publisher:write"] {
  return Array.isArray(value) && value.length === 1 && value[0] === "publisher:write";
}

function isPackagePart(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isSemver(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+)?(?:\+[0-9A-Za-z-]+)?$/.test(value);
}

function isSafeIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && !hasControlCharacter(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

async function readBoundedJson(response: Response): Promise<unknown | null> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_JSON_BYTES)) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_JSON_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

export const registrySessionBridge = createRegistrySessionBridgeFromEnvironment(process.env);
export const registryPublisherWorkspaceResolver = createRegistryPublisherWorkspaceResolverFromEnvironment(process.env);
export const registryPublisherWriteSessionExchange = createRegistryPublisherWriteSessionExchangeFromEnvironment(process.env);
export const registryPublisherReservationResolver = createRegistryPublisherReservationResolverFromEnvironment(process.env);
