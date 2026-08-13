import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AdapterContext,
  AdapterPackage,
  HostAdapter,
  InstallPlan,
  InstallScope,
} from "@agentcargo/adapter-contract";
import { extractArtifact, normalizeArtifactPath, packSkillDirectory } from "./archive.js";
import { readLockfile, writeLockfileAtomic } from "./lockfile.js";
import { validateSkillDirectory } from "./skill.js";
import type {
  AgentCargoLockEntry,
  InstallLocalSkillResult,
  InstalledFileRecord,
} from "./types.js";

const STREAM_CHUNK_BYTES = 64 * 1024;

export interface InstallLocalSkillInput {
  sourcePath: string;
  adapter: HostAdapter;
  scope: InstallScope;
  context: AdapterContext;
  userDataRoot?: string;
  now?: () => Date;
}

export class AgentCargoInstallError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentCargoInstallError";
  }
}

export async function installLocalSkill(
  input: InstallLocalSkillInput,
): Promise<InstallLocalSkillResult> {
  const validation = await validateSkillDirectory(input.sourcePath);
  if (!validation.valid) {
    const codes = validation.findings
      .filter((finding) => finding.severity === "error")
      .map((finding) => finding.code)
      .join(", ");
    throw new AgentCargoInstallError(
      "INSTALL_SOURCE_INVALID",
      `Local skill validation failed${codes ? `: ${codes}` : "."}`,
    );
  }
  if (!validation.manifest) {
    throw new AgentCargoInstallError(
      "INSTALL_MANIFEST_REQUIRED",
      "agentcargo.yaml is required for AgentCargo installation.",
    );
  }

  if (!input.adapter.supportedScopes().includes(input.scope)) {
    throw new AgentCargoInstallError(
      "INSTALL_SCOPE_UNSUPPORTED",
      `Adapter '${input.adapter.id}' does not support the '${input.scope}' scope.`,
    );
  }

  const adapterPackage: AdapterPackage = {
    name: validation.manifest.name,
    version: validation.manifest.version,
    files: validation.files,
    ...(validation.manifest.compatibility
      ? { compatibility: validation.manifest.compatibility }
      : {}),
  };
  const adapterInput = {
    scope: input.scope,
    context: input.context,
    package: adapterPackage,
  };
  const adapterFindings = await input.adapter.validatePackage(adapterInput);
  const blockingFindings = adapterFindings.filter((finding) => finding.severity === "error");
  if (blockingFindings.length > 0) {
    throw new AgentCargoInstallError(
      blockingFindings[0]?.code ?? "INSTALL_ADAPTER_VALIDATION_FAILED",
      blockingFindings.map((finding) => finding.message).join(" "),
    );
  }

  const plan = await input.adapter.planInstall(adapterInput);
  await validateInstallPlan(plan, input.adapter, input.scope, adapterPackage.name);

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "agentcargo-install-"));
  const artifactPath = path.join(
    temporaryRoot,
    `${adapterPackage.name}-${adapterPackage.version}-${randomUUID()}.agentcargo`,
  );
  let operationLock: Awaited<ReturnType<typeof acquireOperationLock>> | undefined;
  let stagingRoot: string | undefined;
  let destinationCommitted = false;

  try {
    const packed = await packSkillDirectory(validation.root, artifactPath);
    const lockfilePath = await resolveLockfilePath(input, plan);
    const operationRoot = path.dirname(lockfilePath);
    operationLock = await acquireOperationLock(operationRoot);

    const lockfile = await readLockfile(lockfilePath);
    const existingEntry = lockfile.packages.find(
      (entry) =>
        entry.agent === input.adapter.id &&
        entry.scope === input.scope &&
        entry.package === adapterPackage.name,
    );
    if (existingEntry) {
      throw new AgentCargoInstallError(
        "INSTALL_ALREADY_RECORDED",
        `${adapterPackage.name} is already recorded for ${input.adapter.id} ${input.scope} scope.`,
      );
    }

    await ensureRealDirectoriesWithin(plan.scopeRoot, plan.skillsRoot);
    await assertDestinationMissing(plan.destination);
    stagingRoot = await mkdtemp(path.join(plan.skillsRoot, ".agentcargo-stage-"));
    const stagedPackageRoot = path.join(stagingRoot, "package");

    await extractArtifact(packed.artifactPath, stagedPackageRoot, {
      expectedDigest: packed.digest,
    });
    await input.adapter.prepareStagedPackage({
      plan,
      stagedPackageRoot,
      package: adapterPackage,
    });

    const inventory = await inventoryInstalledTree(stagedPackageRoot);
    if (!inventory.files.some((file) => file.path === "SKILL.md")) {
      throw new AgentCargoInstallError(
        "INSTALL_STAGED_SKILL_INVALID",
        "The staged host package does not contain SKILL.md.",
      );
    }

    const installedAt = (input.now?.() ?? new Date()).toISOString();
    const entry: AgentCargoLockEntry = {
      package: adapterPackage.name,
      version: adapterPackage.version,
      digest: packed.digest,
      agent: input.adapter.id,
      adapter_version: input.adapter.adapterVersion,
      scope: input.scope,
      destination: plan.relativeDestination,
      installed_at: installedAt,
      files_digest: inventory.filesDigest,
      files: inventory.files,
      source: { type: "local" },
    };
    const nextLockfile = {
      lockfile_version: 1 as const,
      packages: [...lockfile.packages, entry],
    };

    await assertDestinationMissing(plan.destination);
    try {
      await rename(stagedPackageRoot, plan.destination);
      destinationCommitted = true;
      await writeLockfileAtomic(lockfilePath, nextLockfile);
    } catch (error) {
      if (destinationCommitted) {
        try {
          await rename(plan.destination, stagedPackageRoot);
          destinationCommitted = false;
        } catch (rollbackError) {
          throw new AgentCargoInstallError(
            "INSTALL_ROLLBACK_FAILED",
            `Installation failed and the destination could not be rolled back: ${plan.destination}`,
            { installError: error, rollbackError },
          );
        }
      }
      if (isNodeError(error) && (error.code === "EEXIST" || error.code === "ENOTEMPTY")) {
        throw new AgentCargoInstallError(
          "INSTALL_DESTINATION_EXISTS",
          `Refusing to replace an existing destination: ${plan.destination}`,
          error,
        );
      }
      throw error;
    }

    return {
      package: adapterPackage.name,
      version: adapterPackage.version,
      digest: packed.digest,
      agent: input.adapter.id,
      adapterVersion: input.adapter.adapterVersion,
      scope: input.scope,
      destination: plan.destination,
      lockfilePath,
      filesDigest: inventory.filesDigest,
      files: inventory.files,
    };
  } finally {
    if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    if (operationLock) await operationLock.release().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function defaultUserDataRoot(userHome: string, platform = process.platform): string {
  const resolvedHome = path.resolve(userHome);
  if (platform === "darwin") {
    return path.join(resolvedHome, "Library", "Application Support", "AgentCargo");
  }
  if (platform === "win32") {
    return path.join(resolvedHome, "AppData", "Local", "AgentCargo");
  }
  return path.join(resolvedHome, ".local", "share", "agentcargo");
}

async function resolveLockfilePath(
  input: InstallLocalSkillInput,
  plan: InstallPlan,
): Promise<string> {
  if (input.scope === "project") return path.join(plan.scopeRoot, "agentcargo.lock");

  const realUserHome = await realpath(input.context.userHome).catch((error: unknown) => {
    throw new AgentCargoInstallError(
      "INSTALL_USER_HOME_INVALID",
      `User home does not exist: ${path.resolve(input.context.userHome)}`,
      error,
    );
  });
  const requestedHome = path.resolve(input.context.userHome);
  const requestedUserDataRoot = path.resolve(
    input.userDataRoot ?? defaultUserDataRoot(requestedHome),
  );
  const relativeUserDataRoot = path.relative(requestedHome, requestedUserDataRoot);
  if (escapesRelativeRoot(relativeUserDataRoot)) {
    throw new AgentCargoInstallError(
      "INSTALL_USER_DATA_ROOT_ESCAPE",
      `AgentCargo user data root must remain beneath the user home: ${requestedUserDataRoot}`,
    );
  }
  const userDataRoot = path.join(realUserHome, relativeUserDataRoot);
  await ensureRealDirectoriesWithin(realUserHome, userDataRoot);
  return path.join(userDataRoot, "agentcargo.lock");
}

async function validateInstallPlan(
  plan: InstallPlan,
  adapter: HostAdapter,
  scope: InstallScope,
  packageName: string,
): Promise<void> {
  if (plan.host !== adapter.id || plan.scope !== scope || plan.packageName !== packageName) {
    throw new AgentCargoInstallError(
      "INSTALL_PLAN_IDENTITY_INVALID",
      "Host adapter returned an installation plan for a different package, host, or scope.",
    );
  }

  const canonicalScopeRoot = await realpath(plan.scopeRoot).catch((error: unknown) => {
    throw new AgentCargoInstallError(
      "INSTALL_SCOPE_ROOT_INVALID",
      `Installation scope root does not exist: ${plan.scopeRoot}`,
      error,
    );
  });
  if (path.resolve(plan.scopeRoot) !== canonicalScopeRoot) {
    throw new AgentCargoInstallError(
      "INSTALL_SCOPE_ROOT_NOT_CANONICAL",
      "Host adapter scope root must be a canonical real path.",
    );
  }

  assertContained(canonicalScopeRoot, plan.skillsRoot, "INSTALL_SKILLS_ROOT_ESCAPE");
  assertContained(plan.skillsRoot, plan.destination, "INSTALL_DESTINATION_ESCAPE");
  const relativeDestination = normalizeArtifactPath(plan.relativeDestination);
  if (path.resolve(canonicalScopeRoot, ...relativeDestination.split("/")) !== path.resolve(plan.destination)) {
    throw new AgentCargoInstallError(
      "INSTALL_RELATIVE_DESTINATION_INVALID",
      "Host adapter relative destination does not match its absolute destination.",
    );
  }
}

async function ensureRealDirectoriesWithin(root: string, target: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  const resolvedTarget = path.resolve(target);
  assertContained(canonicalRoot, resolvedTarget, "INSTALL_DIRECTORY_ESCAPE", true);

  const relative = path.relative(canonicalRoot, resolvedTarget);
  let current = canonicalRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      await mkdir(current, { mode: 0o755 });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
    const currentStat = await lstat(current);
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
      throw new AgentCargoInstallError(
        "INSTALL_DIRECTORY_NOT_REAL",
        `Installation path component must be a real directory: ${current}`,
      );
    }
  }

  const canonicalTarget = await realpath(resolvedTarget);
  assertContained(canonicalRoot, canonicalTarget, "INSTALL_DIRECTORY_ESCAPE", true);
}

function assertContained(root: string, candidate: string, code: string, allowEqual = false): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  const contained = !escapesRelativeRoot(relative);
  if (!contained || (!allowEqual && relative === "")) {
    throw new AgentCargoInstallError(code, `Installation path escapes its allowed root: ${candidate}`);
  }
}

async function assertDestinationMissing(destination: string): Promise<void> {
  try {
    await lstat(destination);
    throw new AgentCargoInstallError(
      "INSTALL_DESTINATION_EXISTS",
      `Refusing to replace an existing destination: ${destination}`,
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function acquireOperationLock(parent: string): Promise<{ release(): Promise<void> }> {
  const lockPath = path.join(parent, ".agentcargo-install.lock");
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new AgentCargoInstallError(
        "INSTALL_OPERATION_LOCKED",
        `Another AgentCargo installation is active for this scope: ${parent}`,
      );
    }
    throw error;
  }
  try {
    await handle.chmod(0o600);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }
  return {
    async release(): Promise<void> {
      await handle.close();
      await unlink(lockPath);
    },
  };
}

async function inventoryInstalledTree(
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
        throw new AgentCargoInstallError(
          "INSTALL_STAGED_LINK_UNSUPPORTED",
          `Staged package contains a link: ${relativePath}`,
        );
      }
      if (fileStat.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!fileStat.isFile()) {
        throw new AgentCargoInstallError(
          "INSTALL_STAGED_SPECIAL_FILE",
          `Staged package contains a special file: ${relativePath}`,
        );
      }

      const mode = canonicalInstalledMode(relativePath, fileStat.mode);
      files.push({
        path: relativePath,
        digest: await hashRegularFile(absolutePath),
        bytes: fileStat.size,
        mode,
      });
    }
  }

  await visit(root, "");
  files.sort((left, right) => compareUtf8(left.path, right.path));
  const aggregate = createHash("sha256");
  for (const file of files) {
    aggregate.update(
      JSON.stringify([file.path, file.digest, file.bytes, file.mode]),
      "utf8",
    );
    aggregate.update("\n", "utf8");
  }
  return { files, filesDigest: `sha256:${aggregate.digest("hex")}` };
}

async function hashRegularFile(filePath: string): Promise<string> {
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

function canonicalInstalledMode(relativePath: string, sourceMode: number): number {
  if (process.platform === "win32") return relativePath.startsWith("scripts/") ? 0o755 : 0o644;
  return sourceMode & 0o111 ? 0o755 : 0o644;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function escapesRelativeRoot(relative: string): boolean {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
