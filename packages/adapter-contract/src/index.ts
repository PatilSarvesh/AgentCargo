export type InstallScope = "project" | "user";

export interface AdapterContext {
  projectRoot?: string;
  userHome: string;
}

export interface AdapterPackage {
  name: string;
  version: string;
  files: readonly string[];
  compatibility?: Record<string, { scopes: readonly InstallScope[] }>;
}

export interface AdapterFinding {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface DetectionResult {
  detected: boolean;
  scopeRoots: Partial<Record<InstallScope, string>>;
  notes: string[];
}

export interface DestinationInput {
  scope: InstallScope;
  context: AdapterContext;
  package: AdapterPackage;
}

export interface ResolvedDestination {
  host: string;
  scope: InstallScope;
  scopeRoot: string;
  skillsRoot: string;
  destination: string;
  relativeDestination: string;
}

export type InstallMutation =
  | { kind: "ensure-directory"; path: string }
  | { kind: "stage-artifact"; parent: string }
  | { kind: "remove-package-file"; relativePath: string }
  | { kind: "atomic-rename"; destination: string };

export interface InstallPlan extends ResolvedDestination {
  packageName: string;
  mutations: readonly InstallMutation[];
}

export interface PrepareStagedPackageInput {
  plan: InstallPlan;
  stagedPackageRoot: string;
  package: AdapterPackage;
}

export interface HealthCheckInput {
  scope: InstallScope;
  context: AdapterContext;
}

export interface HealthCheckResult {
  healthy: boolean;
  findings: AdapterFinding[];
}

export interface HostAdapter {
  readonly id: string;
  readonly adapterVersion: string;
  readonly documentationUrl: string;
  readonly documentationLastVerified: string;

  detect(context: AdapterContext): Promise<DetectionResult>;
  supportedScopes(): readonly InstallScope[];
  resolveDestination(input: DestinationInput): Promise<ResolvedDestination>;
  validatePackage(input: DestinationInput): Promise<AdapterFinding[]>;
  planInstall(input: DestinationInput): Promise<InstallPlan>;
  prepareStagedPackage(input: PrepareStagedPackageInput): Promise<void>;
  healthCheck(input: HealthCheckInput): Promise<HealthCheckResult>;
}

export class AgentCargoAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentCargoAdapterError";
  }
}
