import { randomUUID } from "node:crypto";
import { homedir, platform } from "node:os";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  validateRegistryAuthCredential,
  type RegistryAuthCredential,
} from "@agentcargo/registry-contract";

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 64 * 1024;

export interface RegistryCredentialStatus {
  registry: string;
  authenticated: boolean;
  refreshable: boolean;
  provider?: RegistryAuthCredential["provider"];
  expiresAt?: string;
  expired?: boolean;
  refreshTokenExpiresAt?: string;
  refreshTokenExpired?: boolean;
}

export interface RegistryCredentialStore {
  get(registryUrl: string): Promise<RegistryAuthCredential | null>;
  getStatus(registryUrl: string): Promise<RegistryCredentialStatus>;
  set(registryUrl: string, credential: RegistryAuthCredential): Promise<void>;
  remove(registryUrl: string): Promise<boolean>;
}

export class RegistryCredentialStoreError extends Error {
  constructor(
    public readonly code:
      | "AUTH_REGISTRY_URL_INVALID"
      | "AUTH_STORE_INVALID"
      | "AUTH_CREDENTIAL_INVALID"
      | "AUTH_STORE_NOT_REGULAR_FILE"
      | "AUTH_STORE_PERMISSIONS_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "RegistryCredentialStoreError";
  }
}

/**
 * Permission-restricted local credential storage. OAuth exchange and refresh
 * live in GitHubOAuthClient; callers provide an already-issued credential and
 * never pass access or refresh tokens through command-line arguments.
 */
export class FileRegistryCredentialStore implements RegistryCredentialStore {
  readonly #filePath: string;

  constructor(options: { filePath?: string } = {}) {
    this.#filePath = path.resolve(options.filePath ?? defaultRegistryCredentialPath());
  }

  get filePath(): string {
    return this.#filePath;
  }

  async get(registryUrl: string): Promise<RegistryAuthCredential | null> {
    const key = canonicalRegistryKey(registryUrl);
    const store = await this.#read();
    const credential = store.credentials[key];
    return credential ? structuredClone(credential) : null;
  }

  async getStatus(registryUrl: string): Promise<RegistryCredentialStatus> {
    const key = canonicalRegistryKey(registryUrl);
    const credential = await this.get(key);
    if (!credential) return { registry: key, authenticated: false, refreshable: false };
    const expired = credential.expiresAt !== undefined && Date.parse(credential.expiresAt) <= Date.now();
    const refreshTokenExpired = credential.refreshTokenExpiresAt !== undefined && Date.parse(credential.refreshTokenExpiresAt) <= Date.now();
    return {
      registry: key,
      authenticated: !expired,
      refreshable: Boolean(credential.refreshToken) && !refreshTokenExpired,
      provider: credential.provider,
      ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}),
      ...(credential.expiresAt ? { expired } : {}),
      ...(credential.refreshTokenExpiresAt ? { refreshTokenExpiresAt: credential.refreshTokenExpiresAt } : {}),
      ...(credential.refreshTokenExpiresAt ? { refreshTokenExpired } : {}),
    };
  }

  async set(registryUrl: string, credential: RegistryAuthCredential): Promise<void> {
    const key = canonicalRegistryKey(registryUrl);
    const validation = validateRegistryAuthCredential(credential);
    if (!validation.valid) {
      throw new RegistryCredentialStoreError(
        "AUTH_CREDENTIAL_INVALID",
        validation.issues[0]?.message ?? "The authentication credential is invalid.",
      );
    }
    const store = await this.#read();
    store.credentials[key] = structuredClone(validation.value);
    await this.#write(store);
  }

  async remove(registryUrl: string): Promise<boolean> {
    const key = canonicalRegistryKey(registryUrl);
    const store = await this.#read();
    if (!(key in store.credentials)) return false;
    delete store.credentials[key];
    await this.#write(store);
    return true;
  }

  async #read(): Promise<CredentialStoreFile> {
    let contents: string;
    try {
      const metadata = await lstat(this.#filePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new RegistryCredentialStoreError("AUTH_STORE_NOT_REGULAR_FILE", "The credential store must be a regular file.");
      if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
        throw new RegistryCredentialStoreError("AUTH_STORE_PERMISSIONS_INVALID", "The credential store must not be accessible by other users.");
      }
      if (metadata.size > MAX_STORE_BYTES) throw new RegistryCredentialStoreError("AUTH_STORE_INVALID", "The credential store is too large.");
      contents = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return emptyStore();
      if (error instanceof RegistryCredentialStoreError) throw error;
      throw new RegistryCredentialStoreError("AUTH_STORE_INVALID", "The credential store could not be read.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new RegistryCredentialStoreError("AUTH_STORE_INVALID", "The credential store contains invalid JSON.");
    }
    return validateStore(parsed);
  }

  async #write(store: CredentialStoreFile): Promise<void> {
    const parent = path.dirname(this.#filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700).catch(() => undefined);
    const temporaryPath = path.join(parent, `.${path.basename(this.#filePath)}.${process.pid}.${randomUUID()}.tmp`);
    const contents = `${JSON.stringify(store, null, 2)}\n`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.chmod(0o600);
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, this.#filePath);
      await chmod(this.#filePath, 0o600).catch(() => undefined);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export function defaultRegistryCredentialPath(): string {
  const configRoot = process.env.AGENTCARGO_CONFIG_DIR;
  if (configRoot) return path.join(configRoot, "auth.json");
  if (platform() === "win32") return path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "AgentCargo", "auth.json");
  if (platform() === "darwin") return path.join(homedir(), "Library", "Application Support", "AgentCargo", "auth.json");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "agentcargo", "auth.json");
}

interface CredentialStoreFile {
  version: 1;
  credentials: Record<string, RegistryAuthCredential>;
}

function emptyStore(): CredentialStoreFile {
  return { version: STORE_VERSION, credentials: {} };
}

function validateStore(input: unknown): CredentialStoreFile {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new RegistryCredentialStoreError("AUTH_STORE_INVALID", "The credential store must be a JSON object.");
  }
  const value = input as Record<string, unknown>;
  if (value.version !== STORE_VERSION || typeof value.credentials !== "object" || value.credentials === null || Array.isArray(value.credentials)) {
    throw new RegistryCredentialStoreError("AUTH_STORE_INVALID", "The credential store schema is unsupported.");
  }
  const credentials: Record<string, RegistryAuthCredential> = {};
  for (const [key, rawCredential] of Object.entries(value.credentials)) {
    const validation = validateRegistryAuthCredential(rawCredential);
    if (!validation.valid || key !== canonicalRegistryKey(key)) {
      throw new RegistryCredentialStoreError("AUTH_STORE_INVALID", "The credential store contains an invalid registry entry.");
    }
    credentials[key] = structuredClone(validation.value);
  }
  return { version: STORE_VERSION, credentials };
}

function canonicalRegistryKey(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RegistryCredentialStoreError("AUTH_REGISTRY_URL_INVALID", "Registry URL must be an absolute HTTP(S) URL.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new RegistryCredentialStoreError("AUTH_REGISTRY_URL_INVALID", "Registry URL must be an HTTP(S) URL without credentials, query, or fragment.");
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") + "/";
  return url.href;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
