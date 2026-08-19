import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { inventoryRegularTree } from "./filesystem.js";
import { validateSkillDirectory } from "./skill.js";
import type { SkillValidationResult } from "./types.js";

export const STATIC_SCANNER_VERSION = "rules-1";
export const STATIC_RULE_VERSION = "1";
const MAX_EVIDENCE_LENGTH = 512;
const MAX_FINDINGS = 100;

export type StaticFindingSeverity = "info" | "warning" | "error";

export interface StaticScanFinding {
  ruleId: string;
  ruleVersion: string;
  severity: StaticFindingSeverity;
  path?: string;
  evidence?: string;
  message: string;
  explanation: string;
  remediation: string;
}

export interface StaticScanResult {
  valid: boolean;
  scannerVersion: string;
  completedAt: string;
  findings: StaticScanFinding[];
}

export interface ScanSkillDirectoryOptions {
  now?: () => Date;
}

interface RuleMatch {
  line: string;
  lineNumber: number;
}

interface ScanRule {
  id: string;
  severity: StaticFindingSeverity;
  pattern: RegExp;
  message: string;
  explanation: string;
  remediation: string;
}

const TEXT_RULES: readonly ScanRule[] = [
  {
    id: "AGENTCARGO-NETWORK-REFERENCE",
    severity: "warning",
    pattern: /\bhttps?:\/\/[^\s<>()"']+/i,
    message: "File contains a network URL.",
    explanation: "A URL may cause an agent or script to contact an external service.",
    remediation: "Explain why the endpoint is needed and keep URLs limited to trusted, documented services.",
  },
  {
    id: "AGENTCARGO-DYNAMIC-DOWNLOAD",
    severity: "warning",
    pattern: /\b(?:curl|wget|invoke-webrequest|iwr)\b/i,
    message: "File contains a dynamic download command.",
    explanation: "Download commands can fetch changing or unreviewed content at execution time.",
    remediation: "Vendor required content into the release or document and constrain the expected endpoint and bytes.",
  },
  {
    id: "AGENTCARGO-ENVIRONMENT-REFERENCE",
    severity: "warning",
    pattern: /(?:\bprocess\.env(?:\.[A-Za-z_][A-Za-z0-9_]*|\[['"][^'"]+['"]\])|\bos\.environ(?:\[['"][^'"]+['"]\]|\.get\s*\()|\$\{?[A-Z][A-Z0-9_]*\}?|\b(?:API[_-]?KEY|SECRET(?:[_-]?KEY)?|TOKEN|PASSWORD|PRIVATE[_-]?KEY)\b)/i,
    message: "File references an environment variable or likely secret name.",
    explanation: "Environment values may contain credentials or other host-specific data that instructions could expose.",
    remediation: "Declare the required environment value, avoid printing it, and never include real credentials in the package.",
  },
  {
    id: "AGENTCARGO-DESTRUCTIVE-COMMAND",
    severity: "warning",
    pattern: /(?:\brm\s+-[^\n]{0,8}r[^\n]*|\b(?:mkfs|wipefs|shred)\b|\bdd\s+if\s*=|\b(?:del|rmdir)\s+\/s\b)/i,
    message: "File contains a potentially destructive filesystem command.",
    explanation: "The command could delete, overwrite, or irreversibly alter user data.",
    remediation: "Remove the command or require explicit user confirmation with a narrowly scoped, reversible alternative.",
  },
  {
    id: "AGENTCARGO-OVERRIDE-INSTRUCTION",
    severity: "warning",
    pattern: /(?:\b(?:ignore|disregard|bypass)\s+(?:all\s+)?(?:previous|earlier|system|safety|security)\s+(?:instructions|rules|constraints)|\b(?:reveal|print|show)\s+(?:the\s+)?(?:system|developer)\s+prompt)/i,
    message: "File contains language attempting to override agent controls or reveal hidden instructions.",
    explanation: "Instruction-overriding language can conflict with the host agent's system and user directions.",
    remediation: "Remove the override language and state the intended workflow as ordinary, scoped instructions.",
  },
  {
    id: "AGENTCARGO-PATH-ESCAPE",
    severity: "warning",
    pattern: /(?:\.\.\/){2,}|(?:^|[\s"'])\/(?:etc|var|root|home|Users)\b|(?:[A-Za-z]:\\Users\\|~\/\.ssh\b)/i,
    message: "File references a path outside a normal skill workspace.",
    explanation: "Absolute or deeply traversing paths may access data outside the selected project or user skill root.",
    remediation: "Use paths relative to the current project or explicitly document the narrow host path and required scope.",
  },
  {
    id: "AGENTCARGO-ENCODED-PAYLOAD",
    severity: "warning",
    pattern: /(?:[A-Za-z0-9+/]{160,}={0,2}|(?:[0-9a-fA-F]{2}){96,})/,
    message: "File contains a long encoded or minified-looking payload.",
    explanation: "Large encoded blocks are difficult to review and can conceal executable behavior.",
    remediation: "Replace opaque payloads with readable source or document the exact provenance and purpose.",
  },
];

const SCRIPT_EXTENSIONS = new Set([
  ".bash", ".bat", ".cjs", ".cmd", ".fish", ".js", ".mjs", ".php", ".pl", ".ps1", ".py", ".rb", ".sh", ".ts", ".zsh",
]);
const ARCHIVE_EXTENSIONS = new Set([".7z", ".bz2", ".gz", ".jar", ".rar", ".tar", ".tgz", ".xz", ".zip"]);
const BINARY_EXTENSIONS = new Set([".bin", ".class", ".dll", ".dylib", ".exe", ".so", ".wasm"]);

export async function scanSkillDirectory(
  inputPath: string,
  options: ScanSkillDirectoryOptions = {},
): Promise<StaticScanResult> {
  const validation = await validateSkillDirectory(inputPath);
  const findings: StaticScanFinding[] = [];
  addValidationSummary(findings, validation);

  for (const relativePath of validation.files) {
    if (findings.length >= MAX_FINDINGS) break;
    await scanFile(path.resolve(validation.root, relativePath), relativePath, findings);
  }

  findings.sort(compareFindings);
  const bounded = findings.slice(0, MAX_FINDINGS);
  return {
    valid: !bounded.some((item) => item.severity === "error"),
    scannerVersion: STATIC_SCANNER_VERSION,
    completedAt: (options.now?.() ?? new Date()).toISOString(),
    findings: bounded,
  };
}

export async function scanInstalledSkillDirectory(
  inputPath: string,
  options: ScanSkillDirectoryOptions = {},
): Promise<StaticScanResult> {
  const root = path.resolve(inputPath);
  const inventory = await inventoryRegularTree(root);
  const findings: StaticScanFinding[] = [];
  for (const file of inventory.files) {
    if (findings.length >= MAX_FINDINGS) break;
    await scanFile(path.join(root, ...file.path.split("/")), file.path, findings);
  }
  findings.sort(compareFindings);
  const bounded = findings.slice(0, MAX_FINDINGS);
  return {
    valid: !bounded.some((item) => item.severity === "error"),
    scannerVersion: STATIC_SCANNER_VERSION,
    completedAt: (options.now?.() ?? new Date()).toISOString(),
    findings: bounded,
  };
}

function addValidationSummary(findings: StaticScanFinding[], validation: SkillValidationResult): void {
  const errors = validation.findings.filter((item) => item.severity === "error");
  if (errors.length === 0) return;
  addFinding(findings, {
    ruleId: "AGENTCARGO-PACKAGE-INVALID",
    severity: "error",
    message: "Package validation found structural errors before static scanning.",
    explanation: "Static observations are incomplete when the package cannot be safely interpreted as an AgentCargo skill.",
    remediation: "Fix the reported validation findings, then run the scanner again.",
    ...(errors[0]?.path ? { path: errors[0].path } : {}),
    evidence: errors.map((item) => item.code).join(", "),
  });
}

async function scanFile(absolutePath: string, relativePath: string, findings: StaticScanFinding[]): Promise<void> {
  let stat;
  try {
    stat = await lstat(absolutePath);
  } catch {
    addFinding(findings, {
      ruleId: "AGENTCARGO-SCAN-FILE-UNAVAILABLE",
      severity: "error",
      path: relativePath,
      message: "File became unavailable during static scanning.",
      explanation: "A complete static observation requires a stable regular file snapshot.",
      remediation: "Inspect local filesystem changes and rerun the scan.",
    });
    return;
  }

  if (!stat.isFile() || stat.isSymbolicLink()) {
    addFinding(findings, {
      ruleId: "AGENTCARGO-SCAN-PATH-INVALID",
      severity: "error",
      path: relativePath,
      message: "Scanner input is not a regular file.",
      explanation: "Static scanning does not follow links or inspect special files.",
      remediation: "Replace the path with a reviewable regular file and rerun the scan.",
    });
    return;
  }

  const extension = path.extname(relativePath).toLowerCase();
  if (stat.mode & 0o111 || SCRIPT_EXTENSIONS.has(extension)) {
    addFinding(findings, {
      ruleId: "AGENTCARGO-SCRIPT-FILE",
      severity: "info",
      path: relativePath,
      message: "File is executable or uses a script-like extension.",
      explanation: "Scripts are observed but never executed by AgentCargo infrastructure.",
      remediation: "Review the script contents and declare any required host capabilities.",
    });
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    addFinding(findings, {
      ruleId: "AGENTCARGO-NESTED-ARCHIVE",
      severity: "warning",
      path: relativePath,
      message: "Package contains a nested archive.",
      explanation: "Nested archives can hide additional files or executable content from ordinary review.",
      remediation: "Remove the archive or document its contents and provenance explicitly.",
    });
  }
  if (BINARY_EXTENSIONS.has(extension)) {
    addFinding(findings, {
      ruleId: "AGENTCARGO-BINARY-FILE",
      severity: "warning",
      path: relativePath,
      message: "Package contains a binary or compiled-looking file.",
      explanation: "Compiled files are difficult to inspect with static text rules and may contain hidden behavior.",
      remediation: "Prefer readable source or document the binary's provenance, purpose, and expected platform.",
    });
  }

  if (relativePath === "agentcargo.yaml") return;
  let bytes: Buffer;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absolutePath, "r");
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.dev !== stat.dev
      || opened.ino !== stat.ino
      || opened.size !== stat.size
      || opened.mtimeMs !== stat.mtimeMs
      || opened.ctimeMs !== stat.ctimeMs
    ) {
      throw new Error("File identity changed while it was being opened.");
    }
    bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs
      || after.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error("File changed while it was being scanned.");
    }
  } catch {
    addFinding(findings, {
      ruleId: "AGENTCARGO-SCAN-FILE-UNAVAILABLE",
      severity: "error",
      path: relativePath,
      message: "File could not be read as a stable regular file.",
      explanation: "A complete static observation requires the file identity and contents to remain stable.",
      remediation: "Inspect local filesystem changes and rerun the scan.",
    });
    return;
  } finally {
    await handle?.close().catch(() => undefined);
  }
  if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) {
    addFinding(findings, {
      ruleId: "AGENTCARGO-BINARY-FILE",
      severity: "warning",
      path: relativePath,
      message: "File appears to contain binary data.",
      explanation: "Binary data is difficult to inspect with text-based static rules.",
      remediation: "Prefer readable source or document the binary's provenance and purpose.",
    });
    return;
  }

  const text = bytes.toString("utf8");
  for (const rule of TEXT_RULES) {
    const match = firstMatch(text, rule.pattern);
    if (!match) continue;
    addFinding(findings, {
      ruleId: rule.id,
      severity: rule.severity,
      path: relativePath,
      evidence: `line ${match.lineNumber}: ${match.line}`,
      message: rule.message,
      explanation: rule.explanation,
      remediation: rule.remediation,
    });
  }
}

function firstMatch(text: string, pattern: RegExp): RuleMatch | undefined {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    pattern.lastIndex = 0;
    if (pattern.test(lines[index]!)) {
      return { line: boundedEvidence(lines[index]!), lineNumber: index + 1 };
    }
  }
  return undefined;
}

function addFinding(findings: StaticScanFinding[], finding: Omit<StaticScanFinding, "ruleVersion">): void {
  if (findings.length >= MAX_FINDINGS) return;
  const result: StaticScanFinding = { ...finding, ruleVersion: STATIC_RULE_VERSION };
  if (result.evidence) result.evidence = boundedEvidence(result.evidence);
  findings.push(result);
}

function boundedEvidence(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length <= MAX_EVIDENCE_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_EVIDENCE_LENGTH - 1)}…`;
}

function compareFindings(left: StaticScanFinding, right: StaticScanFinding): number {
  return (left.path ?? "").localeCompare(right.path ?? "")
    || left.ruleId.localeCompare(right.ruleId)
    || left.message.localeCompare(right.message);
}
