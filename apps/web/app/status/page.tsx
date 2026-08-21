import Link from "next/link";

export const dynamic = "force-dynamic";

type ComponentStatus = "operational" | "degraded" | "unavailable" | "not_configured";
type OverallStatus = "operational" | "degraded" | "outage";

type StatusComponent = {
  status: ComponentStatus;
  checkedAt: string;
  detail?: string;
};

type WorkerStatus = StatusComponent & {
  ready: boolean;
  reason: string;
  totalRuns: number;
  claimedJobs: number;
  consecutiveFailures: number;
  lastRunAgeMs: number | null;
  queue: {
    queued: number;
    failed: number;
    running: number;
    staleLeases: number;
    oldestAvailableAt: string | null;
    lagMs: number;
  } | null;
};

type ModerationStatus = StatusComponent & { activeDenylistEntries: number | null };

type RegistryStatus = {
  apiVersion: "v1";
  generatedAt: string;
  overall: OverallStatus;
  components: {
    api: StatusComponent;
    database: StatusComponent;
    storage: StatusComponent;
    worker: WorkerStatus;
    moderation: ModerationStatus;
  };
};

type StatusPageState =
  | { kind: "live"; status: RegistryStatus }
  | { kind: "unconfigured" }
  | { kind: "unavailable" };

const componentLabels: Array<[keyof RegistryStatus["components"], string]> = [
  ["api", "API"],
  ["database", "Database"],
  ["storage", "Artifact storage"],
  ["worker", "Scan worker"],
  ["moderation", "Moderation"],
];

export default async function StatusPage() {
  const state = await loadStatus();
  const overall = state.kind === "live" ? state.status.overall : state.kind === "unconfigured" ? "degraded" : "outage";
  const overallLabel = state.kind === "live" ? statusLabel(state.status.overall) : state.kind === "unconfigured" ? "Not connected" : "Unavailable";

  return (
    <main className="site-shell status-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="AgentCargo home">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>AgentCargo</span>
        </Link>
        <nav className="top-nav" aria-label="Status navigation">
          <Link href="/">Explore</Link>
          <Link className="active" href="/status">Status</Link>
          <Link href="/publisher">Publisher workspace</Link>
        </nav>
        <Link className="quiet-button" href="/publish">Publish a skill <span aria-hidden="true">↗</span></Link>
      </header>

      <section className="status-hero">
        <p className="eyebrow"><span className="eyebrow-dot" /> Public operational status</p>
        <h1>Trust the signal, <em>not the guess.</em></h1>
        <p className="hero-lede">A compact view of the registry boundaries that protect discovery, artifact integrity, scanning, and moderation.</p>
      </section>

      <section className="status-content" aria-label="Registry operational status">
        <div className={`status-overall ${overall}`}>
          <div><span className="section-kicker">Current status</span><h2>{overallLabel}</h2></div>
          <span className="status-overall-dot" aria-hidden="true" />
          <p>{state.kind === "live" ? `Last checked ${formatDateTime(state.status.generatedAt)}.` : state.kind === "unconfigured" ? "This web host has not configured a registry URL." : "The registry status endpoint could not be reached."}</p>
        </div>

        {state.kind === "live" ? <div className="status-grid">
          {componentLabels.map(([key, label]) => {
            const component = state.status.components[key];
            return <StatusCard key={key} label={label} component={component} />;
          })}
        </div> : <div className="status-empty"><span className="empty-mark">⌁</span><h2>{state.kind === "unconfigured" ? "Status source not configured" : "Status source unavailable"}</h2><p>{state.kind === "unconfigured" ? "Set AGENTCARGO_REGISTRY_URL on the web host to display live API, storage, worker, and moderation signals." : "Try again later. The page intentionally avoids presenting stale internal details or package data."}</p></div>}

        <div className="status-boundary"><span className="note-mark">i</span><p>Status exposes bounded counters and readiness states only. It never includes package contents, credentials, signed URLs, or raw dependency errors.</p></div>
      </section>

      <footer className="footer"><span>AgentCargo <span className="footer-muted">· Know exactly what you are trusting.</span></span><Link href="/">Return to catalog ↗</Link></footer>
    </main>
  );
}

function StatusCard({ label, component }: { label: string; component: StatusComponent | WorkerStatus | ModerationStatus }) {
  const worker = "ready" in component;
  const moderation = "activeDenylistEntries" in component;
  return <article className={`status-card ${component.status}`}>
    <div className="status-card-heading"><span>{label}</span><strong>{statusLabel(component.status)}</strong></div>
    <p>{component.detail ?? defaultDetail(component.status)}</p>
    <dl>
      <div><dt>Checked</dt><dd>{formatDateTime(component.checkedAt)}</dd></div>
      {worker ? <>
        <div><dt>Readiness</dt><dd>{component.ready ? "Ready" : component.reason}</dd></div>
        <div><dt>Queue</dt><dd>{component.queue ? `${component.queue.queued} queued · ${component.queue.lagMs}ms lag` : "No queue sample"}</dd></div>
      </> : null}
      {moderation ? <div><dt>Active denylist entries</dt><dd>{component.activeDenylistEntries ?? "Not reported"}</dd></div> : null}
    </dl>
  </article>;
}

async function loadStatus(): Promise<StatusPageState> {
  const configured = process.env.AGENTCARGO_REGISTRY_URL;
  if (!configured) return { kind: "unconfigured" };
  let base: URL;
  try {
    base = new URL(configured);
    const loopback = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "[::1]";
    if ((base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) || base.username || base.password) return { kind: "unconfigured" };
    base.search = "";
    base.hash = "";
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;
  } catch {
    return { kind: "unconfigured" };
  }
  try {
    const response = await fetch(new URL("v1/status", base), { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return { kind: "unavailable" };
    const body = await response.json() as unknown;
    return isRegistryStatus(body) ? { kind: "live", status: body } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

function isRegistryStatus(value: unknown): value is RegistryStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (input.apiVersion !== "v1" || typeof input.generatedAt !== "string" || !["operational", "degraded", "outage"].includes(String(input.overall))) return false;
  if (!input.components || typeof input.components !== "object" || Array.isArray(input.components)) return false;
  return componentLabels.every(([key]) => isStatusComponent((input.components as Record<string, unknown>)[key], key));
}

function isStatusComponent(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const component = value as Record<string, unknown>;
  if (!component.checkedAt || typeof component.checkedAt !== "string" || !["operational", "degraded", "unavailable", "not_configured"].includes(String(component.status))) return false;
  if (key === "worker") return typeof component.ready === "boolean" && typeof component.reason === "string" && typeof component.totalRuns === "number" && typeof component.claimedJobs === "number" && typeof component.consecutiveFailures === "number" && (component.lastRunAgeMs === null || typeof component.lastRunAgeMs === "number");
  if (key === "moderation") return component.activeDenylistEntries === null || typeof component.activeDenylistEntries === "number";
  return true;
}

function statusLabel(status: OverallStatus | ComponentStatus): string {
  if (status === "operational") return "Operational";
  if (status === "not_configured") return "Not configured";
  if (status === "degraded") return "Degraded";
  return status === "outage" ? "Outage" : "Unavailable";
}

function defaultDetail(status: ComponentStatus): string {
  if (status === "operational") return "Boundary is responding within its published contract.";
  if (status === "not_configured") return "This optional boundary is not configured for the current deployment.";
  if (status === "degraded") return "The boundary is responding with reduced readiness.";
  return "The boundary did not provide a usable signal.";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}
