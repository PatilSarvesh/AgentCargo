import { randomUUID } from "node:crypto";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterPackage, InstallPlan } from "@agentcargo/adapter-contract";
import { extractArtifact, normalizeArtifactPath, packSkillDirectory } from "./archive.js";
import { inventoryRegularTree } from "./filesystem.js";
import {
  inspectEntry,
  listInstallations,
  removeCleanReceiptTree,
  resolveLifecyclePaths,
  type LifecyclePaths,
  type LifecycleScopeInput,
} from "./lifecycle.js";
import { readLockfile, writeLockfileAtomic } from "./lockfile.js";
import { acquireOperationLock } from "./operation-lock.js";
import {
  lockEntriesEqual,
  readRollbackState,
  rollbackStatePath,
  writeRollbackStateAtomic,
  type AgentCargoRollbackRecord,
  type AgentCargoRollbackState,
} from "./rollback-state.js";
import { validateSkillDirectory } from "./skill.js";
import { createUpdatePreview } from "./update-preview.js";
import type {
  UpdateDeclaredSnapshot,
  UpdateFindingSnapshot,
  UpdatePackageSnapshot,
  UpdatePreview,
} from "./update-preview.js";
import type {
  AgentCargoLockEntry,
  AgentCargoLockfile,
  AgentCargoManifest,
  InstallationInspection,
} from "./types.js";

export interface PreviewInstallationUpdateInput extends LifecycleScopeInput {
  package: string;
  sourcePath: string;
  expectedDigest?: string;
  currentDeclared?: UpdateDeclaredSnapshot;
  targetDeclared?: UpdateDeclaredSnapshot;
  currentFindings?: readonly UpdateFindingSnapshot[];
  targetFindings?: readonly UpdateFindingSnapshot[];
}

export interface UpdateInstallationInput extends PreviewInstallationUpdateInput {
  now?: () => Date;
}

export interface RollbackInstallationInput extends LifecycleScopeInput {
  package: string;
  now?: () => Date;
}

export interface InstallationUpdatePreviewResult {
  package: string;
  agent: string;
  scope: "project" | "user";
  lockfilePath: string;
  installation: InstallationInspection;
  preview: UpdatePreview;
}

export interface InstallationUpdateResult extends InstallationUpdatePreviewResult {
  applied: boolean;
  destination: string;
  rollbackStatePath?: string;
  cleanupPending?: string;
}

export interface InstallationRollbackResult {
  package: string;
  agent: string;
  scope: "project" | "user";
  fromVersion: string;
  toVersion: string;
  fromDigest: string;
  toDigest: string;
  destination: string;
  lockfilePath: string;
  rollbackStatePath: string;
}

interface PreparedUpdateCandidate {
  manifest: AgentCargoManifest;
  adapterPackage: AdapterPackage;
  plan: InstallPlan;
  digest: string;
  filesDigest: string;
  files: AgentCargoLockEntry["files"];
  stagingRoot: string;
  stagedPackageRoot: string;
  cleanup(): Promise<void>;
}

export class AgentCargoUpdateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentCargoUpdateError";
  }
}

export async function previewInstallationUpdate(
  input: PreviewInstallationUpdateInput,
): Promise<InstallationUpdatePreviewResult> {
  const installations = await listInstallations(input);
  const installation = installations.packages.find((candidate) => candidate.package === input.package);
  if (!installation) throw notInstalled(input, "is not recorded");

  const lockfile = await readLockfile(installations.lockfilePath);
  const entry = findEntry(lockfile, input);
  if (!entry) throw notInstalled(input, "is no longer recorded");

  const prepared = await prepareUpdateCandidate(input, entry, installation);
  try {
    return previewResult(input, installations.lockfilePath, entry, installation, prepared);
  } finally {
    await prepared.cleanup();
  }
}

export async function updateInstallation(
  input: UpdateInstallationInput,
): Promise<InstallationUpdateResult> {
  const paths = await resolveLifecyclePaths(input);
  const operationLock = await acquireOperationLock(
    path.dirname(paths.lockfilePath),
    "UPDATE_OPERATION_LOCKED",
  );
  let prepared: PreparedUpdateCandidate | undefined;
  try {
    const lockfile = await readLockfile(paths.lockfilePath);
    const entry = findEntry(lockfile, input);
    if (!entry) throw notInstalled(input, "is not recorded");
    const installation = await inspectEntry(entry, paths);
    assertCleanInstallation(installation, "UPDATE");

    const statePath = rollbackStatePath(paths.lockfilePath);
    const priorState = await readRollbackState(statePath);
    const priorRecord = findRollbackRecord(priorState, entry);
    if (priorRecord) await validateRollbackRecord(priorRecord, entry, paths, "UPDATE");

    prepared = await prepareUpdateCandidate(
      input,
      entry,
      installation,
      paths.skillsRoot,
      ".agentcargo-update-",
    );

    const currentLockfile = await readLockfile(paths.lockfilePath);
    const currentEntry = findEntry(currentLockfile, input);
    if (!currentEntry || !lockEntriesEqual(currentEntry, entry)) {
      throw new AgentCargoUpdateError(
        "UPDATE_INSTALLATION_CHANGED",
        `${input.package} lockfile metadata changed while the update was being prepared.`,
      );
    }
    const currentState = await readRollbackState(statePath);
    if (JSON.stringify(currentState) !== JSON.stringify(priorState)) {
      throw new AgentCargoUpdateError(
        "UPDATE_ROLLBACK_STATE_CHANGED",
        "Rollback state changed while the update was being prepared.",
      );
    }
    const currentInspection = await inspectEntry(currentEntry, paths);
    assertCleanInstallation(currentInspection, "UPDATE");

    const result = previewResult(
      input,
      paths.lockfilePath,
      currentEntry,
      currentInspection,
      prepared,
    );
    if (!result.preview.changed) {
      return {
        ...result,
        applied: false,
        destination: currentInspection.destination,
      };
    }
    const now = (input.now?.() ?? new Date()).toISOString();
    const nextEntry: AgentCargoLockEntry = {
      ...currentEntry,
      version: prepared.manifest.version,
      digest: prepared.digest,
      adapter_version: input.adapter.adapterVersion,
      installed_at: now,
      files_digest: prepared.filesDigest,
      files: prepared.files,
    };
    const nextLockfile = replaceLockEntry(currentLockfile, currentEntry, nextEntry);
    const backup = path.join(paths.skillsRoot, `.agentcargo-rollback-${randomUUID()}`);
    const backupRelative = relativePortablePath(paths.scopeRoot, backup);
    const nextRecord: AgentCargoRollbackRecord = {
      backup_destination: backupRelative,
      created_at: now,
      previous: currentEntry,
      current: nextEntry,
    };
    const nextState = replaceRollbackRecord(currentState, priorRecord, nextRecord);

    await commitUpdateTransaction({
      paths,
      destination: currentInspection.destination,
      prepared,
      backup,
      previousLockfile: currentLockfile,
      nextLockfile,
      statePath,
      nextState,
    });

    let cleanupPending: string | undefined;
    if (priorRecord) {
      const priorBackup = resolveBackupDestination(priorRecord, paths, "UPDATE");
      try {
        await removeCleanReceiptTree(priorRecord.previous, paths, priorBackup);
      } catch {
        cleanupPending = priorBackup;
      }
    }

    return {
      ...result,
      applied: true,
      destination: currentInspection.destination,
      rollbackStatePath: statePath,
      ...(cleanupPending ? { cleanupPending } : {}),
    };
  } finally {
    try {
      if (prepared) await prepared.cleanup();
    } finally {
      await operationLock.release();
    }
  }
}

export async function rollbackInstallation(
  input: RollbackInstallationInput,
): Promise<InstallationRollbackResult> {
  const paths = await resolveLifecyclePaths(input);
  const operationLock = await acquireOperationLock(
    path.dirname(paths.lockfilePath),
    "ROLLBACK_OPERATION_LOCKED",
  );
  try {
    const lockfile = await readLockfile(paths.lockfilePath);
    const entry = findEntry(lockfile, input);
    if (!entry) {
      throw new AgentCargoUpdateError(
        "ROLLBACK_NOT_INSTALLED",
        `${input.package} is not recorded for ${input.adapter.id} ${input.scope} scope.`,
      );
    }
    const statePath = rollbackStatePath(paths.lockfilePath);
    const state = await readRollbackState(statePath);
    const record = findRollbackRecord(state, entry);
    if (!record) {
      throw new AgentCargoUpdateError(
        "ROLLBACK_NOT_AVAILABLE",
        `No retained rollback version is available for ${input.package}.`,
      );
    }
    await validateRollbackRecord(record, entry, paths, "ROLLBACK");
    const currentInspection = await inspectEntry(entry, paths);
    assertCleanInstallation(currentInspection, "ROLLBACK");
    const oldBackup = resolveBackupDestination(record, paths, "ROLLBACK");

    const now = (input.now?.() ?? new Date()).toISOString();
    const newBackup = path.join(paths.skillsRoot, `.agentcargo-rollback-${randomUUID()}`);
    const restoredEntry: AgentCargoLockEntry = {
      ...record.previous,
      installed_at: now,
    };
    const nextLockfile = replaceLockEntry(lockfile, entry, restoredEntry);
    const reversedRecord: AgentCargoRollbackRecord = {
      backup_destination: relativePortablePath(paths.scopeRoot, newBackup),
      created_at: now,
      previous: entry,
      current: restoredEntry,
    };
    const nextState = replaceRollbackRecord(state, record, reversedRecord);

    await commitRollbackTransaction({
      paths,
      destination: currentInspection.destination,
      oldBackup,
      newBackup,
      previousLockfile: lockfile,
      nextLockfile,
      statePath,
      previousState: state,
      nextState,
    });

    return {
      package: entry.package,
      agent: entry.agent,
      scope: entry.scope,
      fromVersion: entry.version,
      toVersion: restoredEntry.version,
      fromDigest: entry.digest,
      toDigest: restoredEntry.digest,
      destination: currentInspection.destination,
      lockfilePath: paths.lockfilePath,
      rollbackStatePath: statePath,
    };
  } finally {
    await operationLock.release();
  }
}

async function commitUpdateTransaction(input: {
  paths: LifecyclePaths;
  destination: string;
  prepared: PreparedUpdateCandidate;
  backup: string;
  previousLockfile: AgentCargoLockfile;
  nextLockfile: AgentCargoLockfile;
  statePath: string;
  nextState: AgentCargoRollbackState;
}): Promise<void> {
  let activeMoved = false;
  let targetActivated = false;
  let lockfileCommitted = false;
  try {
    await rename(input.destination, input.backup);
    activeMoved = true;
    await rename(input.prepared.stagedPackageRoot, input.destination);
    targetActivated = true;
    await writeLockfileAtomic(input.paths.lockfilePath, input.nextLockfile);
    lockfileCommitted = true;
    await writeRollbackStateAtomic(input.statePath, input.nextState);
  } catch (error) {
    try {
      if (targetActivated) {
        await rename(input.destination, input.prepared.stagedPackageRoot);
        targetActivated = false;
      }
      if (activeMoved) {
        await rename(input.backup, input.destination);
        activeMoved = false;
      }
      if (lockfileCommitted) await writeLockfileAtomic(input.paths.lockfilePath, input.previousLockfile);
    } catch (recoveryError) {
      throw new AgentCargoUpdateError(
        "UPDATE_RECOVERY_FAILED",
        `Update failed and the previous installation could not be fully restored: ${input.destination}`,
        { updateError: error, recoveryError },
      );
    }
    throw new AgentCargoUpdateError(
      "UPDATE_COMMIT_FAILED",
      `Update failed; the previous installation and lockfile were restored: ${input.destination}`,
      error,
    );
  }
}

async function commitRollbackTransaction(input: {
  paths: LifecyclePaths;
  destination: string;
  oldBackup: string;
  newBackup: string;
  previousLockfile: AgentCargoLockfile;
  nextLockfile: AgentCargoLockfile;
  statePath: string;
  previousState: AgentCargoRollbackState;
  nextState: AgentCargoRollbackState;
}): Promise<void> {
  let activeMoved = false;
  let previousActivated = false;
  let lockfileCommitted = false;
  try {
    await rename(input.destination, input.newBackup);
    activeMoved = true;
    await rename(input.oldBackup, input.destination);
    previousActivated = true;
    await writeLockfileAtomic(input.paths.lockfilePath, input.nextLockfile);
    lockfileCommitted = true;
    await writeRollbackStateAtomic(input.statePath, input.nextState);
  } catch (error) {
    try {
      if (previousActivated) {
        await rename(input.destination, input.oldBackup);
        previousActivated = false;
      }
      if (activeMoved) {
        await rename(input.newBackup, input.destination);
        activeMoved = false;
      }
      if (lockfileCommitted) await writeLockfileAtomic(input.paths.lockfilePath, input.previousLockfile);
      await writeRollbackStateAtomic(input.statePath, input.previousState);
    } catch (recoveryError) {
      throw new AgentCargoUpdateError(
        "ROLLBACK_RECOVERY_FAILED",
        `Rollback failed and the current installation could not be fully restored: ${input.destination}`,
        { rollbackError: error, recoveryError },
      );
    }
    throw new AgentCargoUpdateError(
      "ROLLBACK_COMMIT_FAILED",
      `Rollback failed; the current installation and lockfile were restored: ${input.destination}`,
      error,
    );
  }
}

async function prepareUpdateCandidate(
  input: PreviewInstallationUpdateInput,
  entry: AgentCargoLockEntry,
  installation: InstallationInspection,
  stagingParent = tmpdir(),
  stagingPrefix = "agentcargo-update-preview-",
): Promise<PreparedUpdateCandidate> {
  const validation = await validateSkillDirectory(input.sourcePath);
  if (!validation.valid || !validation.manifest) {
    const codes = validation.findings
      .filter((finding) => finding.severity === "error")
      .map((finding) => finding.code)
      .join(", ");
    throw new AgentCargoUpdateError(
      "UPDATE_SOURCE_INVALID",
      `Update source validation failed${codes ? `: ${codes}` : "."}`,
    );
  }

  const expectedName = packageName(entry.package);
  if (validation.manifest.name !== expectedName) {
    throw new AgentCargoUpdateError(
      "UPDATE_PACKAGE_MISMATCH",
      `Update source is ${validation.manifest.name}, expected ${expectedName}.`,
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
  const destinationInput = {
    scope: input.scope,
    context: input.context,
    package: adapterPackage,
  };
  const adapterFindings = await input.adapter.validatePackage(destinationInput);
  const blocking = adapterFindings.filter((finding) => finding.severity === "error");
  if (blocking.length > 0) {
    throw new AgentCargoUpdateError(
      blocking[0]?.code ?? "UPDATE_ADAPTER_VALIDATION_FAILED",
      blocking.map((finding) => finding.message).join(" "),
    );
  }
  const plan = await input.adapter.planInstall(destinationInput);
  assertExistingPlan(plan, input, installation, adapterPackage.name);

  const artifactRoot = await mkdtemp(path.join(tmpdir(), "agentcargo-update-artifact-"));
  let stagingRoot: string | undefined;
  try {
    stagingRoot = await mkdtemp(path.join(stagingParent, stagingPrefix));
    const artifactPath = path.join(
      artifactRoot,
      `${adapterPackage.name}-${adapterPackage.version}-${randomUUID()}.agentcargo`,
    );
    const packed = await packSkillDirectory(validation.root, artifactPath);
    if (input.expectedDigest && packed.digest !== input.expectedDigest) {
      throw new AgentCargoUpdateError(
        "UPDATE_ARTIFACT_DIGEST_MISMATCH",
        `Repacked update digest ${packed.digest} does not match expected digest ${input.expectedDigest}.`,
      );
    }
    const stagedPackageRoot = path.join(stagingRoot, "package");
    await extractArtifact(packed.artifactPath, stagedPackageRoot, { expectedDigest: packed.digest });
    await input.adapter.prepareStagedPackage({ plan, stagedPackageRoot, package: adapterPackage });
    const inventory = await inventoryRegularTree(stagedPackageRoot);
    if (!inventory.files.some((file) => file.path === "SKILL.md")) {
      throw new AgentCargoUpdateError(
        "UPDATE_STAGED_SKILL_INVALID",
        "The staged host package does not contain SKILL.md.",
      );
    }
    const completedStagingRoot = stagingRoot;
    return {
      manifest: validation.manifest,
      adapterPackage,
      plan,
      digest: packed.digest,
      filesDigest: inventory.filesDigest,
      files: inventory.files,
      stagingRoot: completedStagingRoot,
      stagedPackageRoot,
      async cleanup(): Promise<void> {
        await Promise.all([
          rm(completedStagingRoot, { recursive: true, force: true }),
          rm(artifactRoot, { recursive: true, force: true }),
        ]);
      },
    };
  } catch (error) {
    if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(artifactRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function previewResult(
  input: PreviewInstallationUpdateInput,
  lockfilePath: string,
  entry: AgentCargoLockEntry,
  installation: InstallationInspection,
  prepared: PreparedUpdateCandidate,
): InstallationUpdatePreviewResult {
  const currentSnapshot: UpdatePackageSnapshot = {
    package: entry.package,
    version: entry.version,
    digest: entry.digest,
    files: entry.files,
    ...(input.currentDeclared ? { declared: input.currentDeclared } : {}),
    ...(input.currentFindings ? { findings: input.currentFindings } : {}),
  };
  const targetSnapshot: UpdatePackageSnapshot = {
    package: entry.package,
    version: prepared.manifest.version,
    digest: prepared.digest,
    files: prepared.files,
    ...(input.targetDeclared ? { declared: input.targetDeclared } : {}),
    ...(input.targetFindings ? { findings: input.targetFindings } : {}),
  };
  return {
    package: entry.package,
    agent: entry.agent,
    scope: entry.scope,
    lockfilePath,
    installation,
    preview: createUpdatePreview(currentSnapshot, targetSnapshot),
  };
}

async function validateRollbackRecord(
  record: AgentCargoRollbackRecord,
  entry: AgentCargoLockEntry,
  paths: LifecyclePaths,
  operation: "UPDATE" | "ROLLBACK",
): Promise<void> {
  if (!lockEntriesEqual(record.current, entry)) {
    throw new AgentCargoUpdateError(
      `${operation}_ROLLBACK_STATE_MISMATCH`,
      `Rollback state does not match the active lockfile entry for ${entry.package}.`,
    );
  }
  const backup = resolveBackupDestination(record, paths, operation);
  const inspection = await inspectEntry(record.previous, paths, backup);
  if (inspection.state !== "clean") {
    throw new AgentCargoUpdateError(
      `${operation}_BACKUP_${inspection.state.toUpperCase()}`,
      `Retained rollback files for ${entry.package} are ${inspection.state}; refusing to replace recovery evidence.`,
    );
  }
}

function resolveBackupDestination(
  record: AgentCargoRollbackRecord,
  paths: LifecyclePaths,
  operation: "UPDATE" | "ROLLBACK",
): string {
  const backup = path.resolve(paths.scopeRoot, ...record.backup_destination.split("/"));
  assertContained(paths.skillsRoot, backup, `${operation}_BACKUP_DESTINATION_INVALID`);
  const active = path.resolve(paths.scopeRoot, ...record.current.destination.split("/"));
  if (backup === active) {
    throw new AgentCargoUpdateError(
      `${operation}_BACKUP_DESTINATION_INVALID`,
      "Rollback backup must be separate from the active installation.",
    );
  }
  return backup;
}

function assertCleanInstallation(
  installation: InstallationInspection,
  operation: "UPDATE" | "ROLLBACK",
): void {
  if (installation.state === "invalid") {
    throw new AgentCargoUpdateError(
      `${operation}_INVALID_DESTINATION`,
      `Refusing to ${operation.toLowerCase()} ${installation.package}: the destination contains linked, special, or invalid paths.`,
    );
  }
  if (installation.state !== "clean") {
    throw new AgentCargoUpdateError(
      `${operation}_DRIFT_DETECTED`,
      `Refusing to ${operation.toLowerCase()} ${installation.package}: local drift was detected. Inspect it before retrying.`,
    );
  }
}

function replaceLockEntry(
  lockfile: AgentCargoLockfile,
  current: AgentCargoLockEntry,
  replacement: AgentCargoLockEntry,
): AgentCargoLockfile {
  return {
    lockfile_version: 1,
    packages: lockfile.packages.map((candidate) => candidate === current ? replacement : candidate),
  };
}

function replaceRollbackRecord(
  state: AgentCargoRollbackState,
  current: AgentCargoRollbackRecord | undefined,
  replacement: AgentCargoRollbackRecord,
): AgentCargoRollbackState {
  const matchesCurrent = (candidate: AgentCargoRollbackRecord): boolean =>
    current !== undefined
    && candidate.current.package === current.current.package
    && candidate.current.agent === current.current.agent
    && candidate.current.scope === current.current.scope;
  return {
    rollback_state_version: 1,
    packages: current
      ? state.packages.map((candidate) => matchesCurrent(candidate) ? replacement : candidate)
      : [...state.packages, replacement],
  };
}

function findRollbackRecord(
  state: AgentCargoRollbackState,
  entry: AgentCargoLockEntry,
): AgentCargoRollbackRecord | undefined {
  return state.packages.find((record) =>
    record.current.package === entry.package
    && record.current.agent === entry.agent
    && record.current.scope === entry.scope
  );
}

function findEntry(
  lockfile: AgentCargoLockfile,
  input: Pick<LifecycleScopeInput, "adapter" | "scope"> & { package: string },
): AgentCargoLockEntry | undefined {
  return lockfile.packages.find((entry) =>
    entry.package === input.package
    && entry.agent === input.adapter.id
    && entry.scope === input.scope
  );
}

function notInstalled(
  input: Pick<LifecycleScopeInput, "adapter" | "scope"> & { package: string },
  state: string,
): AgentCargoUpdateError {
  return new AgentCargoUpdateError(
    "UPDATE_NOT_INSTALLED",
    `${input.package} ${state} for ${input.adapter.id} ${input.scope} scope.`,
  );
}

function assertExistingPlan(
  plan: InstallPlan,
  input: PreviewInstallationUpdateInput,
  installation: InstallationInspection,
  packageNameValue: string,
): void {
  if (
    plan.host !== input.adapter.id
    || plan.scope !== input.scope
    || plan.packageName !== packageNameValue
    || path.resolve(plan.destination) !== path.resolve(installation.destination)
  ) {
    throw new AgentCargoUpdateError(
      "UPDATE_PLAN_IDENTITY_INVALID",
      "Host adapter returned an update plan for a different package, host, scope, or destination.",
    );
  }
}

function relativePortablePath(root: string, candidate: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AgentCargoUpdateError(
      "ROLLBACK_BACKUP_DESTINATION_INVALID",
      `Rollback backup escapes its scope root: ${candidate}`,
    );
  }
  return normalizeArtifactPath(relative.split(path.sep).join("/"));
}

function assertContained(root: string, candidate: string, code: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AgentCargoUpdateError(code, `Managed rollback path escapes its skills root: ${candidate}`);
  }
}

function packageName(packageIdentity: string): string {
  const separator = packageIdentity.lastIndexOf("/");
  return separator >= 0 ? packageIdentity.slice(separator + 1) : packageIdentity;
}
