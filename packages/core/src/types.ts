export type FindingSeverity = "error" | "warning" | "info";

export interface Finding {
  code: string;
  severity: FindingSeverity;
  message: string;
  path?: string;
}

export interface AgentCargoHostCompatibility {
  scopes: Array<"project" | "user">;
}

export interface AgentCargoCapabilities {
  filesystem?: {
    read?: boolean;
    write?: boolean;
  };
  shell?: boolean;
  network?: boolean;
  environment?: string[];
}

export interface AgentCargoManifest {
  schema_version: 1;
  name: string;
  version: string;
  description: string;
  license?: string;
  repository?: string;
  compatibility?: Record<string, AgentCargoHostCompatibility>;
  capabilities?: AgentCargoCapabilities;
  tags?: string[];
}

export interface SkillValidationResult {
  valid: boolean;
  root: string;
  skillName?: string;
  manifest?: AgentCargoManifest;
  files: string[];
  totalBytes: number;
  findings: Finding[];
}

export interface SkillTemplate {
  name: string;
  description: string;
  skillMarkdown: string;
  manifestYaml: string;
}

export interface PackArtifactResult {
  format: "agentcargo-ustar-v1";
  artifactPath: string;
  digest: string;
  artifactBytes: number;
  expandedBytes: number;
  files: string[];
  name: string;
  version: string;
}

export interface ExtractArtifactOptions {
  expectedDigest?: string;
}

export interface ExtractArtifactResult {
  format: "agentcargo-ustar-v1";
  artifactPath: string;
  destinationPath: string;
  digest: string;
  artifactBytes: number;
  expandedBytes: number;
  files: string[];
}

export interface InstalledFileRecord {
  path: string;
  digest: string;
  bytes: number;
  mode: number;
}

export interface AgentCargoLockEntry {
  package: string;
  version: string;
  digest: string;
  agent: string;
  adapter_version: string;
  scope: "project" | "user";
  destination: string;
  installed_at: string;
  files_digest: string;
  files: InstalledFileRecord[];
  source: {
    type: "local" | "registry";
  };
}

export interface AgentCargoLockfile {
  lockfile_version: 1;
  packages: AgentCargoLockEntry[];
}

export interface InstallLocalSkillResult {
  package: string;
  version: string;
  digest: string;
  agent: string;
  adapterVersion: string;
  scope: "project" | "user";
  destination: string;
  lockfilePath: string;
  filesDigest: string;
  files: InstalledFileRecord[];
}
