"use client";

import { useEffect, useMemo, useState } from "react";

type Host = "codex" | "claude-code";
type Scope = "project" | "user";
type ReleaseStatus = "active" | "deprecated";

type VersionSummary = {
  version: string;
  status: ReleaseStatus;
  publishedAt: string;
  findings: number;
  digest: string;
};

type PackageSummary = {
  namespace: string;
  name: string;
  description: string;
  latestVersion: string;
  tags: string[];
  compatibility: Partial<Record<Host, Scope[]>>;
  hasScripts: boolean;
  publisher: string;
  accent: string;
  files: string[];
  observed: string[];
  findings: number;
  digest: string;
  versions: VersionSummary[];
};

const demoPackagesBase: PackageSummary[] = [
  {
    namespace: "studio",
    name: "patch-review",
    description: "A calm, structured review of correctness, risk, and maintainability before code ships.",
    latestVersion: "1.4.0",
    tags: ["code-review", "quality"],
    compatibility: { codex: ["project", "user"], "claude-code": ["project"] },
    hasScripts: false,
    publisher: "Studio North",
    accent: "coral",
    files: ["SKILL.md", "references/review-checklist.md"],
    observed: ["No executable files", "No network references", "Native Agent Skills format"],
    findings: 0,
    digest: "sha256:8b6e…4a12",
    versions: [
      { version: "1.4.0", status: "active", publishedAt: "Aug 14, 2026", findings: 0, digest: "sha256:8b6e…4a12" },
      { version: "1.3.0", status: "active", publishedAt: "Jul 30, 2026", findings: 0, digest: "sha256:6db1…1f20" },
      { version: "1.2.0", status: "deprecated", publishedAt: "Jun 18, 2026", findings: 1, digest: "sha256:2f03…d5c1" },
    ],
  },
  {
    namespace: "fieldnotes",
    name: "incident-brief",
    description: "Turn messy incident notes into a concise timeline, impact summary, and next actions.",
    latestVersion: "0.9.2",
    tags: ["operations", "writing"],
    compatibility: { codex: ["project"], "claude-code": ["project", "user"] },
    hasScripts: false,
    publisher: "Field Notes",
    accent: "blue",
    files: ["SKILL.md", "references/brief-template.md"],
    observed: ["No executable files", "No environment access", "Two reference files"],
    findings: 0,
    digest: "sha256:19c3…e701",
    versions: [
      { version: "0.9.2", status: "active", publishedAt: "Aug 9, 2026", findings: 0, digest: "sha256:19c3…e701" },
      { version: "0.9.1", status: "active", publishedAt: "Jul 12, 2026", findings: 0, digest: "sha256:0af4…b6aa" },
    ],
  },
  {
    namespace: "redteam",
    name: "api-surface-check",
    description: "Probe an API change for auth, validation, error-shape, and backwards-compatibility gaps.",
    latestVersion: "2.1.1",
    tags: ["security", "backend"],
    compatibility: { codex: ["project", "user"] },
    hasScripts: true,
    publisher: "Red Team Labs",
    accent: "mustard",
    files: ["SKILL.md", "scripts/check-endpoints.ts"],
    observed: ["One script detected", "Network capability declared", "Static scan completed"],
    findings: 1,
    digest: "sha256:5a0d…98cf",
    versions: [
      { version: "2.1.1", status: "active", publishedAt: "Aug 2, 2026", findings: 1, digest: "sha256:5a0d…98cf" },
      { version: "2.1.0", status: "deprecated", publishedAt: "Jul 3, 2026", findings: 2, digest: "sha256:44c2…0d90" },
    ],
  },
];

const starterPackages: PackageSummary[] = [
  ["code-review", "Review code changes for correctness, maintainability, and delivery risk.", ["code-review", "quality"], "coral"],
  ["test-writing", "Design focused tests that protect behavior and make failures easy to diagnose.", ["testing", "quality"], "blue"],
  ["documentation", "Turn implementation details into clear documentation for users and maintainers.", ["documentation", "writing"], "mustard"],
  ["security-review", "Inspect a change for trust boundaries, abuse cases, and actionable security findings.", ["security", "review"], "coral"],
  ["git-pr-assistance", "Prepare focused Git changes and pull requests with useful context and verification notes.", ["git", "pull-request"], "blue"],
  ["react-review", "Review React changes for state behavior, accessibility, performance, and maintainability.", ["react", "frontend", "accessibility"], "mustard"],
  ["backend-api-review", "Review backend API changes for contracts, validation, authorization, and compatibility.", ["backend", "api", "security"], "coral"],
  ["sql-review", "Review SQL and database changes for correctness, migration safety, query behavior, and data integrity.", ["database", "sql", "migration"], "blue"],
  ["incident-triage", "Triage an operational incident into a bounded timeline, impact assessment, containment, and recovery plan.", ["operations", "incident", "reliability"], "mustard"],
  ["dependency-review", "Review dependency changes for compatibility, maintenance risk, license obligations, and supply-chain exposure.", ["dependencies", "supply-chain", "maintenance"], "coral"],
].map(([name, description, tags, accent]) => ({
  namespace: "agentcargo",
  name,
  description,
  latestVersion: "0.1.0",
  tags,
  compatibility: { codex: ["project", "user"], "claude-code": ["project", "user"] },
  hasScripts: false,
  publisher: "AgentCargo Maintainers",
  accent,
  files: ["SKILL.md", "agentcargo.yaml"],
  observed: ["Maintained starter fixture", "No executable files", "No network references"],
  findings: 0,
  digest: "sha256:starter-fixture",
  versions: [{ version: "0.1.0", status: "active", publishedAt: "Starter catalog", findings: 0, digest: "sha256:starter-fixture" }],
}));

const demoPackages: PackageSummary[] = [...demoPackagesBase, ...starterPackages];

const registryUrl = process.env.NEXT_PUBLIC_AGENTCARGO_REGISTRY_URL;

export default function Home() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [host, setHost] = useState<Host | "all">("all");
  const [scope, setScope] = useState<Scope | "all">("all");
  const [packages, setPackages] = useState(demoPackages);
  const [selected, setSelected] = useState(demoPackages[0]);
  const [selectedVersion, setSelectedVersion] = useState(demoPackages[0].latestVersion);
  const [copied, setCopied] = useState(false);
  const [remoteState, setRemoteState] = useState<"demo" | "live" | "error">("demo");

  useEffect(() => {
    if (!registryUrl || !submittedQuery.trim()) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ q: submittedQuery });
    if (host !== "all") params.set("host", host);
    if (scope !== "all") params.set("scope", scope);

    fetch(`${registryUrl.replace(/\/$/, "")}/v1/search?${params.toString()}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Registry search failed");
        return (await response.json()) as { items?: Array<Record<string, unknown>> };
      })
      .then((payload) => {
        const remotePackages = (payload.items ?? []).flatMap(toPackageSummary);
        setPackages(remotePackages);
        if (remotePackages[0]) {
          setSelected(remotePackages[0]);
          setSelectedVersion(remotePackages[0].latestVersion);
        }
        setRemoteState("live");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRemoteState("error");
      });

    return () => controller.abort();
  }, [host, scope, submittedQuery]);

  const visiblePackages = useMemo(() => {
    const normalizedQuery = submittedQuery.trim().toLowerCase();
    return packages.filter((item) => {
      const matchesText = !normalizedQuery || [item.name, item.namespace, item.description, ...item.tags].join(" ").toLowerCase().includes(normalizedQuery);
      const matchesHost = host === "all" || Boolean(item.compatibility[host]);
      const matchesScope = scope === "all" || Object.values(item.compatibility).some((scopes) => scopes?.includes(scope));
      return matchesText && matchesHost && matchesScope;
    });
  }, [host, packages, scope, submittedQuery]);

  const selectedRelease = selected.versions.find((release) => release.version === selectedVersion) ?? selected.versions[0] ?? {
    version: selected.latestVersion,
    status: "active" as const,
    publishedAt: "Unknown date",
    findings: selected.findings,
    digest: selected.digest,
  };
  const installCommand = `agentcargo add @${selected.namespace}/${selected.name}@${selectedRelease.version} --agent ${host === "all" ? "codex" : host} --scope ${scope === "all" ? "project" : scope}`;

  async function copyInstallCommand() {
    await navigator.clipboard?.writeText(installCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AgentCargo home">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>AgentCargo</span>
        </a>
        <nav className="top-nav" aria-label="Primary navigation">
          <a className="active" href="#explore">Explore</a>
          <a href="#trust">Trust model</a>
          <a href="/status">Status</a>
          <a href="#docs">Docs</a>
        </nav>
        <a className="quiet-button" href="/publish">Publish a skill <span aria-hidden="true">↗</span></a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> Portable skills, clearly described</p>
          <h1>Find the right skill for the work <em>ahead.</em></h1>
          <p className="hero-lede">AgentCargo is a public registry for reusable agent workflows. Search what a skill does, see what it contains, and know exactly what you are installing.</p>
        </div>
        <form className="search-form" onSubmit={(event) => { event.preventDefault(); setSubmittedQuery(query); }}>
          <label className="sr-only" htmlFor="registry-search">Search skills</label>
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input id="registry-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code review, API security, writing…" />
          <button type="submit">Search</button>
        </form>
        <div className="hero-meta"><span className="status-dot" /> {remoteState === "live" ? "Connected to live registry" : remoteState === "error" ? "Showing local catalog · registry unavailable" : "A small, curated catalog to start"}<span className="meta-separator">·</span> No sign-in required</div>
      </section>

      <section className="explore-section" id="explore">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Explore the catalog</p>
            <h2>{submittedQuery ? `Results for “${submittedQuery}”` : "Skills worth knowing"}</h2>
          </div>
          <span className="result-count">{visiblePackages.length} packages</span>
        </div>

        <div className="catalog-layout">
          <aside className="filters" aria-label="Catalog filters">
            <div className="filter-group">
              <span className="filter-label">Host</span>
              <div className="filter-options">
                {(["all", "codex", "claude-code"] as const).map((item) => <button key={item} className={host === item ? "filter-chip selected" : "filter-chip"} type="button" onClick={() => setHost(item)}>{item === "all" ? "Any host" : item === "claude-code" ? "Claude Code" : "Codex"}</button>)}
              </div>
            </div>
            <div className="filter-group">
              <span className="filter-label">Install scope</span>
              <div className="filter-options">
                {(["all", "project", "user"] as const).map((item) => <button key={item} className={scope === item ? "filter-chip selected" : "filter-chip"} type="button" onClick={() => setScope(item)}>{item === "all" ? "Any scope" : item[0].toUpperCase() + item.slice(1)}</button>)}
              </div>
            </div>
            <div className="filter-note"><span className="note-mark">i</span><p>Compatibility is <strong>declared by the publisher</strong>. It is not a sandbox.</p></div>
          </aside>

          <div className="results-list" aria-live="polite">
            {visiblePackages.length === 0 ? <div className="empty-state"><span className="empty-mark">⌕</span><h3>No matching skills yet</h3><p>Try a broader search or clear one of the filters.</p><button type="button" onClick={() => { setQuery(""); setSubmittedQuery(""); setHost("all"); setScope("all"); }}>Clear filters</button></div> : visiblePackages.map((item) => <button key={`${item.namespace}/${item.name}`} className={selected.name === item.name && selected.namespace === item.namespace ? "result-card active" : "result-card"} type="button" onClick={() => { setSelected(item); setSelectedVersion(item.latestVersion); }}>
              <span className={`result-accent ${item.accent}`} aria-hidden="true" />
              <span className="result-card-body">
                <span className="result-topline"><span className="package-coordinate">@{item.namespace}/{item.name}</span><span className="version">v{item.latestVersion}</span></span>
                <span className="result-description">{item.description}</span>
                <span className="result-bottomline"><span>{item.publisher}</span><span className="tag-list">{item.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}</span></span>
              </span>
              <span className="result-arrow" aria-hidden="true">↗</span>
            </button>)}
          </div>

          <article className="detail-panel" id="trust">
            <div className="detail-topline"><span className={`detail-accent ${selected.accent}`} /><span>Package detail</span><span className="detail-status">{selectedRelease.findings === 0 ? "No findings" : `${selectedRelease.findings} finding${selectedRelease.findings === 1 ? "" : "s"}`}</span></div>
            <h3>@{selected.namespace}/{selected.name}</h3>
            <p className="detail-description">{selected.description}</p>
            <div className="detail-meta"><span>v{selectedRelease.version}</span><span>·</span><span>{selected.publisher}</span><span>·</span><span className={`release-badge ${selectedRelease.status}`}>{selectedRelease.status}</span></div>

            <div className="trust-grid">
              <div className="trust-card declared"><span className="trust-label">Declared</span><strong>{Object.keys(selected.compatibility).length} compatible hosts</strong><span>{Object.entries(selected.compatibility).map(([key, scopes]) => `${key} · ${scopes?.join("/")}`).join("  /  ")}</span></div>
              <div className="trust-card observed"><span className="trust-label">Observed</span><strong>{selected.files.length} package files</strong><span>{selected.observed[0]}</span></div>
            </div>

            <div className="detail-section"><div className="detail-section-heading"><span>Artifact contents</span><span>{selected.files.length} files</span></div><ul className="file-list">{selected.files.map((file) => <li key={file}><span className="file-icon" aria-hidden="true">↳</span><code>{file}</code></li>)}</ul></div>
            <div className="detail-section version-history"><div className="detail-section-heading"><span>Version history</span><span>{selected.versions.length} releases</span></div><ul className="version-list">{selected.versions.map((release) => <li key={release.version}><button type="button" className={release.version === selectedRelease.version ? "version-row selected" : "version-row"} onClick={() => setSelectedVersion(release.version)}><span className="version-row-main"><strong>v{release.version}</strong><span className={`release-badge ${release.status}`}>{release.status}</span></span><span className="version-row-meta">{release.publishedAt} · {release.findings === 0 ? "No findings" : `${release.findings} finding${release.findings === 1 ? "" : "s"}`}</span></button></li>)}</ul><p className="version-history-note">Each release keeps its own immutable artifact and scan evidence.</p></div>
            <div className="detail-section"><div className="detail-section-heading"><span>Immutable artifact</span><span>SHA-256</span></div><code className="digest">{selectedRelease.digest}</code></div>

            <div className="install-block"><div><span className="install-kicker">Install with AgentCargo</span><code>{installCommand}</code></div><button type="button" onClick={copyInstallCommand} aria-label="Copy install command">{copied ? "Copied" : "Copy"}</button></div>
          </article>
        </div>
      </section>

      <footer className="footer" id="docs"><span>AgentCargo <span className="footer-muted">· Know exactly what you are trusting.</span></span><span className="footer-links"><a href="#trust">Trust model</a><a href="/status">Status</a><a href="https://agentskills.io/specification">Agent Skills spec ↗</a></span></footer>
    </main>
  );
}

function toPackageSummary(item: Record<string, unknown>): PackageSummary[] {
  const packageValue = item.package;
  if (!packageValue || typeof packageValue !== "object") return [];
  const coordinate = packageValue as { namespace?: unknown; name?: unknown };
  if (typeof coordinate.namespace !== "string" || typeof coordinate.name !== "string") return [];
  const latestVersion = typeof item.latestVersion === "string" ? item.latestVersion : "0.0.0";
  return [{
    namespace: coordinate.namespace,
    name: coordinate.name,
    description: typeof item.description === "string" ? item.description : "No description provided.",
    latestVersion,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
    compatibility: {},
    hasScripts: item.hasScripts === true,
    publisher: "Registry publisher",
    accent: "blue",
    files: ["SKILL.md"],
    observed: ["Metadata returned by registry"],
    findings: 0,
    digest: "sha256:pending",
    versions: [{ version: latestVersion, status: "active", publishedAt: "Registry release", findings: 0, digest: "sha256:pending" }],
  }];
}
