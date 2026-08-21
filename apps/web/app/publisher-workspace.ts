import { readBrowserRegistrySessionCookie } from "./registry-session.ts";

const PACKAGE_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const RELEASE_STATUSES = new Set(["reserved", "expired", "uploading", "uploaded", "scanning", "active", "deprecated", "quarantined", "rejected"]);

export type PublisherReleaseStatus = "reserved" | "expired" | "uploading" | "uploaded" | "scanning" | "active" | "deprecated" | "quarantined" | "rejected";

export type PublisherReleaseSummary = {
  releaseId: string;
  version: string;
  status: PublisherReleaseStatus;
  createdAt: string;
  expiresAt: string;
  digest?: string;
  completedAt?: string;
  publishedAt?: string;
};

export type PublisherPackageHistory = {
  package: { namespace: string; name: string };
  latestVersion?: string;
  releases: readonly PublisherReleaseSummary[];
};

export type PublisherWorkspace = {
  apiVersion: "v1";
  namespaces: readonly {
    namespace: string;
    packages: readonly PublisherPackageHistory[];
  }[];
};

export type PublisherWorkspaceResolver = (accessToken: string) => Promise<unknown | null>;

export type PublisherWorkspaceResult =
  | { state: "absent" }
  | { state: "unconfigured" }
  | { state: "unavailable" }
  | { state: "invalid" }
  | { state: "active"; workspace: PublisherWorkspace };

export async function loadPublisherWorkspace(
  request: Request,
  resolver: PublisherWorkspaceResolver | null,
): Promise<PublisherWorkspaceResult> {
  const accessToken = readBrowserRegistrySessionCookie(request);
  if (!accessToken) return { state: "absent" };
  if (!resolver) return { state: "unconfigured" };
  let value: unknown | null;
  try {
    value = await resolver(accessToken);
  } catch {
    return { state: "unavailable" };
  }
  if (value === null) return { state: "invalid" };
  const workspace = parsePublisherWorkspace(value);
  return workspace ? { state: "active", workspace } : { state: "invalid" };
}

export function parsePublisherWorkspace(input: unknown): PublisherWorkspace | null {
  if (!isExactRecord(input, ["apiVersion", "namespaces"]) || input.apiVersion !== "v1" || !Array.isArray(input.namespaces) || input.namespaces.length > 100) return null;
  const namespaceNames = new Set<string>();
  const namespaces: PublisherWorkspace["namespaces"][number][] = [];
  for (const namespaceInput of input.namespaces) {
    if (!isExactRecord(namespaceInput, ["namespace", "packages"]) || !isPackagePart(namespaceInput.namespace) || !Array.isArray(namespaceInput.packages) || namespaceInput.packages.length > 1_000) return null;
    if (namespaceNames.has(namespaceInput.namespace)) return null;
    namespaceNames.add(namespaceInput.namespace);
    const packageNames = new Set<string>();
    const packages: PublisherPackageHistory[] = [];
    for (const packageInput of namespaceInput.packages) {
      if (!isPublisherPackage(packageInput, namespaceInput.namespace) || packageNames.has(packageInput.package.name)) return null;
      packageNames.add(packageInput.package.name);
      packages.push(packageInput);
    }
    namespaces.push({ namespace: namespaceInput.namespace, packages });
  }
  return { apiVersion: "v1", namespaces };
}

function isPublisherPackage(input: unknown, namespace: string): input is PublisherPackageHistory {
  if (!isRecordWithOptionalKeys(input, ["package", "releases"], ["latestVersion"])) return false;
  if (!isExactRecord(input.package, ["namespace", "name"]) || input.package.namespace !== namespace || !isPackagePart(input.package.name)) return false;
  if (input.latestVersion !== undefined && (typeof input.latestVersion !== "string" || !SEMVER.test(input.latestVersion))) return false;
  if (!Array.isArray(input.releases) || input.releases.length > 10_000) return false;
  const versions = new Set<string>();
  for (const release of input.releases) {
    if (!isPublisherRelease(release) || versions.has(release.version)) return false;
    versions.add(release.version);
  }
  return true;
}

function isPublisherRelease(input: unknown): input is PublisherReleaseSummary {
  if (!isRecordWithOptionalKeys(input, ["releaseId", "version", "status", "createdAt", "expiresAt"], ["digest", "completedAt", "publishedAt"])) return false;
  if (!isBoundedText(input.releaseId, 128) || typeof input.version !== "string" || !SEMVER.test(input.version)) return false;
  if (typeof input.status !== "string" || !RELEASE_STATUSES.has(input.status)) return false;
  if (!isDateTime(input.createdAt) || !isDateTime(input.expiresAt)) return false;
  if (input.digest !== undefined && (typeof input.digest !== "string" || !DIGEST.test(input.digest))) return false;
  if (input.completedAt !== undefined && !isDateTime(input.completedAt)) return false;
  if (input.publishedAt !== undefined && !isDateTime(input.publishedAt)) return false;
  return true;
}

function isPackagePart(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && PACKAGE_PART.test(value);
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum && !hasControlCharacter(value);
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecordWithOptionalKeys(value: unknown, required: readonly string[], optional: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}
