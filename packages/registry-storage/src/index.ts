import { createHash } from "node:crypto";
import {
  AGENTCARGO_ARTIFACT_MEDIA_TYPE,
  isSha256Digest,
  type Sha256Digest,
} from "@agentcargo/registry-contract";

export const REGISTRY_ARTIFACT_CONTENT_TYPE = AGENTCARGO_ARTIFACT_MEDIA_TYPE;
export const DEFAULT_ARTIFACT_DOWNLOAD_TTL_SECONDS = 300;
export const DEFAULT_ARTIFACT_UPLOAD_TTL_SECONDS = 900;
export const MAX_ARTIFACT_UPLOAD_BYTES = 12 * 1024 * 1024;

export interface RegistryObjectMetadata {
  digest: Sha256Digest;
  bytes: number;
  contentType: string;
}

export interface RegistryObjectHead extends RegistryObjectMetadata {
  key: string;
}

/** Minimal interface implemented by an S3-compatible object store adapter. */
export interface RegistryObjectStore {
  head(key: string): Promise<RegistryObjectHead | null>;
  putImmutable(key: string, body: Uint8Array, metadata: RegistryObjectMetadata): Promise<"created" | "exists">;
  createSignedDownload(key: string, expiresAt: string): Promise<string>;
  createSignedUpload(key: string, expiresAt: string, metadata: RegistryObjectMetadata): Promise<string>;
}

export interface StoredArtifact {
  digest: Sha256Digest;
  key: string;
  bytes: number;
  contentType: string;
}

export interface ArtifactDownload {
  url: string;
  expiresAt: string;
}

export interface ArtifactUpload extends ArtifactDownload {
  digest: Sha256Digest;
  key: string;
  bytes: number;
  contentType: string;
}

export class RegistryArtifactStorageError extends Error {
  constructor(
    public readonly code:
      | "ARTIFACT_DIGEST_INVALID"
      | "ARTIFACT_DIGEST_MISMATCH"
      | "ARTIFACT_OBJECT_CONFLICT"
      | "ARTIFACT_NOT_FOUND"
      | "ARTIFACT_SIZE_INVALID"
      | "ARTIFACT_DOWNLOAD_TTL_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "RegistryArtifactStorageError";
  }
}

export class DigestArtifactStorage {
  constructor(
    private readonly objectStore: RegistryObjectStore,
    private readonly now: () => number = Date.now,
  ) {}

  async put(digest: string, body: Uint8Array): Promise<StoredArtifact> {
    assertDigest(digest);
    const expectedDigest = digest as Sha256Digest;
    const actualDigest = digestBytes(body);
    if (actualDigest !== expectedDigest) {
      throw new RegistryArtifactStorageError(
        "ARTIFACT_DIGEST_MISMATCH",
        `Artifact bytes do not match ${expectedDigest}.`,
      );
    }

    const key = artifactObjectKey(expectedDigest);
    const metadata: RegistryObjectMetadata = {
      digest: expectedDigest,
      bytes: body.byteLength,
      contentType: REGISTRY_ARTIFACT_CONTENT_TYPE,
    };
    const existing = await this.objectStore.head(key);
    if (existing && !sameMetadata(existing, metadata)) {
      throw new RegistryArtifactStorageError(
        "ARTIFACT_OBJECT_CONFLICT",
        `The digest-addressed object ${key} already contains different metadata.`,
      );
    }
    if (existing) return { digest: expectedDigest, key, bytes: body.byteLength, contentType: metadata.contentType };
    const result = await this.objectStore.putImmutable(key, body, metadata);
    if (result === "exists") {
      const confirmed = await this.objectStore.head(key);
      if (!confirmed || !sameMetadata(confirmed, metadata)) {
        throw new RegistryArtifactStorageError(
          "ARTIFACT_OBJECT_CONFLICT",
          `The digest-addressed object ${key} changed during an immutable write.`,
        );
      }
    }
    return { digest: expectedDigest, key, bytes: body.byteLength, contentType: metadata.contentType };
  }

  async createDownload(
    digest: string,
    ttlSeconds = DEFAULT_ARTIFACT_DOWNLOAD_TTL_SECONDS,
  ): Promise<ArtifactDownload> {
    assertDigest(digest);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
      throw new RegistryArtifactStorageError(
        "ARTIFACT_DOWNLOAD_TTL_INVALID",
        "Artifact download TTL must be an integer between 1 and 3600 seconds.",
      );
    }
    const expectedDigest = digest as Sha256Digest;
    const key = artifactObjectKey(expectedDigest);
    const existing = await this.objectStore.head(key);
    if (!existing) {
      throw new RegistryArtifactStorageError("ARTIFACT_NOT_FOUND", `Artifact ${expectedDigest} was not found.`);
    }
    if (existing.digest !== expectedDigest) {
      throw new RegistryArtifactStorageError(
        "ARTIFACT_OBJECT_CONFLICT",
        `The digest-addressed object ${key} has an unexpected digest.`,
      );
    }
    const expiresAt = new Date(this.now() + ttlSeconds * 1000).toISOString();
    const url = await this.objectStore.createSignedDownload(key, expiresAt);
    return { url, expiresAt };
  }

  async createUpload(
    digest: string,
    bytes: number,
    ttlSeconds = DEFAULT_ARTIFACT_UPLOAD_TTL_SECONDS,
  ): Promise<ArtifactUpload> {
    assertDigest(digest);
    assertArtifactSize(bytes);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
      throw new RegistryArtifactStorageError(
        "ARTIFACT_DOWNLOAD_TTL_INVALID",
        "Artifact upload TTL must be an integer between 1 and 3600 seconds.",
      );
    }
    const expectedDigest = digest as Sha256Digest;
    const key = artifactObjectKey(expectedDigest);
    const metadata: RegistryObjectMetadata = {
      digest: expectedDigest,
      bytes,
      contentType: REGISTRY_ARTIFACT_CONTENT_TYPE,
    };
    const expiresAt = new Date(this.now() + ttlSeconds * 1000).toISOString();
    const url = await this.objectStore.createSignedUpload(key, expiresAt, metadata);
    return { url, expiresAt, digest: expectedDigest, key, bytes, contentType: metadata.contentType };
  }

  async assertUploaded(digest: string, bytes: number): Promise<StoredArtifact> {
    assertDigest(digest);
    assertArtifactSize(bytes);
    const expectedDigest = digest as Sha256Digest;
    const key = artifactObjectKey(expectedDigest);
    const existing = await this.objectStore.head(key);
    if (!existing) throw new RegistryArtifactStorageError("ARTIFACT_NOT_FOUND", `Artifact ${expectedDigest} was not found.`);
    if (!sameMetadata(existing, { digest: expectedDigest, bytes, contentType: REGISTRY_ARTIFACT_CONTENT_TYPE })) {
      throw new RegistryArtifactStorageError(
        "ARTIFACT_OBJECT_CONFLICT",
        `The digest-addressed object ${key} does not match the declared artifact metadata.`,
      );
    }
    return { digest: expectedDigest, key, bytes, contentType: REGISTRY_ARTIFACT_CONTENT_TYPE };
  }
}

export function artifactObjectKey(digest: string): string {
  assertDigest(digest);
  const hex = digest.slice("sha256:".length);
  return `artifacts/sha256/${hex.slice(0, 2)}/${hex}.agentcargo`;
}

export function digestBytes(body: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function assertDigest(value: string): asserts value is Sha256Digest {
  if (!isSha256Digest(value)) {
    throw new RegistryArtifactStorageError(
      "ARTIFACT_DIGEST_INVALID",
      "Artifact digest must use sha256:<64 lowercase hexadecimal characters>.",
    );
  }
}

function assertArtifactSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ARTIFACT_UPLOAD_BYTES) {
    throw new RegistryArtifactStorageError(
      "ARTIFACT_SIZE_INVALID",
      `Artifact bytes must be an integer between 0 and ${MAX_ARTIFACT_UPLOAD_BYTES}.`,
    );
  }
}

function sameMetadata(left: RegistryObjectMetadata, right: RegistryObjectMetadata): boolean {
  return left.digest === right.digest && left.bytes === right.bytes && left.contentType === right.contentType;
}
