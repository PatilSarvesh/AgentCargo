import {
  doctorInstallations,
  inspectEntry,
  resolveLifecyclePaths,
  type LifecycleScopeInput,
} from "./lifecycle.js";
import { readLockfile } from "./lockfile.js";
import {
  scanInstalledSkillDirectory,
  type StaticScanFinding,
} from "./scanner.js";
import type { AgentCargoLockEntry, InstallationState } from "./types.js";

export type AuditFindingSeverity = "info" | "warning" | "error";
export type AuditFindingCategory = "drift" | "path" | "integrity" | "scanner" | "recovery" | "host";

export interface AuditFinding {
  code: string;
  severity: AuditFindingSeverity;
  category: AuditFindingCategory;
  message: string;
  remediation: string;
  package?: string;
  path?: string;
  ruleVersion?: string;
  evidence?: string;
}

export interface ArtifactIntegrityReport {
  status: "recorded";
  digest: string;
  explanation: string;
}

export interface ReceiptIntegrityReport {
  status: "verified" | "mismatch" | "unavailable";
  expectedDigest: string;
  actualDigest?: string;
}

export interface InstallationScanReport {
  status: "completed" | "skipped" | "failed";
  scannerVersion?: string;
  completedAt?: string;
  reason?: string;
  findings: StaticScanFinding[];
}

export interface InstallationAudit {
  package: string;
  version: string;
  agent: string;
  scope: "project" | "user";
  source: "local" | "registry";
  destination: string;
  state: InstallationState;
  artifactIntegrity: ArtifactIntegrityReport;
  receiptIntegrity: ReceiptIntegrityReport;
  scanner: InstallationScanReport;
  findings: AuditFinding[];
}

export interface AuditSummary {
  installations: number;
  clean: number;
  drifted: number;
  errors: number;
  warnings: number;
  scannerFindings: number;
}

export interface InstallationAuditResult {
  agent: string;
  scope: "project" | "user";
  auditedAt: string;
  passed: boolean;
  scopeRoot: string;
  skillsRoot: string;
  lockfilePath: string;
  installations: InstallationAudit[];
  findings: AuditFinding[];
  summary: AuditSummary;
}

export interface AuditInstallationsOptions {
  now?: () => Date;
}

export async function auditInstallations(
  input: LifecycleScopeInput,
  options: AuditInstallationsOptions = {},
): Promise<InstallationAuditResult> {
  const paths = await resolveLifecyclePaths(input);
  const lockfile = await readLockfile(paths.lockfilePath);
  const entries = lockfile.packages.filter((entry) =>
    entry.agent === input.adapter.id && entry.scope === input.scope
  );
  const auditedAt = (options.now?.() ?? new Date()).toISOString();
  const installations: InstallationAudit[] = [];

  for (const entry of entries) {
    const inspection = await inspectEntry(entry, paths);
    const findings = installationFindings(entry, inspection);
    const receiptIntegrity = receiptReport(entry, inspection.actualFilesDigest, inspection.state);
    if (receiptIntegrity.status !== "verified") {
      findings.push({
        code: receiptIntegrity.status === "mismatch"
          ? "AUDIT_RECEIPT_DIGEST_MISMATCH"
          : "AUDIT_RECEIPT_UNAVAILABLE",
        severity: "error",
        category: "integrity",
        package: entry.package,
        path: inspection.destination,
        message: receiptIntegrity.status === "mismatch"
          ? "The installed host-ready file receipt does not match the lockfile digest."
          : "The installed host-ready file receipt could not be fully recomputed.",
        remediation: remediationForDrift(entry.package),
      });
    }

    const scanner = await auditScanner(inspection.destination, inspection.state, options, entry.package);
    findings.push(...scanner.findings.map((finding) => scannerAuditFinding(entry.package, finding)));
    if (scanner.status === "failed") {
      findings.push({
        code: "AUDIT_SCANNER_FAILED",
        severity: "error",
        category: "scanner",
        package: entry.package,
        path: inspection.destination,
        message: scanner.reason ?? "Static scanning failed.",
        remediation: "Inspect filesystem stability and invalid path types, then rerun agentcargo audit.",
      });
    }

    findings.sort(compareAuditFindings);
    installations.push({
      package: entry.package,
      version: entry.version,
      agent: entry.agent,
      scope: entry.scope,
      source: entry.source.type,
      destination: inspection.destination,
      state: inspection.state,
      artifactIntegrity: {
        status: "recorded",
        digest: entry.digest,
        explanation: "The immutable source-artifact digest is retained in the lockfile. The source artifact is not stored locally, so audit verifies the installed host-ready receipt separately.",
      },
      receiptIntegrity,
      scanner,
      findings,
    });
  }

  const doctor = await doctorInstallations(input);
  const scopeFindings = doctor.findings
    .filter((finding) => !finding.code.startsWith("DOCTOR_INSTALLATION_"))
    .map(doctorAuditFinding)
    .sort(compareAuditFindings);
  installations.sort((left, right) => left.package.localeCompare(right.package));
  const allFindings = [...scopeFindings, ...installations.flatMap((installation) => installation.findings)];
  return {
    agent: input.adapter.id,
    scope: input.scope,
    auditedAt,
    passed: !allFindings.some((finding) => finding.severity === "error"),
    ...paths,
    installations,
    findings: scopeFindings,
    summary: {
      installations: installations.length,
      clean: installations.filter((installation) => installation.state === "clean").length,
      drifted: installations.filter((installation) => installation.state !== "clean").length,
      errors: allFindings.filter((finding) => finding.severity === "error").length,
      warnings: allFindings.filter((finding) => finding.severity === "warning").length,
      scannerFindings: installations.reduce(
        (total, installation) => total + installation.scanner.findings.length,
        0,
      ),
    },
  };
}

function installationFindings(
  entry: AgentCargoLockEntry,
  inspection: Awaited<ReturnType<typeof inspectEntry>>,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const relativePath of inspection.missingFiles) {
    findings.push({
      code: "AUDIT_FILE_MISSING",
      severity: "error",
      category: "drift",
      package: entry.package,
      path: relativePath,
      message: "A lockfile-owned file is missing from the installation.",
      remediation: remediationForDrift(entry.package),
    });
  }
  for (const relativePath of inspection.modifiedFiles) {
    findings.push({
      code: "AUDIT_FILE_MODIFIED",
      severity: "error",
      category: "drift",
      package: entry.package,
      path: relativePath,
      message: "A lockfile-owned file's digest, byte count, or canonical mode changed.",
      remediation: remediationForDrift(entry.package),
    });
  }
  for (const relativePath of inspection.untrackedPaths) {
    findings.push({
      code: "AUDIT_PATH_UNTRACKED",
      severity: "error",
      category: "drift",
      package: entry.package,
      path: relativePath,
      message: "The managed installation contains a path that is not owned by its lockfile receipt.",
      remediation: "Review and move the untracked path outside the managed skill, or use confirmed forced removal to preserve untracked content while deleting only receipt-owned files.",
    });
  }
  for (const invalid of inspection.invalidPaths) {
    findings.push({
      code: "AUDIT_PATH_INVALID",
      severity: "error",
      category: "path",
      package: entry.package,
      path: invalid.path,
      message: invalid.reason,
      remediation: "Inspect the path without following it, remove or replace linked/special content manually, and reinstall from a trusted artifact. AgentCargo will not bypass this protection.",
    });
  }
  if (inspection.state === "missing" && inspection.missingFiles.length === 0) {
    findings.push({
      code: "AUDIT_DESTINATION_MISSING",
      severity: "error",
      category: "path",
      package: entry.package,
      path: inspection.destination,
      message: "The managed installation destination is missing.",
      remediation: remediationForDrift(entry.package),
    });
  }
  return findings;
}

function receiptReport(
  entry: AgentCargoLockEntry,
  actualDigest: string | undefined,
  state: InstallationState,
): ReceiptIntegrityReport {
  if (!actualDigest) return { status: "unavailable", expectedDigest: entry.files_digest };
  return {
    status: actualDigest === entry.files_digest && state !== "invalid" && state !== "missing"
      ? "verified"
      : "mismatch",
    expectedDigest: entry.files_digest,
    actualDigest,
  };
}

async function auditScanner(
  destination: string,
  state: InstallationState,
  options: AuditInstallationsOptions,
  packageName: string,
): Promise<InstallationScanReport> {
  if (state === "invalid" || state === "missing") {
    return {
      status: "skipped",
      reason: `Static scanning was skipped because ${packageName} is ${state}; unsafe paths are never followed.`,
      findings: [],
    };
  }
  try {
    const result = await scanInstalledSkillDirectory(destination, options);
    return {
      status: "completed",
      scannerVersion: result.scannerVersion,
      completedAt: result.completedAt,
      findings: result.findings,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "Static scanning failed unexpectedly.",
      findings: [],
    };
  }
}

function scannerAuditFinding(packageName: string, finding: StaticScanFinding): AuditFinding {
  return {
    code: finding.ruleId,
    severity: finding.severity,
    category: "scanner",
    package: packageName,
    message: finding.message,
    remediation: finding.remediation,
    ruleVersion: finding.ruleVersion,
    ...(finding.path ? { path: finding.path } : {}),
    ...(finding.evidence ? { evidence: finding.evidence } : {}),
  };
}

function doctorAuditFinding(
  finding: Awaited<ReturnType<typeof doctorInstallations>>["findings"][number],
): AuditFinding {
  return {
    code: finding.code.replace(/^DOCTOR_/, "AUDIT_"),
    severity: finding.severity,
    category: finding.code.includes("HOST") || finding.code.includes("SCOPE") ? "host" : "recovery",
    message: finding.message,
    remediation: remediationForDoctorFinding(finding.code),
    ...(finding.path ? { path: finding.path } : {}),
  };
}

function remediationForDoctorFinding(code: string): string {
  if (code === "DOCTOR_ACTIVE_OPERATION") {
    return "Wait for the active AgentCargo operation to finish, then rerun the audit.";
  }
  if (code.includes("OPERATION_LOCK")) {
    return "Confirm no AgentCargo process is active, inspect the lock metadata, then remove only the stale or invalid scope lock before retrying.";
  }
  if (code.includes("ABANDONED")) {
    return "Inspect the staging or backup path and related lock/rollback metadata before manually removing recovery evidence.";
  }
  if (code.includes("ROLLBACK")) {
    return "Do not update, remove, or rollback this package until the rollback sidecar and retained receipt tree have been inspected and reconciled.";
  }
  return "Resolve the reported host or metadata condition, then rerun agentcargo audit.";
}

function remediationForDrift(packageName: string): string {
  return `Review local changes for ${packageName}, then restore from its trusted source or remove and reinstall it. Use forced removal only when intentionally discarding owned-file drift.`;
}

function compareAuditFindings(left: AuditFinding, right: AuditFinding): number {
  return severityRank(left.severity) - severityRank(right.severity)
    || left.category.localeCompare(right.category)
    || (left.package ?? "").localeCompare(right.package ?? "")
    || (left.path ?? "").localeCompare(right.path ?? "")
    || left.code.localeCompare(right.code);
}

function severityRank(severity: AuditFindingSeverity): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  return 2;
}
