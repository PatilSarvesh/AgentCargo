import path from "node:path";
import { compareUtf8 } from "./filesystem.js";
import type { InstalledFileRecord } from "./types.js";

const SCRIPT_EXTENSIONS = new Set([
  ".bash",
  ".bat",
  ".cjs",
  ".cmd",
  ".fish",
  ".js",
  ".mjs",
  ".php",
  ".pl",
  ".ps1",
  ".py",
  ".rb",
  ".sh",
  ".ts",
  ".zsh",
]);

export interface UpdateFindingSnapshot {
  ruleId: string;
  ruleVersion: string;
  severity: "info" | "warning" | "error";
  path?: string;
  evidence?: string;
  message: string;
  explanation: string;
  remediation: string;
}

export interface UpdateDeclaredSnapshot {
  description?: string;
  license?: string;
  repositoryUrl?: string;
  tags?: readonly string[];
  compatibility?: Readonly<Record<string, unknown>>;
  capabilities?: Readonly<Record<string, unknown>>;
  /** Descriptive runtime requirements only; AgentCargo does not resolve them. */
  dependencies?: readonly string[];
}

export interface UpdatePackageSnapshot {
  package: string;
  version: string;
  digest: string;
  files: readonly InstalledFileRecord[];
  declared?: UpdateDeclaredSnapshot;
  findings?: readonly UpdateFindingSnapshot[];
}

export interface UpdateFileChange {
  path: string;
  before: InstalledFileRecord;
  after: InstalledFileRecord;
  contentChanged: boolean;
  sizeChanged: boolean;
  modeChanged: boolean;
}

export interface UpdateValueChange {
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface UpdateManifestChange {
  field: "description" | "license" | "repositoryUrl" | "tags" | "compatibility";
  before?: unknown;
  after?: unknown;
}

export interface UpdateFindingChange {
  ruleId: string;
  path?: string;
  before: UpdateFindingSnapshot;
  after: UpdateFindingSnapshot;
}

export interface UpdatePreview {
  package: string;
  fromVersion: string;
  toVersion: string;
  fromDigest: string;
  toDigest: string;
  changed: boolean;
  versionChanged: boolean;
  digestChanged: boolean;
  files: {
    added: InstalledFileRecord[];
    removed: InstalledFileRecord[];
    modified: UpdateFileChange[];
  };
  scripts: {
    added: string[];
    removed: string[];
    modified: string[];
  };
  capabilities: UpdateValueChange[];
  dependencies: {
    added: string[];
    removed: string[];
  };
  manifest: UpdateManifestChange[];
  findings: {
    added: UpdateFindingSnapshot[];
    resolved: UpdateFindingSnapshot[];
    changed: UpdateFindingChange[];
  };
}

export class AgentCargoUpdatePreviewError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentCargoUpdatePreviewError";
  }
}

export function createUpdatePreview(
  current: UpdatePackageSnapshot,
  target: UpdatePackageSnapshot,
): UpdatePreview {
  if (current.package !== target.package) {
    throw new AgentCargoUpdatePreviewError(
      "UPDATE_PREVIEW_PACKAGE_MISMATCH",
      `Cannot compare ${current.package} with ${target.package}.`,
    );
  }

  const files = compareFiles(current.files, target.files);
  const scripts = compareScripts(current.files, target.files, files.modified);
  const capabilities = compareValues(
    current.declared?.capabilities ?? {},
    target.declared?.capabilities ?? {},
  );
  const dependencies = compareStrings(
    current.declared?.dependencies ?? [],
    target.declared?.dependencies ?? [],
  );
  const manifest = compareManifest(current.declared, target.declared);
  const findings = compareFindings(current.findings ?? [], target.findings ?? []);
  const versionChanged = current.version !== target.version;
  const digestChanged = current.digest !== target.digest;
  const changed = versionChanged
    || digestChanged
    || files.added.length > 0
    || files.removed.length > 0
    || files.modified.length > 0
    || capabilities.length > 0
    || dependencies.added.length > 0
    || dependencies.removed.length > 0
    || manifest.length > 0
    || findings.added.length > 0
    || findings.resolved.length > 0
    || findings.changed.length > 0;

  return {
    package: current.package,
    fromVersion: current.version,
    toVersion: target.version,
    fromDigest: current.digest,
    toDigest: target.digest,
    changed,
    versionChanged,
    digestChanged,
    files,
    scripts,
    capabilities,
    dependencies,
    manifest,
    findings,
  };
}

function compareFiles(
  current: readonly InstalledFileRecord[],
  target: readonly InstalledFileRecord[],
): UpdatePreview["files"] {
  const before = indexFiles(current, "current");
  const after = indexFiles(target, "target");
  const added: InstalledFileRecord[] = [];
  const removed: InstalledFileRecord[] = [];
  const modified: UpdateFileChange[] = [];

  for (const [filePath, targetFile] of after) {
    const currentFile = before.get(filePath);
    if (!currentFile) {
      added.push({ ...targetFile });
      continue;
    }
    const contentChanged = currentFile.digest !== targetFile.digest;
    const sizeChanged = currentFile.bytes !== targetFile.bytes;
    const modeChanged = currentFile.mode !== targetFile.mode;
    if (contentChanged || sizeChanged || modeChanged) {
      modified.push({
        path: filePath,
        before: { ...currentFile },
        after: { ...targetFile },
        contentChanged,
        sizeChanged,
        modeChanged,
      });
    }
  }
  for (const [filePath, currentFile] of before) {
    if (!after.has(filePath)) removed.push({ ...currentFile });
  }

  added.sort(compareFileRecords);
  removed.sort(compareFileRecords);
  modified.sort((left, right) => compareUtf8(left.path, right.path));
  return { added, removed, modified };
}

function compareScripts(
  current: readonly InstalledFileRecord[],
  target: readonly InstalledFileRecord[],
  modifiedFiles: readonly UpdateFileChange[],
): UpdatePreview["scripts"] {
  const before = new Set(current.filter(isScriptFile).map((file) => file.path));
  const after = new Set(target.filter(isScriptFile).map((file) => file.path));
  const added = [...after].filter((filePath) => !before.has(filePath)).sort(compareUtf8);
  const removed = [...before].filter((filePath) => !after.has(filePath)).sort(compareUtf8);
  const modified = modifiedFiles
    .filter((change) => before.has(change.path) || after.has(change.path))
    .map((change) => change.path)
    .sort(compareUtf8);
  return { added, removed, modified };
}

function compareValues(before: unknown, after: unknown): UpdateValueChange[] {
  const beforeValues = flattenValue(before);
  const afterValues = flattenValue(after);
  const paths = new Set([...beforeValues.keys(), ...afterValues.keys()]);
  const changes: UpdateValueChange[] = [];
  for (const valuePath of [...paths].sort(compareUtf8)) {
    const beforeValue = beforeValues.get(valuePath);
    const afterValue = afterValues.get(valuePath);
    if (canonicalJson(beforeValue) === canonicalJson(afterValue)) continue;
    changes.push({
      path: valuePath || ".",
      ...(beforeValues.has(valuePath) ? { before: beforeValue } : {}),
      ...(afterValues.has(valuePath) ? { after: afterValue } : {}),
    });
  }
  return changes;
}

function flattenValue(value: unknown, prefix = "", result = new Map<string, unknown>()): Map<string, unknown> {
  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => compareUtf8(left, right));
    if (entries.length === 0 && prefix) result.set(prefix, {});
    for (const [key, child] of entries) {
      flattenValue(child, prefix ? `${prefix}.${key}` : key, result);
    }
    return result;
  }
  result.set(prefix, cloneValue(value));
  return result;
}

function compareManifest(
  current: UpdateDeclaredSnapshot | undefined,
  target: UpdateDeclaredSnapshot | undefined,
): UpdateManifestChange[] {
  const fields = ["description", "license", "repositoryUrl", "tags", "compatibility"] as const;
  const changes: UpdateManifestChange[] = [];
  for (const field of fields) {
    const before = current?.[field];
    const after = target?.[field];
    if (canonicalJson(before) === canonicalJson(after)) continue;
    changes.push({
      field,
      ...(before !== undefined ? { before: cloneValue(before) } : {}),
      ...(after !== undefined ? { after: cloneValue(after) } : {}),
    });
  }
  return changes;
}

function compareFindings(
  current: readonly UpdateFindingSnapshot[],
  target: readonly UpdateFindingSnapshot[],
): UpdatePreview["findings"] {
  const before = indexFindings(current, "current");
  const after = indexFindings(target, "target");
  const added: UpdateFindingSnapshot[] = [];
  const resolved: UpdateFindingSnapshot[] = [];
  const changed: UpdateFindingChange[] = [];

  for (const [identity, targetFinding] of after) {
    const currentFinding = before.get(identity);
    if (!currentFinding) {
      added.push(cloneFinding(targetFinding));
      continue;
    }
    if (canonicalJson(currentFinding) !== canonicalJson(targetFinding)) {
      changed.push({
        ruleId: targetFinding.ruleId,
        ...(targetFinding.path ? { path: targetFinding.path } : {}),
        before: cloneFinding(currentFinding),
        after: cloneFinding(targetFinding),
      });
    }
  }
  for (const [identity, currentFinding] of before) {
    if (!after.has(identity)) resolved.push(cloneFinding(currentFinding));
  }

  added.sort(compareFindingSnapshots);
  resolved.sort(compareFindingSnapshots);
  changed.sort((left, right) => compareUtf8(findingIdentity(left), findingIdentity(right)));
  return { added, resolved, changed };
}

function compareStrings(
  current: readonly string[],
  target: readonly string[],
): { added: string[]; removed: string[] } {
  const before = new Set(current);
  const after = new Set(target);
  return {
    added: [...after].filter((value) => !before.has(value)).sort(compareUtf8),
    removed: [...before].filter((value) => !after.has(value)).sort(compareUtf8),
  };
}

function indexFiles(
  files: readonly InstalledFileRecord[],
  label: string,
): Map<string, InstalledFileRecord> {
  const result = new Map<string, InstalledFileRecord>();
  const casePaths = new Map<string, string>();
  for (const file of files) {
    if (result.has(file.path)) {
      throw new AgentCargoUpdatePreviewError(
        "UPDATE_PREVIEW_FILE_DUPLICATE",
        `The ${label} snapshot contains duplicate file path ${file.path}.`,
      );
    }
    const caseKey = file.path.toLowerCase();
    const prior = casePaths.get(caseKey);
    if (prior && prior !== file.path) {
      throw new AgentCargoUpdatePreviewError(
        "UPDATE_PREVIEW_FILE_CASE_COLLISION",
        `The ${label} snapshot contains case-colliding paths ${prior} and ${file.path}.`,
      );
    }
    casePaths.set(caseKey, file.path);
    result.set(file.path, file);
  }
  return result;
}

function indexFindings(
  findings: readonly UpdateFindingSnapshot[],
  label: string,
): Map<string, UpdateFindingSnapshot> {
  const result = new Map<string, UpdateFindingSnapshot>();
  for (const finding of findings) {
    const identity = findingIdentity(finding);
    if (result.has(identity)) {
      throw new AgentCargoUpdatePreviewError(
        "UPDATE_PREVIEW_FINDING_DUPLICATE",
        `The ${label} snapshot contains duplicate finding ${finding.ruleId}${finding.path ? ` at ${finding.path}` : ""}.`,
      );
    }
    result.set(identity, finding);
  }
  return result;
}

function findingIdentity(value: Pick<UpdateFindingSnapshot, "ruleId" | "path">): string {
  return `${value.ruleId}\u0000${value.path ?? ""}`;
}

function compareFindingSnapshots(left: UpdateFindingSnapshot, right: UpdateFindingSnapshot): number {
  return compareUtf8(findingIdentity(left), findingIdentity(right));
}

function compareFileRecords(left: InstalledFileRecord, right: InstalledFileRecord): number {
  return compareUtf8(left.path, right.path);
}

function isScriptFile(file: InstalledFileRecord): boolean {
  return file.mode === 0o755 || SCRIPT_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase());
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)])) as T;
  }
  return value;
}

function cloneFinding(value: UpdateFindingSnapshot): UpdateFindingSnapshot {
  return { ...value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
