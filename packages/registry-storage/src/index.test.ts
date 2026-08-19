import { describe, expect, it } from "vitest";
import type { Sha256Digest } from "@agentcargo/registry-contract";
import {
  DigestArtifactStorage,
  RegistryArtifactStorageError,
  artifactObjectKey,
  digestBytes,
  type RegistryObjectHead,
  type RegistryObjectMetadata,
  type RegistryObjectStore,
} from "./index.js";

describe("digest-addressed artifact storage", () => {
  it("uses a stable digest-addressed object key", () => {
    const digest = `sha256:${"a".repeat(64)}` as Sha256Digest;
    expect(artifactObjectKey(digest)).toBe(`artifacts/sha256/aa/${"a".repeat(64)}.agentcargo`);
  });

  it("verifies bytes before writing and deduplicates immutable objects", async () => {
    const store = new MemoryObjectStore();
    const storage = new DigestArtifactStorage(store);
    const body = new TextEncoder().encode("artifact");
    const digest = digestBytes(body);

    const first = await storage.put(digest, body);
    const second = await storage.put(digest, body);

    expect(first).toEqual(second);
    expect(store.putCount).toBe(1);
    await expect(storage.put(`sha256:${"b".repeat(64)}`, body)).rejects.toMatchObject({
      code: "ARTIFACT_DIGEST_MISMATCH",
    });
  });

  it("creates signed downloads with bounded expiry", async () => {
    const store = new MemoryObjectStore();
    const now = Date.parse("2026-08-13T00:00:00.000Z");
    const storage = new DigestArtifactStorage(store, () => now);
    const body = new TextEncoder().encode("artifact");
    const digest = digestBytes(body);
    await storage.put(digest, body);

    const download = await storage.createDownload(digest, 60);

    expect(download).toEqual({
      url: `https://objects.example.test/${artifactObjectKey(digest)}`,
      expiresAt: "2026-08-13T00:01:00.000Z",
    });
    await expect(storage.createDownload(digest, 0)).rejects.toMatchObject({
      code: "ARTIFACT_DOWNLOAD_TTL_INVALID",
    });
  });

  it("creates bounded signed uploads and verifies the uploaded object metadata", async () => {
    const store = new MemoryObjectStore();
    const now = Date.parse("2026-08-13T00:00:00.000Z");
    const storage = new DigestArtifactStorage(store, () => now);
    const body = new TextEncoder().encode("artifact");
    const digest = digestBytes(body);

    const upload = await storage.createUpload(digest, body.byteLength, 120);
    expect(upload).toMatchObject({
      digest,
      bytes: body.byteLength,
      url: `https://objects.example.test/${artifactObjectKey(digest)}?upload=1`,
      expiresAt: "2026-08-13T00:02:00.000Z",
    });
    await expect(storage.assertUploaded(digest, body.byteLength)).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });

    await storage.put(digest, body);
    await expect(storage.assertUploaded(digest, body.byteLength)).resolves.toMatchObject({ digest, bytes: body.byteLength });
    await expect(storage.createUpload(digest, 12 * 1024 * 1024 + 1)).rejects.toMatchObject({ code: "ARTIFACT_SIZE_INVALID" });
  });

  it("refuses missing and corrupted objects", async () => {
    const store = new MemoryObjectStore();
    const storage = new DigestArtifactStorage(store);
    const digest = `sha256:${"c".repeat(64)}`;

    await expect(storage.createDownload(digest)).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
    store.corrupt = true;
    const body = new TextEncoder().encode("artifact");
    const actualDigest = digestBytes(body);
    await storage.put(actualDigest, body);
    await expect(storage.createDownload(actualDigest)).rejects.toMatchObject({
      code: "ARTIFACT_OBJECT_CONFLICT",
    });
  });
});

class MemoryObjectStore implements RegistryObjectStore {
  readonly objects = new Map<string, RegistryObjectHead>();
  putCount = 0;
  corrupt = false;

  async head(key: string): Promise<RegistryObjectHead | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return this.corrupt ? { ...object, digest: `sha256:${"f".repeat(64)}` as Sha256Digest } : { ...object };
  }

  async putImmutable(key: string, _body: Uint8Array, metadata: RegistryObjectMetadata): Promise<"created" | "exists"> {
    this.putCount += 1;
    if (this.objects.has(key)) return "exists";
    this.objects.set(key, { key, ...metadata });
    return "created";
  }

  async createSignedDownload(key: string, _expiresAt: string): Promise<string> {
    return `https://objects.example.test/${key}`;
  }

  async createSignedUpload(key: string, _expiresAt: string, _metadata: RegistryObjectMetadata): Promise<string> {
    return `https://objects.example.test/${key}?upload=1`;
  }
}
