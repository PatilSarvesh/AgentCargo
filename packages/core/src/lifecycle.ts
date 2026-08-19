import { randomUUID } from "node:crypto";
import {
  lstat,
  realpath,
  readdir,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type {
  AdapterContext,
  HostAdapter,
  InstallScope,
} from "@agentcargo/adapter-contract";
import {
  AgentCargoFilesystemError,
  compareUtf8,
  digestFileRecords,
  receiptForRegularFile,
} from "./filesystem.js";
import { normalizeArtifactPath } from "./archive.js";
import { defaultUserDataRoot } from "./install.js";
import {
  readLockfile,
  removeLockfileAtomic,
  writeLockfileAtomic,
} from "./lockfile.js";
import {
  acquireOperationLock,
  inspectOperationLock,
} from "./operation-lock.js";
import {
  lockEntriesEqual,
  readRollbackState,
  rollbackStatePath,
  writeRollbackStateAtomic,
} from "./rollback-state.js";
import type {
  AgentCargoLockEntry,
  DoctorFinding,
  DoctorResult,
  InstallationInspection,
  InstallationListResult,
  InvalidInstalledPath,
  RemoveInstallationResult,
} from "./types.js";

export interface LifecycleScopeInput {
  adapter: HostAdapter;
  scope: InstallScope;
  context: AdapterContext;
  userDataRoot?: string;
}

export interface RemoveInstallationInput extends LifecycleScopeInput {
  package: string;
  force?: boolean;
}

export interface LifecyclePaths {
  scopeRoot: string;
  skillsRoot: string;
  lockfilePath: string;
}

export class AgentCargoLifecycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentCargoLifecycleError";
  }
}

export async function listInstallations(
  input: LifecycleScopeInput,
): Promise<InstallationListResult> {
  const paths = await resolveLifecyclePaths(input);
  const lockfile = await readLockfile(paths.lockfilePath);
  const entries = lockfile.packages.filter(
    (entry) => entry.agent === input.adapter.id && entry.scope === input.scope,
  );
  const packages: InstallationInspection[] = [];
  for (const entry of entries) {
    packages.push(await inspectEntry(entry, paths));
  }
  return {
    agent: input.adapter.id,
    scope: input.scope,
    ...paths,
    packages,
  };
}

export async function removeInstallation(
  input: RemoveInstallationInput,
): Promise<RemoveInstallationResult> {
  const paths = await resolveLifecyclePaths(input);
  const initialLockfile = await readLockfile(paths.lockfilePath);
  const initialEntry = findEntry(initialLockfile.packages, input);
  if (!initialEntry) {
    throw new AgentCargoLifecycleError(
      "REMOVE_NOT_INSTALLED",
      `${input.package} is not recorded for ${input.adapter.id} ${input.scope} scope.`,
    );
  }

  const operationLock = await acquireOperationLock(
    path.dirname(paths.lockfilePath),
    "REMOVE_OPERATION_LOCKED",
  );
  let removalStage: string | undefined;
  let lockCommitted = false;
  try {
    const lockfile = await readLockfile(paths.lockfilePath);
    const entry = findEntry(lockfile.packages, input);
    if (!entry) {
      throw new AgentCargoLifecycleError(
        "REMOVE_NOT_INSTALLED",
        `${input.package} is no longer recorded for ${input.adapter.id} ${input.scope} scope.`,
      );
    }

    const inspection = await inspectEntry(entry, paths);
    assertRemovable(inspection, input.force === true);
    const destination = inspection.destination;
    let preservedPaths = [...inspection.untrackedPaths];
    const statePath = rollbackStatePath(paths.lockfilePath);
    const rollbackState = await readRollbackState(statePath);
    const rollbackRecord = rollbackState.packages.find((record) =>
      record.current.package === entry.package
      && record.current.agent === entry.agent
      && record.current.scope === entry.scope
    );
    let rollbackBackup: string | undefined;
    if (rollbackRecord) {
      if (!lockEntriesEqual(rollbackRecord.current, entry)) {
        throw new AgentCargoLifecycleError(
          "REMOVE_ROLLBACK_STATE_MISMATCH",
          `Rollback state does not match the active lockfile entry for ${entry.package}.`,
        );
      }
      rollbackBackup = path.resolve(paths.scopeRoot, ...rollbackRecord.backup_destination.split("/"));
      assertContained(paths.skillsRoot, rollbackBackup, "REMOVE_ROLLBACK_DESTINATION_INVALID");
      const backupInspection = await inspectEntry(rollbackRecord.previous, paths, rollbackBackup);
      if (backupInspection.state !== "clean") {
        throw new AgentCargoLifecycleError(
          `REMOVE_ROLLBACK_${backupInspection.state.toUpperCase()}`,
          `Retained rollback files for ${entry.package} are ${backupInspection.state}.`,
        );
      }
    }

    if (inspection.state !== "missing") {
      removalStage = path.join(paths.skillsRoot, `.agentcargo-remove-${randomUUID()}`);
      await rename(destination, removalStage);

      const stagedInspection = await inspectEntry(entry, paths, removalStage);
      preservedPaths = [...stagedInspection.untrackedPaths];
      try {
        assertRemovable(stagedInspection, input.force === true);
      } catch (error) {
        await rename(removalStage, destination);
        removalStage = undefined;
        throw error;
      }
    }

    const nextPackages = lockfile.packages.filter((candidate) => candidate !== entry);
    const nextRollbackState = {
      rollback_state_version: 1 as const,
      packages: rollbackRecord
        ? rollbackState.packages.filter((candidate) => candidate !== rollbackRecord)
        : rollbackState.packages,
    };
    try {
      if (nextPackages.length === 0) {
        await removeLockfileAtomic(paths.lockfilePath);
      } else {
        await writeLockfileAtomic(paths.lockfilePath, {
          lockfile_version: 1,
          packages: nextPackages,
        });
      }
      lockCommitted = true;
      await writeRollbackStateAtomic(statePath, nextRollbackState);
    } catch (error) {
      let recoveryError: unknown;
      if (removalStage) {
        try {
          await rename(removalStage, destination);
          removalStage = undefined;
        } catch (candidateError) {
          recoveryError = candidateError;
        }
      }
      if (lockCommitted) {
        try {
          await writeLockfileAtomic(paths.lockfilePath, lockfile);
          lockCommitted = false;
        } catch (candidateError) {
          recoveryError ??= candidateError;
        }
      }
      if (recoveryError) {
        throw new AgentCargoLifecycleError(
          "REMOVE_ROLLBACK_FAILED",
          `Removal failed and the prior files or lockfile could not be fully restored: ${destination}`,
          { removeError: error, rollbackError: recoveryError },
        );
      }
      throw error;
    }

    let preservedUntracked = false;
    if (removalStage) {
      try {
        await removeOwnedFiles(removalStage, entry);
        preservedUntracked = await restoreIfNotEmpty(removalStage, destination);
        removalStage = undefined;
      } catch (error) {
        throw new AgentCargoLifecycleError(
          "REMOVE_CLEANUP_INCOMPLETE",
          `The lockfile was updated, but cleanup is incomplete. Run agentcargo doctor: ${removalStage}`,
          error,
        );
      }
    }
    if (rollbackRecord && rollbackBackup) {
      try {
        await removeCleanReceiptTree(rollbackRecord.previous, paths, rollbackBackup);
      } catch (error) {
        throw new AgentCargoLifecycleError(
          "REMOVE_CLEANUP_INCOMPLETE",
          `The installation was removed, but retained rollback cleanup is incomplete. Run agentcargo doctor: ${rollbackBackup}`,
          error,
        );
      }
    }

    return {
      package: entry.package,
      version: entry.version,
      agent: entry.agent,
      scope: entry.scope,
      destination,
      lockfilePath: paths.lockfilePath,
      previousState: inspection.state,
      preservedUntracked,
      preservedPaths: preservedUntracked ? preservedPaths : [],
    };
  } finally {
    await operationLock.release().catch((releaseError: unknown) => {
      if (!lockCommitted) throw releaseError;
    });
  }
}

export async function doctorInstallations(input: LifecycleScopeInput): Promise<DoctorResult> {
  const findings: DoctorFinding[] = [];
  const health = await input.adapter.healthCheck({ scope: input.scope, context: input.context });
  findings.push(...health.findings);

  let paths: LifecyclePaths;
  try {
    paths = await resolveLifecyclePaths(input);
  } catch (error) {
    findings.push({
      code: errorCode(error, "DOCTOR_SCOPE_INVALID"),
      severity: "error",
      message: errorMessage(error),
    });
    return {
      agent: input.adapter.id,
      scope: input.scope,
      healthy: false,
      installations: [],
      findings,
    };
  }

  const operation = await inspectOperationLock(path.dirname(paths.lockfilePath));
  if (operation.state !== "absent") {
    const code = operation.state === "stale"
      ? "DOCTOR_STALE_OPERATION_LOCK"
      : operation.state === "active"
        ? "DOCTOR_ACTIVE_OPERATION"
        : "DOCTOR_INVALID_OPERATION_LOCK";
    findings.push({
      code,
      severity: operation.state === "active" ? "warning" : "error",
      message: operation.state === "active"
        ? `An AgentCargo operation owned by process ${operation.pid} is active.`
        : operation.reason ?? `The operation lock is ${operation.state}.`,
      path: operation.path,
    });
  }

  let installations: InstallationInspection[] = [];
  try {
    installations = (await listInstallations(input)).packages;
    for (const installation of installations) {
      if (installation.state !== "clean") {
        findings.push({
          code: `DOCTOR_INSTALLATION_${installation.state.toUpperCase()}`,
          severity: installation.state === "invalid" ? "error" : "warning",
          message: `${installation.package} installation state is ${installation.state}.`,
          path: installation.destination,
        });
      }
    }
  } catch (error) {
    findings.push({
      code: errorCode(error, "DOCTOR_LOCKFILE_INVALID"),
      severity: "error",
      message: errorMessage(error),
      path: paths.lockfilePath,
    });
  }

  const referencedRollbackPaths = new Set<string>();
  try {
    const [lockfile, rollbackState] = await Promise.all([
      readLockfile(paths.lockfilePath),
      readRollbackState(rollbackStatePath(paths.lockfilePath)),
    ]);
    for (const record of rollbackState.packages.filter((candidate) =>
      candidate.current.agent === input.adapter.id && candidate.current.scope === input.scope
    )) {
      const backup = path.resolve(paths.scopeRoot, ...record.backup_destination.split("/"));
      try {
        assertContained(paths.skillsRoot, backup, "DOCTOR_ROLLBACK_DESTINATION_INVALID");
        referencedRollbackPaths.add(backup);
      } catch (error) {
        findings.push({
          code: errorCode(error, "DOCTOR_ROLLBACK_DESTINATION_INVALID"),
          severity: "error",
          message: errorMessage(error),
          path: backup,
        });
        continue;
      }
      const current = lockfile.packages.find((entry) =>
        entry.package === record.current.package
        && entry.agent === record.current.agent
        && entry.scope === record.current.scope
      );
      if (!current || !lockEntriesEqual(current, record.current)) {
        findings.push({
          code: "DOCTOR_ROLLBACK_STATE_MISMATCH",
          severity: "error",
          message: `Rollback state does not match the active lockfile entry for ${record.current.package}.`,
          path: rollbackStatePath(paths.lockfilePath),
        });
        continue;
      }
      const backupInspection = await inspectEntry(record.previous, paths, backup);
      if (backupInspection.state !== "clean") {
        findings.push({
          code: `DOCTOR_ROLLBACK_${backupInspection.state.toUpperCase()}`,
          severity: backupInspection.state === "invalid" ? "error" : "warning",
          message: `Retained rollback files for ${record.current.package} are ${backupInspection.state}.`,
          path: backup,
        });
      }
    }
  } catch (error) {
    findings.push({
      code: errorCode(error, "DOCTOR_ROLLBACK_STATE_INVALID"),
      severity: "error",
      message: errorMessage(error),
      path: rollbackStatePath(paths.lockfilePath),
    });
  }

  findings.push(...await findAbandonedOperations(paths.skillsRoot, referencedRollbackPaths));
  findings.sort((left, right) =>
    left.code.localeCompare(right.code) || (left.path ?? "").localeCompare(right.path ?? ""),
  );
  return {
    agent: input.adapter.id,
    scope: input.scope,
    healthy: health.healthy && findings.length === 0,
    ...paths,
    installations,
    findings,
  };
}

export async function resolveLifecyclePaths(input: LifecycleScopeInput): Promise<LifecyclePaths> {
  if (!input.adapter.supportedScopes().includes(input.scope)) {
    throw new AgentCargoLifecycleError(
      "LIFECYCLE_SCOPE_UNSUPPORTED",
      `Adapter '${input.adapter.id}' does not support the '${input.scope}' scope.`,
    );
  }
  const placeholder = {
    name: "agentcargo-health-check",
    version: "0.0.0",
    files: ["SKILL.md"],
  };
  const destination = await input.adapter.resolveDestination({
    scope: input.scope,
    context: input.context,
    package: placeholder,
  });
  assertContained(destination.scopeRoot, destination.skillsRoot, "LIFECYCLE_SKILLS_ROOT_ESCAPE");
  await assertRealExistingPath(destination.scopeRoot, destination.skillsRoot);

  if (input.scope === "project") {
    return {
      scopeRoot: destination.scopeRoot,
      skillsRoot: destination.skillsRoot,
      lockfilePath: path.join(destination.scopeRoot, "agentcargo.lock"),
    };
  }

  const requestedHome = path.resolve(input.context.userHome);
  const realUserHome = await realpath(requestedHome);
  const requestedDataRoot = path.resolve(input.userDataRoot ?? defaultUserDataRoot(requestedHome));
  const relativeDataRoot = path.relative(requestedHome, requestedDataRoot);
  if (escapesRelativeRoot(relativeDataRoot)) {
    throw new AgentCargoLifecycleError(
      "LIFECYCLE_USER_DATA_ROOT_ESCAPE",
      `AgentCargo user data root must remain beneath the user home: ${requestedDataRoot}`,
    );
  }
  const userDataRoot = path.join(realUserHome, relativeDataRoot);
  const dataStat = await lstat(userDataRoot).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (dataStat && (!dataStat.isDirectory() || dataStat.isSymbolicLink())) {
    throw new AgentCargoLifecycleError(
      "LIFECYCLE_USER_DATA_ROOT_INVALID",
      `AgentCargo user data root must be a real directory: ${userDataRoot}`,
    );
  }
  if (dataStat && await realpath(userDataRoot) !== userDataRoot) {
    throw new AgentCargoLifecycleError(
      "LIFECYCLE_USER_DATA_ROOT_NOT_CANONICAL",
      `AgentCargo user data root contains a linked path component: ${userDataRoot}`,
    );
  }
  return {
    scopeRoot: destination.scopeRoot,
    skillsRoot: destination.skillsRoot,
    lockfilePath: path.join(userDataRoot, "agentcargo.lock"),
  };
}

export async function inspectEntry(
  entry: AgentCargoLockEntry,
  paths: LifecyclePaths,
  destinationOverride?: string,
): Promise<InstallationInspection> {
  const destination = destinationOverride ?? path.resolve(paths.scopeRoot, ...entry.destination.split("/"));
  if (!destinationOverride) {
    assertContained(paths.skillsRoot, destination, "LIFECYCLE_DESTINATION_ESCAPE");
  } else {
    assertContained(paths.skillsRoot, destinationOverride, "LIFECYCLE_STAGE_ESCAPE");
  }

  const missingFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const untrackedPaths: string[] = [];
  const invalidPaths: InvalidInstalledPath[] = [];
  const expectedFiles = new Map(entry.files.map((file) => [file.path, file]));
  const expectedDirectories = ownedDirectories(entry);
  const expectedCase = new Map<string, string>();
  for (const expectedPath of [...expectedDirectories, ...expectedFiles.keys()]) {
    expectedCase.set(expectedPath.toLowerCase(), expectedPath);
  }
  const seenFiles = new Set<string>();
  const seenCase = new Map<string, string>();
  const actualOwnedFiles = [] as AgentCargoLockEntry["files"];

  const rootState = await inspectDestinationRoot(paths.scopeRoot, destination);
  if (rootState === "missing") {
    return {
      package: entry.package,
      version: entry.version,
      agent: entry.agent,
      scope: entry.scope,
      destination,
      state: "missing",
      missingFiles: entry.files.map((file) => file.path),
      modifiedFiles,
      untrackedPaths,
      invalidPaths,
    };
  }
  if (rootState !== "directory") {
    return {
      package: entry.package,
      version: entry.version,
      agent: entry.agent,
      scope: entry.scope,
      destination,
      state: "invalid",
      missingFiles: entry.files.map((file) => file.path),
      modifiedFiles,
      untrackedPaths,
      invalidPaths: [{ path: ".", reason: rootState }],
    };
  }

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const dirent of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${dirent.name}` : dirent.name;
      try {
        normalizeArtifactPath(relativePath);
      } catch (error) {
        invalidPaths.push({ path: relativePath, reason: errorMessage(error) });
        continue;
      }
      const caseKey = relativePath.toLowerCase();
      const priorCase = seenCase.get(caseKey);
      if (priorCase && priorCase !== relativePath) {
        invalidPaths.push({ path: relativePath, reason: `Case-collides with ${priorCase}.` });
      } else {
        seenCase.set(caseKey, relativePath);
      }
      const expectedSpelling = expectedCase.get(caseKey);
      if (expectedSpelling && expectedSpelling !== relativePath) {
        invalidPaths.push({ path: relativePath, reason: `Path case differs from ${expectedSpelling}.` });
      }

      const absolutePath = path.join(directory, dirent.name);
      const fileStat = await lstat(absolutePath);
      if (fileStat.isSymbolicLink()) {
        invalidPaths.push({ path: relativePath, reason: "Symbolic links are not managed." });
        continue;
      }
      if (fileStat.isDirectory()) {
        if (expectedFiles.has(relativePath)) {
          invalidPaths.push({ path: relativePath, reason: "Expected an owned regular file." });
        }
        if (!expectedDirectories.has(relativePath)) untrackedPaths.push(`${relativePath}/`);
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!fileStat.isFile()) {
        invalidPaths.push({ path: relativePath, reason: "Special files are not managed." });
        continue;
      }

      if (expectedDirectories.has(relativePath)) {
        invalidPaths.push({ path: relativePath, reason: "Expected an owned directory." });
        continue;
      }

      const expected = expectedFiles.get(relativePath);
      if (!expected) {
        untrackedPaths.push(relativePath);
        continue;
      }
      seenFiles.add(relativePath);
      try {
        const actual = await receiptForRegularFile(absolutePath, relativePath, fileStat);
        actualOwnedFiles.push(actual);
        if (
          actual.digest !== expected.digest ||
          actual.bytes !== expected.bytes ||
          actual.mode !== expected.mode
        ) {
          modifiedFiles.push(relativePath);
        }
      } catch (error) {
        if (error instanceof AgentCargoFilesystemError) {
          invalidPaths.push({ path: relativePath, reason: error.message });
        } else {
          throw error;
        }
      }
    }
  }

  await visit(destination, "");
  for (const expected of entry.files) {
    if (!seenFiles.has(expected.path)) missingFiles.push(expected.path);
  }
  missingFiles.sort(compareUtf8);
  modifiedFiles.sort(compareUtf8);
  untrackedPaths.sort(compareUtf8);
  invalidPaths.sort((left, right) => compareUtf8(left.path, right.path));
  actualOwnedFiles.sort((left, right) => compareUtf8(left.path, right.path));
  const state = invalidPaths.length > 0
    ? "invalid"
    : missingFiles.length > 0 || modifiedFiles.length > 0 || untrackedPaths.length > 0
      ? "modified"
      : "clean";
  return {
    package: entry.package,
    version: entry.version,
    agent: entry.agent,
    scope: entry.scope,
    destination,
    state,
    missingFiles,
    modifiedFiles,
    untrackedPaths,
    invalidPaths,
    actualFilesDigest: digestFileRecords(actualOwnedFiles),
  };
}

export async function removeCleanReceiptTree(
  entry: AgentCargoLockEntry,
  paths: LifecyclePaths,
  destination: string,
): Promise<void> {
  const inspection = await inspectEntry(entry, paths, destination);
  if (inspection.state !== "clean") {
    throw new AgentCargoLifecycleError(
      "LIFECYCLE_RECEIPT_TREE_NOT_CLEAN",
      `Refusing to delete retained files for ${entry.package}: the receipt tree is ${inspection.state}.`,
    );
  }
  await removeOwnedFiles(destination, entry);
  await rmdir(destination);
}

async function inspectDestinationRoot(
  scopeRoot: string,
  destination: string,
): Promise<"directory" | "missing" | string> {
  const relative = path.relative(scopeRoot, destination);
  let current = scopeRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const fileStat = await lstat(current).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!fileStat) return "missing";
    if (fileStat.isSymbolicLink()) return `Path component is a symbolic link: ${current}`;
    if (!fileStat.isDirectory()) return `Path component is not a directory: ${current}`;
  }
  return "directory";
}

function assertRemovable(inspection: InstallationInspection, force: boolean): void {
  if (inspection.state === "invalid") {
    throw new AgentCargoLifecycleError(
      "REMOVE_INVALID_DESTINATION",
      `Refusing to remove ${inspection.package}: the destination contains linked, special, or invalid paths.`,
    );
  }
  if (inspection.state !== "clean" && !force) {
    throw new AgentCargoLifecycleError(
      "REMOVE_DRIFT_DETECTED",
      `Refusing to remove ${inspection.package}: local drift was detected. Inspect with agentcargo list and repeat with --force --yes to remove only AgentCargo-owned files.`,
    );
  }
}

async function removeOwnedFiles(root: string, entry: AgentCargoLockEntry): Promise<void> {
  for (const file of entry.files) {
    const absolutePath = path.join(root, ...file.path.split("/"));
    await assertRealParents(root, absolutePath);
    const fileStat = await lstat(absolutePath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!fileStat) continue;
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new AgentCargoLifecycleError(
        "REMOVE_OWNED_PATH_INVALID",
        `Owned path changed type during removal: ${file.path}`,
      );
    }
    await unlink(absolutePath);
  }

  const directories = [...ownedDirectories(entry)]
    .filter(Boolean)
    .sort((left, right) => right.split("/").length - left.split("/").length || compareUtf8(right, left));
  for (const directory of directories) {
    const absolutePath = path.join(root, ...directory.split("/"));
    await rmdir(absolutePath).catch((error: unknown) => {
      if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTEMPTY")) return;
      throw error;
    });
  }
}

async function restoreIfNotEmpty(stage: string, destination: string): Promise<boolean> {
  try {
    await rmdir(stage);
    return false;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOTEMPTY") throw error;
    await rename(stage, destination);
    return true;
  }
}

async function assertRealParents(root: string, candidate: string): Promise<void> {
  const relative = path.relative(root, path.dirname(candidate));
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const fileStat = await lstat(current);
    if (!fileStat.isDirectory() || fileStat.isSymbolicLink()) {
      throw new AgentCargoLifecycleError(
        "REMOVE_PARENT_INVALID",
        `Owned file parent is not a real directory: ${current}`,
      );
    }
  }
}

async function assertRealExistingPath(root: string, candidate: string): Promise<void> {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const fileStat = await lstat(current).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!fileStat) return;
    if (!fileStat.isDirectory() || fileStat.isSymbolicLink()) {
      throw new AgentCargoLifecycleError(
        "LIFECYCLE_DIRECTORY_INVALID",
        `Managed path component must be a real directory: ${current}`,
      );
    }
  }
}

async function findAbandonedOperations(
  skillsRoot: string,
  referencedRollbackPaths = new Set<string>(),
): Promise<DoctorFinding[]> {
  const entries = await readdir(skillsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  });
  const findings: DoctorFinding[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(skillsRoot, entry.name);
    const isInstall = entry.name.startsWith(".agentcargo-stage-");
    const isRemoval = entry.name.startsWith(".agentcargo-remove-");
    const isUpdate = entry.name.startsWith(".agentcargo-update-");
    const isRollback = entry.name.startsWith(".agentcargo-rollback-");
    if (!isInstall && !isRemoval && !isUpdate && !isRollback) {
      continue;
    }
    if (isRollback && referencedRollbackPaths.has(absolutePath)) continue;
    const code = isRemoval
      ? "DOCTOR_ABANDONED_REMOVAL"
      : isUpdate
        ? "DOCTOR_ABANDONED_UPDATE"
        : isRollback
          ? "DOCTOR_ABANDONED_ROLLBACK"
          : "DOCTOR_ABANDONED_INSTALL";
    findings.push({
      code,
      severity: "warning",
      message: "An abandoned AgentCargo staging path requires manual inspection.",
      path: absolutePath,
    });
  }
  return findings;
}

function ownedDirectories(entry: AgentCargoLockEntry): Set<string> {
  const result = new Set<string>();
  for (const file of entry.files) {
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      result.add(segments.slice(0, index).join("/"));
    }
  }
  return result;
}

function findEntry(
  packages: AgentCargoLockEntry[],
  input: RemoveInstallationInput,
): AgentCargoLockEntry | undefined {
  return packages.find(
    (entry) =>
      entry.package === input.package &&
      entry.agent === input.adapter.id &&
      entry.scope === input.scope,
  );
}

function assertContained(root: string, candidate: string, code: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === "" || escapesRelativeRoot(relative)) {
    throw new AgentCargoLifecycleError(
      code,
      `Managed path escapes its allowed root: ${candidate}`,
    );
  }
}

function escapesRelativeRoot(relative: string): boolean {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected diagnostic error occurred.";
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
