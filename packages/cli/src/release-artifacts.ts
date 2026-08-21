import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const RELEASE_SCHEMA = "agentcargo-cli-release-v1" as const;
const SIGNATURE_SCHEMA = "agentcargo-cli-signature-v1" as const;
const ARCHIVE_FORMAT = "agentcargo-cli-ustar-v1" as const;
const DEFAULT_SOURCE_COMMIT = "working-tree";
const INTERNAL_PACKAGE_PREFIX = "@agentcargo/";

export interface CliReleaseBuildOptions {
  workspaceRoot: string;
  outputDirectory: string;
  privateKey: string | KeyObject;
  keyId?: string;
  sourceCommit?: string;
}

export interface CliReleaseBuildResult {
  version: string;
  archivePath: string;
  manifestPath: string;
  checksumPath: string;
  signaturePath: string;
  archiveDigest: string;
  manifestDigest: string;
  keyId: string;
  bytes: number;
}

export interface CliReleaseVerificationOptions {
  archivePath: string;
  manifestPath: string;
  signaturePath: string;
  publicKey: string | KeyObject;
}

export interface CliReleaseVerificationResult {
  version: string;
  archiveDigest: string;
  manifestDigest: string;
  keyId: string;
  bytes: number;
}

interface ArchiveEntry {
  archivePath: string;
  sourcePath?: string;
  kind: "file" | "directory";
  mode: number;
  bytes?: Buffer;
}

interface FileRecord {
  path: string;
  bytes: number;
  sha256: string;
  mode: number;
}

interface PackageRecord {
  name: string;
  version: string;
  path: string;
  files: string[];
}

interface ReleaseManifest {
  schemaVersion: typeof RELEASE_SCHEMA;
  format: typeof ARCHIVE_FORMAT;
  version: string;
  sourceCommit: string;
  runtime: {
    node: string;
    packageManager: string;
  };
  packages: PackageRecord[];
  archive: {
    file: string;
    bytes: number;
    sha256: string;
  };
  files: FileRecord[];
  signature: {
    file: string;
    algorithm: "Ed25519";
    keyId: string;
  };
}

interface SignatureEnvelope {
  schemaVersion: typeof SIGNATURE_SCHEMA;
  algorithm: "Ed25519";
  manifest: string;
  keyId: string;
  signature: string;
}

async function findWorkspacePackage(workspaceRoot: string, packageName: string): Promise<string> {
  const packagesRoot = path.join(workspaceRoot, "packages");
  const directories = await readdir(packagesRoot, { withFileTypes: true });
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const candidate = path.join(packagesRoot, directory.name, "package.json");
    try {
      const manifest = JSON.parse(await readFile(candidate, "utf8")) as { name?: unknown };
      if (manifest.name === packageName) return path.dirname(candidate);
    } catch {
      // A non-package directory is not part of the release bundle.
    }
  }
  throw new Error(`Workspace package ${packageName} was not found under packages/.`);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function collectTree(root: string, relative = ""): Promise<ArchiveEntry[]> {
  const current = path.join(root, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const result: ArchiveEntry[] = [];
  for (const entry of entries) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name;
    const child = path.join(root, childRelative);
    const identity = await lstat(child);
    if (identity.isSymbolicLink() || (!identity.isFile() && !identity.isDirectory())) {
      throw new Error(`Release input contains an unsupported filesystem entry: ${childRelative}`);
    }
    if (identity.isDirectory()) {
      result.push({ archivePath: childRelative.split(path.sep).join("/"), kind: "directory", mode: 0o755 });
      result.push(...await collectTree(root, childRelative));
    } else {
      const bytes = await readFile(child);
      result.push({
        archivePath: childRelative.split(path.sep).join("/"),
        sourcePath: child,
        kind: "file",
        mode: identity.mode & 0o111 ? 0o755 : 0o644,
        bytes,
      });
    }
  }
  return result;
}

function sortPaths<T extends { archivePath: string }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => Buffer.from(left.archivePath).compare(Buffer.from(right.archivePath)));
}

function putOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const text = Math.max(0, value).toString(8).padStart(length - 1, "0");
  if (text.length > length - 1) throw new Error(`USTAR field is too small for ${value}.`);
  buffer.fill(0, offset, offset + length);
  buffer.write(text, offset, "ascii");
  buffer[offset + length - 1] = 0;
}

function putText(buffer: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`USTAR path field is too small for ${value}.`);
  bytes.copy(buffer, offset);
}

function makeUstarHeader(entry: ArchiveEntry, bytes: number): Buffer {
  const header = Buffer.alloc(512);
  const normalized = entry.archivePath.replace(/\\/g, "/");
  const split = normalized.lastIndexOf("/");
  const name = split >= 0 ? normalized.slice(split + 1) : normalized;
  const prefix = split >= 0 ? normalized.slice(0, split) : "";
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) {
    throw new Error(`Release path is too long for USTAR: ${normalized}`);
  }
  putText(header, 0, 100, name);
  putOctal(header, 100, 8, entry.mode);
  putOctal(header, 108, 8, 0);
  putOctal(header, 116, 8, 0);
  putOctal(header, 124, 12, bytes);
  putOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = entry.kind === "directory" ? 0x35 : 0x30;
  putText(header, 257, 6, "ustar\0");
  putText(header, 263, 2, "00");
  putText(header, 265, 32, "root");
  putText(header, 297, 32, "root");
  putOctal(header, 329, 8, 0);
  putOctal(header, 337, 8, 0);
  putText(header, 345, 155, prefix);
  const checksum = header.reduce((total, value) => total + value, 0);
  putOctal(header, 148, 8, checksum);
  return header;
}

function createArchive(entries: ArchiveEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of sortPaths(entries)) {
    const bytes = entry.kind === "file" ? entry.bytes ?? Buffer.alloc(0) : Buffer.alloc(0);
    chunks.push(makeUstarHeader(entry, bytes.byteLength));
    if (entry.kind === "file") {
      chunks.push(bytes);
      const padding = (512 - (bytes.byteLength % 512)) % 512;
      if (padding > 0) chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableStringify(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return input;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function resolveKey(key: string | KeyObject, kind: "private" | "public"): KeyObject {
  if (typeof key !== "string") return key;
  return kind === "private" ? createPrivateKey(key) : createPublicKey(key);
}

function keyIdFor(publicKey: KeyObject): string {
  return createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
}

async function writeExclusive(filePath: string, data: string | Buffer): Promise<void> {
  await writeFile(filePath, data, { flag: "wx", mode: 0o644 });
}

async function packageEntries(workspaceRoot: string, packageDirectory: string, archiveRoot: string): Promise<{ entries: ArchiveEntry[]; record: PackageRecord }> {
  const packageManifestPath = path.join(packageDirectory, "package.json");
  const packageManifest = await readJson<{ name?: unknown; version?: unknown; files?: unknown }>(packageManifestPath);
  if (typeof packageManifest.name !== "string" || typeof packageManifest.version !== "string" || !Array.isArray(packageManifest.files)) {
    throw new Error(`Release package manifest is incomplete: ${packageManifestPath}`);
  }
  const packageArchiveRoot = path.posix.join(archiveRoot, packageManifest.name);
  const entries: ArchiveEntry[] = [{ archivePath: packageArchiveRoot, kind: "directory", mode: 0o755 }];
  const included = new Set<string>();
  const requested = ["package.json", ...packageManifest.files.filter((item): item is string => typeof item === "string")];
  for (const requestedPath of requested) {
    const source = path.join(packageDirectory, requestedPath);
    const identity = await stat(source).catch(() => undefined);
    if (!identity) throw new Error(`Release package file is missing: ${path.relative(workspaceRoot, source)}`);
    if (identity.isDirectory()) {
      const tree = await collectTree(packageDirectory, requestedPath);
      for (const entry of tree) {
        const archivePath = path.posix.join(packageArchiveRoot, entry.archivePath);
        if (included.has(archivePath)) continue;
        included.add(archivePath);
        entries.push({ ...entry, archivePath });
      }
    } else if (identity.isFile()) {
      const bytes = await readFile(source);
      const archivePath = path.posix.join(packageArchiveRoot, requestedPath.split(path.sep).join("/"));
      if (!included.has(archivePath)) {
        included.add(archivePath);
        entries.push({ archivePath, sourcePath: source, kind: "file", mode: identity.mode & 0o111 ? 0o755 : 0o644, bytes });
      }
    } else {
      throw new Error(`Release package file is not regular: ${path.relative(workspaceRoot, source)}`);
    }
  }
  return {
    entries,
    record: {
      name: packageManifest.name,
      version: packageManifest.version,
      path: packageArchiveRoot,
      files: sortPaths(entries).filter((entry) => entry.kind === "file").map((entry) => entry.archivePath),
    },
  };
}

export async function buildCliRelease(options: CliReleaseBuildOptions): Promise<CliReleaseBuildResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const outputDirectory = path.resolve(options.outputDirectory);
  const rootManifest = await readJson<{ packageManager?: unknown }>(path.join(workspaceRoot, "package.json"));
  const cliDirectory = await findWorkspacePackage(workspaceRoot, "@agentcargo/cli");
  const cliManifest = await readJson<{ version?: unknown; dependencies?: unknown }>(path.join(cliDirectory, "package.json"));
  if (typeof cliManifest.version !== "string") throw new Error("CLI package.json is missing a version.");
  const version = cliManifest.version;
  const dependencies = cliManifest.dependencies && typeof cliManifest.dependencies === "object"
    ? Object.keys(cliManifest.dependencies as Record<string, unknown>).filter((name) => name.startsWith(INTERNAL_PACKAGE_PREFIX))
    : [];
  const packageNames = ["@agentcargo/cli", ...dependencies.filter((name) => name !== "@agentcargo/cli")]
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const archiveRoot = `agentcargo-cli-${version}`;
  const entries: ArchiveEntry[] = [
    { archivePath: archiveRoot, kind: "directory", mode: 0o755 },
  ];
  const packages: PackageRecord[] = [];
  for (const packageName of packageNames) {
    const packageDirectory = packageName === "@agentcargo/cli" ? cliDirectory : await findWorkspacePackage(workspaceRoot, packageName);
    const packageResult = await packageEntries(workspaceRoot, packageDirectory, path.posix.join(archiveRoot, "packages"));
    entries.push(...packageResult.entries);
    packages.push(packageResult.record);
  }
  for (const fileName of ["LICENSE", "README.md", "pnpm-lock.yaml"]) {
    const source = path.join(workspaceRoot, fileName);
    const identity = await stat(source).catch(() => undefined);
    if (!identity?.isFile()) throw new Error(`Release root file is missing: ${fileName}`);
    entries.push({ archivePath: path.posix.join(archiveRoot, fileName), sourcePath: source, kind: "file", mode: 0o644, bytes: await readFile(source) });
  }
  const archiveBytes = createArchive(entries);
  const archiveDigest = sha256(archiveBytes);
  const archiveFile = `agentcargo-cli-${version}.tar`;
  const manifestFile = `agentcargo-cli-${version}.manifest.json`;
  const checksumFile = `${archiveFile}.sha256`;
  const signatureFile = `${manifestFile}.sig.json`;
  const fileRecords = sortPaths(entries)
    .filter((entry) => entry.kind === "file")
    .map((entry) => ({ path: entry.archivePath, bytes: entry.bytes?.byteLength ?? 0, sha256: sha256(entry.bytes ?? Buffer.alloc(0)), mode: entry.mode }));
  const privateKey = resolveKey(options.privateKey, "private");
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("CLI release signing requires an Ed25519 private key.");
  const keyId = options.keyId?.trim() || keyIdFor(createPublicKey(privateKey));
  const manifest: ReleaseManifest = {
    schemaVersion: RELEASE_SCHEMA,
    format: ARCHIVE_FORMAT,
    version,
    sourceCommit: options.sourceCommit?.trim() || DEFAULT_SOURCE_COMMIT,
    runtime: { node: ">=22", packageManager: typeof rootManifest.packageManager === "string" ? rootManifest.packageManager : "pnpm@11" },
    packages,
    archive: { file: archiveFile, bytes: archiveBytes.byteLength, sha256: `sha256:${archiveDigest}` },
    files: fileRecords,
    signature: { file: signatureFile, algorithm: "Ed25519", keyId },
  };
  const manifestText = stableStringify(manifest);
  const signature: SignatureEnvelope = {
    schemaVersion: SIGNATURE_SCHEMA,
    algorithm: "Ed25519",
    manifest: manifestFile,
    keyId,
    signature: sign(null, Buffer.from(manifestText), privateKey).toString("base64"),
  };
  await mkdir(outputDirectory, { recursive: true });
  for (const fileName of [archiveFile, manifestFile, checksumFile, signatureFile]) {
    if (await stat(path.join(outputDirectory, fileName)).catch(() => undefined)) {
      throw new Error(`Release output already exists: ${fileName}`);
    }
  }
  await writeExclusive(path.join(outputDirectory, archiveFile), archiveBytes);
  await writeExclusive(path.join(outputDirectory, manifestFile), manifestText);
  await writeExclusive(path.join(outputDirectory, checksumFile), `${manifest.archive.sha256.replace(/^sha256:/, "")}  ${archiveFile}\n`);
  await writeExclusive(path.join(outputDirectory, signatureFile), stableStringify(signature));
  return {
    version,
    archivePath: path.join(outputDirectory, archiveFile),
    manifestPath: path.join(outputDirectory, manifestFile),
    checksumPath: path.join(outputDirectory, checksumFile),
    signaturePath: path.join(outputDirectory, signatureFile),
    archiveDigest: manifest.archive.sha256,
    manifestDigest: `sha256:${sha256(Buffer.from(manifestText))}`,
    keyId,
    bytes: archiveBytes.byteLength,
  };
}

export async function verifyCliRelease(options: CliReleaseVerificationOptions): Promise<CliReleaseVerificationResult> {
  const manifestText = await readFile(options.manifestPath, "utf8");
  const manifest = JSON.parse(manifestText) as ReleaseManifest;
  if (manifest.schemaVersion !== RELEASE_SCHEMA || manifest.format !== ARCHIVE_FORMAT) throw new Error("Unsupported AgentCargo CLI release manifest.");
  const signature = await readJson<SignatureEnvelope>(options.signaturePath);
  if (
    signature.schemaVersion !== SIGNATURE_SCHEMA
    || signature.algorithm !== "Ed25519"
    || signature.manifest !== path.basename(options.manifestPath)
    || manifest.signature.file !== path.basename(options.signaturePath)
  ) {
    throw new Error("Unsupported AgentCargo CLI release signature.");
  }
  if (signature.keyId !== manifest.signature.keyId) throw new Error("CLI release signature key ID does not match the manifest.");
  const publicKey = resolveKey(options.publicKey, "public");
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("CLI release verification requires an Ed25519 public key.");
  if (!verify(null, Buffer.from(stableStringify(manifest)), publicKey, Buffer.from(signature.signature, "base64"))) {
    throw new Error("CLI release manifest signature is invalid.");
  }
  const archiveBytes = await readFile(options.archivePath);
  const digest = `sha256:${sha256(archiveBytes)}`;
  if (digest !== manifest.archive.sha256 || archiveBytes.byteLength !== manifest.archive.bytes) throw new Error("CLI release archive digest or byte count does not match the signed manifest.");
  return {
    version: manifest.version,
    archiveDigest: digest,
    manifestDigest: `sha256:${sha256(Buffer.from(stableStringify(manifest)))}`,
    keyId: signature.keyId,
    bytes: archiveBytes.byteLength,
  };
}

export { ARCHIVE_FORMAT, RELEASE_SCHEMA, SIGNATURE_SCHEMA, stableStringify };
