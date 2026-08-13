import { createHash, timingSafeEqual } from "node:crypto";
import {
  access,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  readdir,
  rm,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import type { ExtractArtifactOptions, ExtractArtifactResult, PackArtifactResult } from "./types.js";
import { validateSkillDirectory } from "./skill.js";

export const AGENTCARGO_ARTIFACT_FORMAT = "agentcargo-ustar-v1" as const;
export const AGENTCARGO_ARTIFACT_EXTENSION = ".agentcargo";

const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;
const MAX_FILE_COUNT = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 10 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 12 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;
const ZERO_BLOCK = Buffer.alloc(TAR_BLOCK_BYTES);
const EXECUTABLE_MODE = 0o755;
const REGULAR_MODE = 0o644;

interface ArtifactEntry {
  relativePath: string;
  absolutePath: string;
  size: number;
  mode: number;
  sourceStat: Awaited<ReturnType<typeof lstat>>;
}

interface ParsedHeader {
  path: string;
  size: number;
  mode: number;
}

export class AgentCargoArtifactError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentCargoArtifactError";
  }
}

export async function packSkillDirectory(
  inputPath: string,
  outputPath?: string,
): Promise<PackArtifactResult> {
  const validation = await validateSkillDirectory(inputPath);
  if (!validation.valid) {
    const errorCodes = validation.findings
      .filter((item) => item.severity === "error")
      .map((item) => item.code)
      .join(", ");
    throw new AgentCargoArtifactError(
      "SKILL_INVALID",
      `Skill validation failed${errorCodes ? `: ${errorCodes}` : "."}`,
    );
  }

  if (!validation.manifest) {
    throw new AgentCargoArtifactError(
      "AGENTCARGO_MANIFEST_REQUIRED",
      "agentcargo.yaml is required to create an AgentCargo artifact.",
    );
  }

  const root = validation.root;
  const manifest = validation.manifest;
  const resolvedOutput = path.resolve(
    outputPath ??
      path.join(path.dirname(root), `${manifest.name}-${manifest.version}${AGENTCARGO_ARTIFACT_EXTENSION}`),
  );

  if (isPathContainedBy(root, resolvedOutput)) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_OUTPUT_INSIDE_SKILL",
      "Artifact output must be outside the skill directory so it cannot package itself.",
    );
  }

  const outputParent = path.dirname(resolvedOutput);
  await mkdir(outputParent, { recursive: true });
  const [realRoot, realOutputParent] = await Promise.all([
    realpath(root),
    realpath(outputParent),
  ]);
  if (isPathContainedBy(realRoot, path.join(realOutputParent, path.basename(resolvedOutput)))) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_OUTPUT_INSIDE_SKILL",
      "Artifact output must not resolve inside the skill directory.",
    );
  }
  await assertPathDoesNotExist(resolvedOutput, "ARTIFACT_ALREADY_EXISTS");

  const entries = await buildEntries(root, validation.files);
  const temporaryPath = path.join(
    path.dirname(resolvedOutput),
    `.${path.basename(resolvedOutput)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const hash = createHash("sha256");
  let artifactHandle: FileHandle | undefined;

  try {
    artifactHandle = await open(temporaryPath, "wx", REGULAR_MODE);
    await artifactHandle.chmod(REGULAR_MODE);

    for (const entry of entries) {
      const header = createTarHeader(entry.relativePath, entry.size, entry.mode);
      await writeAndHash(artifactHandle, hash, header);
      await writeSourceFile(entry, artifactHandle, hash);

      const paddingBytes = tarPadding(entry.size);
      if (paddingBytes > 0) {
        await writeAndHash(artifactHandle, hash, Buffer.alloc(paddingBytes));
      }
    }

    await writeAndHash(artifactHandle, hash, Buffer.alloc(TAR_END_BYTES));
    await artifactHandle.sync();
    await artifactHandle.close();
    artifactHandle = undefined;

    try {
      await link(temporaryPath, resolvedOutput);
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new AgentCargoArtifactError(
          "ARTIFACT_ALREADY_EXISTS",
          `Refusing to overwrite existing artifact: ${resolvedOutput}`,
        );
      }
      throw error;
    }
    await unlink(temporaryPath);

    const artifactStat = await stat(resolvedOutput);
    return {
      format: AGENTCARGO_ARTIFACT_FORMAT,
      artifactPath: resolvedOutput,
      digest: `sha256:${hash.digest("hex")}`,
      artifactBytes: artifactStat.size,
      expandedBytes: entries.reduce((total, entry) => total + entry.size, 0),
      files: entries.map((entry) => entry.relativePath),
      name: manifest.name,
      version: manifest.version,
    };
  } catch (error) {
    if (artifactHandle) {
      await artifactHandle.close().catch(() => undefined);
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function extractArtifact(
  artifactPath: string,
  destinationPath: string,
  options: ExtractArtifactOptions = {},
): Promise<ExtractArtifactResult> {
  const resolvedArtifact = path.resolve(artifactPath);
  const resolvedDestination = path.resolve(destinationPath);
  const artifactStat = await stat(resolvedArtifact).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new AgentCargoArtifactError("ARTIFACT_NOT_FOUND", "Artifact does not exist.");
    }
    throw error;
  });

  if (!artifactStat.isFile()) {
    throw new AgentCargoArtifactError("ARTIFACT_NOT_FILE", "Artifact path must be a regular file.");
  }
  if (artifactStat.size > MAX_ARTIFACT_BYTES) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_TOO_LARGE",
      `Artifact exceeds the ${MAX_ARTIFACT_BYTES} byte limit.`,
    );
  }

  if (options.expectedDigest) {
    assertDigestFormat(options.expectedDigest);
    const actualDigest = await hashFile(resolvedArtifact);
    if (!digestsEqual(options.expectedDigest, actualDigest)) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_DIGEST_MISMATCH",
        `Expected ${options.expectedDigest} but received ${actualDigest}.`,
      );
    }
  }

  await ensureEmptyDirectory(resolvedDestination);
  const reader = await ArtifactReader.open(resolvedArtifact, artifactStat.size);
  const files: string[] = [];
  const createdFiles: string[] = [];
  const createdDirectories: string[] = [];
  const collisionKeys = new Set<string>();
  let expandedBytes = 0;
  let previousPath: string | undefined;

  try {
    while (true) {
      const block = await reader.readExactly(TAR_BLOCK_BYTES);
      if (isZeroBlock(block)) {
        const secondEndBlock = await reader.readExactly(TAR_BLOCK_BYTES);
        if (!isZeroBlock(secondEndBlock)) {
          throw new AgentCargoArtifactError(
            "ARTIFACT_END_INVALID",
            "Artifact must end with two zero blocks.",
          );
        }
        if (!reader.atEnd()) {
          throw new AgentCargoArtifactError(
            "ARTIFACT_TRAILING_DATA",
            "Artifact contains data after the canonical end marker.",
          );
        }
        break;
      }

      const header = parseTarHeader(block);
      const normalizedPath = normalizeArtifactPath(header.path);
      if (normalizedPath !== header.path) {
        throw new AgentCargoArtifactError(
          "ARTIFACT_PATH_NOT_CANONICAL",
          `Artifact path is not canonical: ${header.path}`,
        );
      }

      const collisionKey = normalizedPath.toLowerCase();
      if (collisionKeys.has(collisionKey)) {
        throw new AgentCargoArtifactError(
          "ARTIFACT_PATH_COLLISION",
          `Artifact contains a case-insensitive path collision: ${normalizedPath}`,
        );
      }
      collisionKeys.add(collisionKey);

      if (previousPath && compareUtf8(previousPath, normalizedPath) >= 0) {
        throw new AgentCargoArtifactError(
          "ARTIFACT_ORDER_INVALID",
          "Artifact entries must be unique and sorted by their UTF-8 path bytes.",
        );
      }
      previousPath = normalizedPath;

      if (files.length + 1 > MAX_FILE_COUNT) {
        throw new AgentCargoArtifactError(
          "ARTIFACT_TOO_MANY_FILES",
          `Artifact exceeds the ${MAX_FILE_COUNT} file limit.`,
        );
      }
      if (header.size > MAX_FILE_BYTES) {
        throw new AgentCargoArtifactError(
          "ARTIFACT_FILE_TOO_LARGE",
          `File '${normalizedPath}' exceeds the ${MAX_FILE_BYTES} byte limit.`,
        );
      }
      expandedBytes += header.size;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new AgentCargoArtifactError(
          "ARTIFACT_EXPANDED_TOO_LARGE",
          `Artifact exceeds the ${MAX_EXPANDED_BYTES} expanded byte limit.`,
        );
      }

      const outputPath = resolveContainedPath(resolvedDestination, normalizedPath);
      await ensureParentDirectories(
        resolvedDestination,
        path.dirname(outputPath),
        createdDirectories,
      );

      const outputHandle = await open(outputPath, "wx", header.mode);
      createdFiles.push(outputPath);
      try {
        let remaining = header.size;
        while (remaining > 0) {
          const chunk = await reader.readExactly(Math.min(remaining, STREAM_CHUNK_BYTES));
          await writeAll(outputHandle, chunk);
          remaining -= chunk.length;
        }
        await outputHandle.chmod(header.mode);
        await outputHandle.sync();
      } finally {
        await outputHandle.close();
      }

      const paddingBytes = tarPadding(header.size);
      if (paddingBytes > 0) {
        const padding = await reader.readExactly(paddingBytes);
        if (!isZeroBlock(padding)) {
          throw new AgentCargoArtifactError(
            "ARTIFACT_PADDING_INVALID",
            `File '${normalizedPath}' has non-zero padding.`,
          );
        }
      }

      files.push(normalizedPath);
    }

    if (!files.includes("SKILL.md") || !files.includes("agentcargo.yaml")) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_REQUIRED_FILE_MISSING",
        "Artifact must contain root SKILL.md and agentcargo.yaml files.",
      );
    }

    const digest = reader.digest();
    if (options.expectedDigest && !digestsEqual(options.expectedDigest, digest)) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_DIGEST_MISMATCH",
        `Expected ${options.expectedDigest} but received ${digest}.`,
      );
    }
    await reader.close();
    return {
      format: AGENTCARGO_ARTIFACT_FORMAT,
      artifactPath: resolvedArtifact,
      destinationPath: resolvedDestination,
      digest,
      artifactBytes: artifactStat.size,
      expandedBytes,
      files,
    };
  } catch (error) {
    await reader.close().catch(() => undefined);
    await cleanupExtraction(createdFiles, createdDirectories);
    throw error;
  }
}

export function normalizeArtifactPath(input: string): string {
  if (input.length === 0 || input.includes("\0")) {
    throw new AgentCargoArtifactError("ARTIFACT_PATH_INVALID", "Artifact path is empty or invalid.");
  }
  if (input.includes("\\")) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_PATH_SEPARATOR_INVALID",
      `Artifact paths must use forward slashes: ${input}`,
    );
  }
  if (input.startsWith("/") || input.startsWith("//") || /^[A-Za-z]:/.test(input)) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_PATH_ABSOLUTE",
      `Absolute artifact paths are not allowed: ${input}`,
    );
  }

  const normalized = input.normalize("NFC");
  if (normalized !== input) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_PATH_UNICODE_NOT_NORMALIZED",
      `Artifact path must use NFC Unicode normalization: ${input}`,
    );
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_PATH_TRAVERSAL",
      `Artifact path contains an empty, current, or parent segment: ${input}`,
    );
  }

  for (const segment of segments) {
    if (
      /[\u0000-\u001f<>:"|?*]/.test(segment) ||
      segment.endsWith(".") ||
      segment.endsWith(" ") ||
      Buffer.byteLength(segment, "utf8") > 255 ||
      isWindowsReservedSegment(segment)
    ) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_PATH_NOT_PORTABLE",
        `Artifact path is not portable across supported operating systems: ${input}`,
      );
    }
  }

  const encodedBytes = Buffer.byteLength(normalized, "utf8");
  if (encodedBytes > 255) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_PATH_TOO_LONG",
      `Artifact path exceeds the 255-byte USTAR limit: ${input}`,
    );
  }

  splitTarPath(normalized);
  return normalized;
}

export async function hashArtifact(artifactPath: string): Promise<string> {
  return hashFile(path.resolve(artifactPath));
}

async function buildEntries(root: string, validationFiles: string[]): Promise<ArtifactEntry[]> {
  const entries: ArtifactEntry[] = [];
  const collisionKeys = new Map<string, string>();
  const realRoot = await realpath(root);

  for (const candidate of validationFiles) {
    const relativePath = normalizeArtifactPath(candidate);
    const collisionKey = relativePath.toLowerCase();
    const previous = collisionKeys.get(collisionKey);
    if (previous) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_PATH_COLLISION",
        `Paths '${previous}' and '${relativePath}' collide on case-insensitive filesystems.`,
      );
    }
    collisionKeys.set(collisionKey, relativePath);

    const absolutePath = resolveContainedPath(root, relativePath);
    const beforeRealpath = await lstat(absolutePath);
    if (!beforeRealpath.isFile() || beforeRealpath.isSymbolicLink()) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_SOURCE_CHANGED",
        `Source changed after validation: ${relativePath}`,
      );
    }
    const realFilePath = await realpath(absolutePath);
    if (!isPathContainedBy(realRoot, realFilePath) || realFilePath === realRoot) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_SOURCE_OUTSIDE_ROOT",
        `Source resolves outside the skill root: ${relativePath}`,
      );
    }
    const fileStat = await lstat(absolutePath);
    if (
      !fileStat.isFile() ||
      fileStat.isSymbolicLink() ||
      !unchangedFile(beforeRealpath, fileStat)
    ) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_SOURCE_CHANGED",
        `Source changed after validation: ${relativePath}`,
      );
    }

    entries.push({
      relativePath,
      absolutePath,
      size: fileStat.size,
      mode: canonicalMode(relativePath),
      sourceStat: fileStat,
    });
  }

  entries.sort((left, right) => compareUtf8(left.relativePath, right.relativePath));
  return entries;
}

async function writeSourceFile(
  entry: ArtifactEntry,
  artifactHandle: FileHandle,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const before = await lstat(entry.absolutePath);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size !== entry.size ||
    !unchangedFile(entry.sourceStat, before)
  ) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_SOURCE_CHANGED",
      `Source changed while packing: ${entry.relativePath}`,
    );
  }

  const sourceHandle = await open(entry.absolutePath, "r");
  try {
    const opened = await sourceHandle.stat();
    if (!opened.isFile() || opened.size !== entry.size || !unchangedFile(before, opened)) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_SOURCE_CHANGED",
        `Source changed while packing: ${entry.relativePath}`,
      );
    }

    let offset = 0;
    while (offset < entry.size) {
      const length = Math.min(STREAM_CHUNK_BYTES, entry.size - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await sourceHandle.read(buffer, 0, length, offset);
      if (bytesRead !== length) {
        throw new AgentCargoArtifactError(
          "ARTIFACT_SOURCE_CHANGED",
          `Source changed while packing: ${entry.relativePath}`,
        );
      }
      const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
      await writeAndHash(artifactHandle, hash, chunk);
      offset += bytesRead;
    }

    const after = await sourceHandle.stat();
    if (after.size !== entry.size || !unchangedFile(opened, after)) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_SOURCE_CHANGED",
        `Source changed while packing: ${entry.relativePath}`,
      );
    }
  } finally {
    await sourceHandle.close();
  }
}

function createTarHeader(relativePath: string, size: number, mode: number): Buffer {
  const normalizedPath = normalizeArtifactPath(relativePath);
  const { name, prefix } = splitTarPath(normalizedPath);
  const header = Buffer.alloc(TAR_BLOCK_BYTES);

  writeUtf8(header, name, 0, 100);
  writeOctal(header, mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeUtf8(header, "ustar\0", 257, 6);
  writeUtf8(header, "00", 263, 2);
  writeOctal(header, 0, 329, 8);
  writeOctal(header, 0, 337, 8);
  if (prefix) writeUtf8(header, prefix, 345, 155);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = `${checksum.toString(8).padStart(6, "0")}\0 `;
  writeUtf8(header, checksumText, 148, 8);
  return header;
}

function parseTarHeader(header: Buffer): ParsedHeader {
  if (header.length !== TAR_BLOCK_BYTES) {
    throw new AgentCargoArtifactError("ARTIFACT_HEADER_TRUNCATED", "Artifact header is truncated.");
  }

  const storedChecksum = readOctal(header, 148, 8, "checksum");
  const checksumHeader = Buffer.from(header);
  checksumHeader.fill(0x20, 148, 156);
  const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
  if (storedChecksum !== actualChecksum) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_CHECKSUM_INVALID",
      "Artifact TAR header checksum is invalid.",
    );
  }

  const type = header[156];
  if (type !== 0x30) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_ENTRY_TYPE_UNSUPPORTED",
      "Only regular-file entries are supported in AgentCargo artifacts.",
    );
  }

  const name = readUtf8(header, 0, 100);
  const prefix = readUtf8(header, 345, 155);
  const entryPath = prefix ? `${prefix}/${name}` : name;
  const size = readOctal(header, 124, 12, "size");
  const mode = readOctal(header, 100, 8, "mode");

  if (mode !== canonicalMode(entryPath)) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_MODE_INVALID",
      `Artifact entry '${entryPath}' uses a non-canonical mode.`,
    );
  }

  const canonicalHeader = createTarHeader(entryPath, size, mode);
  if (!header.equals(canonicalHeader)) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_HEADER_NOT_CANONICAL",
      `Artifact entry '${entryPath}' has non-canonical metadata.`,
    );
  }

  return { path: entryPath, size, mode };
}

function splitTarPath(relativePath: string): { name: string; prefix?: string } {
  if (Buffer.byteLength(relativePath, "utf8") <= 100) {
    return { name: relativePath };
  }

  const slashIndexes: number[] = [];
  for (let index = 0; index < relativePath.length; index += 1) {
    if (relativePath[index] === "/") slashIndexes.push(index);
  }

  for (let index = slashIndexes.length - 1; index >= 0; index -= 1) {
    const slashIndex = slashIndexes[index];
    if (slashIndex === undefined) continue;
    const prefix = relativePath.slice(0, slashIndex);
    const name = relativePath.slice(slashIndex + 1);
    if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(name, "utf8") <= 100) {
      return { name, prefix };
    }
  }

  throw new AgentCargoArtifactError(
    "ARTIFACT_PATH_UNREPRESENTABLE",
    `Path cannot be represented in canonical USTAR: ${relativePath}`,
  );
}

function writeOctal(target: Buffer, value: number, offset: number, width: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AgentCargoArtifactError("ARTIFACT_NUMBER_INVALID", "Artifact numeric value is invalid.");
  }
  const text = `${value.toString(8).padStart(width - 1, "0")}\0`;
  if (text.length !== width) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_NUMBER_TOO_LARGE",
      "Artifact numeric value exceeds its canonical USTAR field.",
    );
  }
  writeUtf8(target, text, offset, width);
}

function readOctal(source: Buffer, offset: number, width: number, field: string): number {
  const raw = source.subarray(offset, offset + width).toString("ascii");
  const value = raw.replace(/[\0 ]+$/g, "");
  if (!/^[0-7]+$/.test(value)) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_NUMBER_INVALID",
      `Artifact ${field} field is not canonical octal.`,
    );
  }
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed)) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_NUMBER_INVALID",
      `Artifact ${field} field exceeds the supported range.`,
    );
  }
  return parsed;
}

function writeUtf8(target: Buffer, value: string, offset: number, width: number): void {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length > width) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_FIELD_TOO_LONG",
      "Artifact metadata exceeds its canonical USTAR field.",
    );
  }
  encoded.copy(target, offset);
}

function readUtf8(source: Buffer, offset: number, width: number): string {
  const field = source.subarray(offset, offset + width);
  const nullIndex = field.indexOf(0);
  return field.subarray(0, nullIndex === -1 ? field.length : nullIndex).toString("utf8");
}

function canonicalMode(relativePath: string): number {
  return relativePath.startsWith("scripts/") ? EXECUTABLE_MODE : REGULAR_MODE;
}

function tarPadding(size: number): number {
  return (TAR_BLOCK_BYTES - (size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function resolveContainedPath(root: string, relativePath: string): string {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  if (!isPathContainedBy(root, candidate) || candidate === root) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_PATH_ESCAPE",
      `Artifact path escapes the destination: ${relativePath}`,
    );
  }
  return candidate;
}

function isPathContainedBy(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function ensureEmptyDirectory(destination: string): Promise<void> {
  try {
    const destinationStat = await lstat(destination);
    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
      throw new AgentCargoArtifactError(
        "EXTRACTION_DESTINATION_INVALID",
        "Extraction destination must be a real directory, not a link or file.",
      );
    }
    if ((await readdir(destination)).length > 0) {
      throw new AgentCargoArtifactError(
        "EXTRACTION_DESTINATION_NOT_EMPTY",
        "Extraction destination must be empty.",
      );
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      await mkdir(destination, { recursive: true, mode: EXECUTABLE_MODE });
      return;
    }
    throw error;
  }
}

async function ensureParentDirectories(
  root: string,
  parent: string,
  createdDirectories: string[],
): Promise<void> {
  const relative = path.relative(root, parent);
  if (!relative) return;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_PATH_ESCAPE",
      "Artifact parent directory escapes the extraction destination.",
    );
  }

  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      await mkdir(current, { mode: EXECUTABLE_MODE });
      createdDirectories.push(current);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      const currentStat = await lstat(current);
      if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
        throw new AgentCargoArtifactError(
          "EXTRACTION_PARENT_INVALID",
          `Extraction parent is not a real directory: ${current}`,
        );
      }
    }
  }
}

async function cleanupExtraction(files: string[], directories: string[]): Promise<void> {
  for (const file of files.reverse()) {
    await unlink(file).catch(() => undefined);
  }
  for (const directory of directories.reverse()) {
    await rmdir(directory).catch(() => undefined);
  }
}

async function assertPathDoesNotExist(candidate: string, code: string): Promise<void> {
  try {
    await access(candidate);
    throw new AgentCargoArtifactError(code, `Path already exists: ${candidate}`);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function writeAndHash(
  handle: FileHandle,
  hash: ReturnType<typeof createHash>,
  buffer: Buffer,
): Promise<void> {
  await writeAll(handle, buffer);
  hash.update(buffer);
}

async function writeAll(handle: FileHandle, buffer: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer.subarray(offset));
    if (bytesWritten === 0) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_WRITE_FAILED",
        "Filesystem write made no progress.",
      );
    }
    offset += bytesWritten;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return `sha256:${hash.digest("hex")}`;
}

function assertDigestFormat(digest: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new AgentCargoArtifactError(
      "ARTIFACT_DIGEST_INVALID",
      "Expected digest must use the form sha256:<64 lowercase hexadecimal characters>.",
    );
  }
}

function digestsEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function isZeroBlock(buffer: Buffer): boolean {
  return buffer.every((byte) => byte === 0);
}

function sameFile(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<FileHandle["stat"]>>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function unchangedFile(
  left: Awaited<ReturnType<typeof lstat>> | Awaited<ReturnType<FileHandle["stat"]>>,
  right: Awaited<ReturnType<FileHandle["stat"]>>,
): boolean {
  return (
    sameFile(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function isWindowsReservedSegment(segment: string): boolean {
  const base = segment.split(".", 1)[0]?.toUpperCase();
  return Boolean(
    base &&
      (base === "CON" ||
        base === "PRN" ||
        base === "AUX" ||
        base === "NUL" ||
        /^COM[1-9]$/.test(base) ||
        /^LPT[1-9]$/.test(base)),
  );
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

class ArtifactReader {
  private position = 0;
  private readonly hash = createHash("sha256");
  private digestValue: string | undefined;

  private constructor(
    private readonly handle: FileHandle,
    private readonly size: number,
  ) {}

  static async open(filePath: string, size: number): Promise<ArtifactReader> {
    return new ArtifactReader(await open(filePath, "r"), size);
  }

  async readExactly(length: number): Promise<Buffer> {
    if (length < 0 || this.position + length > this.size) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_TRUNCATED",
        "Artifact ended before the current entry was complete.",
      );
    }

    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await this.handle.read(
        buffer,
        offset,
        length - offset,
        this.position,
      );
      if (bytesRead === 0) {
        throw new AgentCargoArtifactError(
          "ARTIFACT_TRUNCATED",
          "Artifact ended before the current entry was complete.",
        );
      }
      offset += bytesRead;
      this.position += bytesRead;
    }
    this.hash.update(buffer);
    return buffer;
  }

  atEnd(): boolean {
    return this.position === this.size;
  }

  digest(): string {
    if (!this.atEnd()) {
      throw new AgentCargoArtifactError(
        "ARTIFACT_NOT_FULLY_READ",
        "Cannot calculate the parsed artifact digest before reaching its end.",
      );
    }
    this.digestValue ??= `sha256:${this.hash.digest("hex")}`;
    return this.digestValue;
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}
