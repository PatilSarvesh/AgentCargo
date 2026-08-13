import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { normalizeArtifactPath } from "./archive.js";
import type { InstalledFileRecord } from "./types.js";

const STREAM_CHUNK_BYTES = 64 * 1024;

export class AgentCargoFilesystemError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly relativePath?: string,
  ) {
    super(message);
    this.name = "AgentCargoFilesystemError";
  }
}

export async function inventoryRegularTree(
  root: string,
): Promise<{ files: InstalledFileRecord[]; filesDigest: string }> {
  const files: InstalledFileRecord[] = [];

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      normalizeArtifactPath(relativePath);
      const absolutePath = path.join(directory, entry.name);
      const fileStat = await lstat(absolutePath);
      if (fileStat.isSymbolicLink()) {
        throw new AgentCargoFilesystemError(
          "FILESYSTEM_LINK_UNSUPPORTED",
          `Managed tree contains a link: ${relativePath}`,
          relativePath,
        );
      }
      if (fileStat.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!fileStat.isFile()) {
        throw new AgentCargoFilesystemError(
          "FILESYSTEM_SPECIAL_FILE_UNSUPPORTED",
          `Managed tree contains a special file: ${relativePath}`,
          relativePath,
        );
      }
      files.push(await receiptForRegularFile(absolutePath, relativePath, fileStat));
    }
  }

  await visit(root, "");
  files.sort((left, right) => compareUtf8(left.path, right.path));
  return { files, filesDigest: digestFileRecords(files) };
}

export async function receiptForRegularFile(
  absolutePath: string,
  relativePath: string,
  suppliedStat?: Awaited<ReturnType<typeof lstat>>,
): Promise<InstalledFileRecord> {
  const beforeStat = suppliedStat ?? await lstat(absolutePath);
  if (!beforeStat.isFile() || beforeStat.isSymbolicLink()) {
    throw new AgentCargoFilesystemError(
      "FILESYSTEM_NOT_REGULAR_FILE",
      `Expected a regular file: ${relativePath}`,
      relativePath,
    );
  }

  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(absolutePath, constants.O_RDONLY | noFollow);
  try {
    const openedStat = await handle.stat();
    assertSameFile(beforeStat, openedStat, relativePath, "opening");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const afterStat = await handle.stat();
    assertSameFile(openedStat, afterStat, relativePath, "reading");
    return {
      path: relativePath,
      digest: `sha256:${hash.digest("hex")}`,
      bytes: afterStat.size,
      mode: canonicalInstalledMode(relativePath, afterStat.mode),
    };
  } finally {
    await handle.close();
  }
}

export function digestFileRecords(files: readonly InstalledFileRecord[]): string {
  const aggregate = createHash("sha256");
  for (const file of files) {
    aggregate.update(JSON.stringify([file.path, file.digest, file.bytes, file.mode]), "utf8");
    aggregate.update("\n", "utf8");
  }
  return `sha256:${aggregate.digest("hex")}`;
}

export function canonicalInstalledMode(relativePath: string, sourceMode: number): number {
  if (process.platform === "win32") return relativePath.startsWith("scripts/") ? 0o755 : 0o644;
  return sourceMode & 0o111 ? 0o755 : 0o644;
}

export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function assertSameFile(
  before: Awaited<ReturnType<typeof lstat>>,
  after: Awaited<ReturnType<typeof lstat>>,
  relativePath: string,
  phase: string,
): void {
  if (
    !after.isFile() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new AgentCargoFilesystemError(
      "FILESYSTEM_FILE_CHANGED",
      `File changed while ${phase}: ${relativePath}`,
      relativePath,
    );
  }
}
