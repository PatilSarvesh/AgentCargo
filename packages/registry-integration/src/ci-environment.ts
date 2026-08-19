import { readFile } from "node:fs/promises";
import { Pool, type PoolConfig } from "pg";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { RegistryRelease } from "@agentcargo/registry-contract";
import {
  PostgresRegistryNamespaceRepository,
  PostgresRegistryReleaseRepository,
  PostgresRegistryReleaseReservationRepository,
  type RegistrySqlClient,
} from "@agentcargo/registry-db";
import {
  artifactObjectKey,
  DigestArtifactStorage,
  type RegistryObjectHead,
  type RegistryObjectMetadata,
  type RegistryObjectStore,
} from "@agentcargo/registry-storage";
import type { LiveRegistryIntegrationEnvironment } from "./index.js";

const fixture = { namespace: "integration", name: "live-check", version: "1.0.0" };
const defaultRegion = "us-east-1";
const defaultBucket = "agentcargo";
const defaultEndpoint = "http://127.0.0.1:9000";
const defaultAccessKey = "minioadmin";
const defaultSecretKey = "minioadmin";
const fixturePublisher = { provider: "github" as const, subject: "integration-fixture", login: "integration" };

/** CI-only PostgreSQL/MinIO adapter for the opt-in live integration test. */
export async function createEnvironment(): Promise<LiveRegistryIntegrationEnvironment> {
  const pool = new Pool(databaseConfig());
  const s3Config = objectStoreConfig();
  const s3 = new S3Client(s3Config.client);
  const objectStore = new S3RegistryObjectStore(s3, s3Config.bucket);
  const storage = new DigestArtifactStorage(objectStore);
  let fixtureDigest: string | undefined;

  try {
    await waitForDatabase(pool);
    for (const migrationFile of ["0001_registry_read_path.sql", "0002_registry_publishing.sql", "0003_registry_auth_sessions.sql", "0004_registry_oauth_state.sql", "0005_registry_release_uploads.sql", "0006_registry_scan_jobs.sql", "0007_registry_session_scopes.sql"]) {
      const migration = await readFile(new URL(`../../registry-db/migrations/${migrationFile}`, import.meta.url), "utf8");
      await pool.query(migration);
    }
    await objectStore.ensureBucket();
    await cleanupFixture(pool, objectStore, undefined, false);

    const sqlClient: RegistrySqlClient = {
      async query<Row>(text: string, values: readonly unknown[]) {
        const result = await pool.query(text, values as unknown[]);
        return { rows: result.rows as Row[] };
      },
    };
    const repository = new PostgresRegistryReleaseRepository(sqlClient, async ({ digest }) => {
      const download = await storage.createDownload(digest);
      // The public contract requires HTTPS URLs. MinIO's local endpoint is HTTP,
      // so the test-facing URL is upgraded and converted back only by download().
      return { ...download, url: httpsContractUrl(download.url) };
    });
    const namespaceRepository = new PostgresRegistryNamespaceRepository(sqlClient);
    const reservationRepository = new PostgresRegistryReleaseReservationRepository(sqlClient);

    return {
      repository,
      namespaceRepository,
      reservationRepository,
      storage,
      activateRelease: async (release) => {
        fixtureDigest = release.artifact.digest;
        // The harness uploads before activation. Preserve an existing object
        // for the same digest so a retry does not delete its upload mid-flow.
        await cleanupFixture(pool, objectStore, fixtureDigest, false);
        await pool.query(
          `INSERT INTO registry_artifacts (digest, artifact_key, format, media_type, bytes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (digest) DO NOTHING`,
          [
            release.artifact.digest,
            artifactObjectKey(release.artifact.digest),
            release.artifact.format,
            release.artifact.mediaType,
            release.artifact.bytes,
          ],
        );
        const packageJson = {
          apiVersion: release.apiVersion,
          package: { namespace: release.coordinate.namespace, name: release.coordinate.name },
          description: release.declared.description,
          latestVersion: release.coordinate.version,
          compatibility: release.declared.compatibility,
          tags: release.declared.tags,
          hasScripts: release.files.some((file) => file.scriptLike),
          status: release.status,
        };
        const searchText = [
          release.coordinate.namespace,
          release.coordinate.name,
          release.declared.description,
          ...release.declared.tags,
        ].join(" ");
        await pool.query(
          `INSERT INTO registry_public_packages
             (namespace, name, status, package_json, compatibility, search_document, search_text)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, lower($6), to_tsvector('simple', $6))`,
          [
            release.coordinate.namespace,
            release.coordinate.name,
            release.status,
            JSON.stringify(packageJson),
            JSON.stringify(release.declared.compatibility),
            searchText,
          ],
        );
        await pool.query(
          `INSERT INTO registry_public_releases
             (namespace, name, version, status, artifact_digest, artifact_key, release_json, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            release.coordinate.namespace,
            release.coordinate.name,
            release.coordinate.version,
            release.status,
            release.artifact.digest,
            artifactObjectKey(release.artifact.digest),
            JSON.stringify(release),
            release.publishedAt,
          ],
        );
      },
      download: async (url) => {
        const requestUrl = new URL(url);
        if (new URL(s3Config.endpoint).protocol === "http:" && requestUrl.protocol === "https:") {
          requestUrl.protocol = "http:";
        }
        const response = await fetch(requestUrl);
        if (!response.ok) throw new Error(`Signed artifact download failed with HTTP ${response.status}.`);
        return new Uint8Array(await response.arrayBuffer());
      },
      close: async () => {
        await cleanupFixture(pool, objectStore, fixtureDigest, true);
        await pool.end();
        s3.destroy();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    s3.destroy();
    throw error;
  }
}

class S3RegistryObjectStore implements RegistryObjectStore {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const code = errorCode(error);
      if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") throw error;
    }
  }

  async head(key: string): Promise<RegistryObjectHead | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      const digest = result.Metadata?.digest;
      const bytes = result.ContentLength;
      const contentType = result.ContentType;
      if (!digest || bytes === undefined || !contentType) throw new Error(`Object ${key} is missing AgentCargo metadata.`);
      return { key, digest: digest as RegistryObjectMetadata["digest"], bytes, contentType };
    } catch (error) {
      const code = errorCode(error);
      if (error instanceof NotFound || code === "NotFound" || code === "NoSuchKey" || statusCode(error) === 404) return null;
      throw error;
    }
  }

  async putImmutable(key: string, body: Uint8Array, metadata: RegistryObjectMetadata): Promise<"created" | "exists"> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: metadata.contentType,
          Metadata: { digest: metadata.digest, bytes: String(metadata.bytes) },
          IfNoneMatch: "*",
        }),
      );
      return "created";
    } catch (error) {
      if (codeIsPreconditionFailure(error)) return "exists";
      throw error;
    }
  }

  async createSignedDownload(key: string, expiresAt: string): Promise<string> {
    const expiresIn = Math.min(3600, Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000)));
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  async createSignedUpload(key: string, expiresAt: string, metadata: RegistryObjectMetadata): Promise<string> {
    const expiresIn = Math.min(3600, Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000)));
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: metadata.contentType,
        Metadata: { digest: metadata.digest, bytes: String(metadata.bytes) },
      }),
      { expiresIn },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

async function cleanupFixture(
  pool: Pool,
  objectStore: S3RegistryObjectStore,
  digest: string | undefined,
  deleteObject: boolean,
): Promise<void> {
  await pool.query(
    `DELETE FROM registry_release_reservations
     WHERE namespace = $1`,
    [fixture.namespace],
  );
  await pool.query(`DELETE FROM registry_public_releases WHERE namespace = $1 AND name = $2 AND version = $3`, [
    fixture.namespace,
    fixture.name,
    fixture.version,
  ]);
  await pool.query(`DELETE FROM registry_public_packages WHERE namespace = $1 AND name = $2`, [fixture.namespace, fixture.name]);
  if (digest && deleteObject) {
    await pool.query(`DELETE FROM registry_artifacts WHERE digest = $1`, [digest]);
    await objectStore.delete(artifactObjectKey(digest));
  }
  await pool.query(`DELETE FROM registry_namespaces WHERE namespace = $1`, [fixture.namespace]);
  await pool.query(`DELETE FROM registry_publishers WHERE provider = $1 AND subject = $2`, [fixturePublisher.provider, fixturePublisher.subject]);
}

function databaseConfig(): PoolConfig {
  const connectionString = process.env.AGENTCARGO_TEST_DATABASE_URL;
  return connectionString ? { connectionString, max: 4 } : { max: 4 };
}

function objectStoreConfig(): { bucket: string; client: S3ClientConfig; endpoint: string } {
  const endpoint = process.env.AGENTCARGO_TEST_S3_ENDPOINT ?? defaultEndpoint;
  const clientConfig: S3ClientConfig = {
    endpoint,
    region: process.env.AGENTCARGO_TEST_S3_REGION ?? defaultRegion,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AGENTCARGO_TEST_S3_ACCESS_KEY ?? defaultAccessKey,
      secretAccessKey: process.env.AGENTCARGO_TEST_S3_SECRET_KEY ?? defaultSecretKey,
    },
  };
  return { bucket: process.env.AGENTCARGO_TEST_S3_BUCKET ?? defaultBucket, client: clientConfig, endpoint };
}

function httpsContractUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "http:") parsed.protocol = "https:";
  return parsed.href;
}

async function waitForDatabase(pool: Pool): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("PostgreSQL did not become ready.");
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { name?: string; Code?: string; code?: string };
  return candidate.name ?? candidate.Code ?? candidate.code;
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

function codeIsPreconditionFailure(error: unknown): boolean {
  const code = errorCode(error);
  return code === "PreconditionFailed" || code === "ConditionalRequestConflict" || statusCode(error) === 412;
}
