import Link from "next/link";
import { headers } from "next/headers";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "../chatgpt-auth";
import { PUBLISHER_READ_SCOPE } from "../registry-session";
import { registryPublisherWorkspaceResolver } from "../registry-session-config";
import { loadPublisherWorkspace, type PublisherReleaseSummary } from "../publisher-workspace";
import { RegistrySessionAction } from "./registry-session-action";
import { PublicationIntentAction } from "./publication-intent-action";

export const dynamic = "force-dynamic";

export default async function PublisherPage() {
  const user = await getChatGPTUser();
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");
  const workspaceResult = user
    ? await loadPublisherWorkspace(new Request("https://agentcargo.local/publisher", {
      ...(cookie ? { headers: { cookie } } : {}),
    }), registryPublisherWorkspaceResolver)
    : { state: "absent" as const };
  const workspace = workspaceResult.state === "active" ? workspaceResult.workspace : null;
  const namespaces = workspace?.namespaces ?? [];
  const packages = namespaces.flatMap((namespace) => namespace.packages);
  const releases = packages.flatMap((item) => item.releases);
  const signInPath = chatGPTSignInPath("/publisher");
  const signOutPath = chatGPTSignOutPath("/publisher");
  const access = registryAccessPresentation(workspaceResult.state);

  return (
    <main className="site-shell publisher-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="AgentCargo home">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>AgentCargo</span>
        </Link>
        <nav className="top-nav" aria-label="Publisher navigation">
          <Link href="/">Explore</Link>
          <Link className="active" href="/publisher">Publisher workspace</Link>
        </nav>
        {user ? <Link className="quiet-button" href={signOutPath}>Sign out <span aria-hidden="true">↗</span></Link> : <Link className="quiet-button" href={signInPath}>Sign in to publish <span aria-hidden="true">↗</span></Link>}
      </header>

      <section className="publisher-hero">
        <p className="eyebrow"><span className="eyebrow-dot" /> Publisher workspace</p>
        <h1>{user ? <>Welcome, <em>{user.displayName}.</em></> : <>Build trust <em>before</em> publishing.</>}</h1>
        <p className="hero-lede">{user ? "Review the namespaces, packages, and immutable release history authorized by your AgentCargo session." : "The catalog stays public. Sign in only when you need publisher actions tied to your identity."}</p>
      </section>

      <section className="publisher-content" aria-label="Publisher workspace">
        {!user ? <div className="publisher-gate">
          <div className="publisher-gate-icon" aria-hidden="true">↗</div>
          <div><p className="section-kicker">Publisher access</p><h2>Sign in to manage releases</h2><p>Workspace identity starts the sign-in flow, but identity alone never grants namespace access. A separate read-scoped AgentCargo session is required.</p></div>
          <Link className="builder-submit publisher-gate-action" href={signInPath}>Sign in with ChatGPT <span aria-hidden="true">→</span></Link>
        </div> : <div className="identity-banner"><div className="identity-avatar" aria-hidden="true">{user.displayName[0]?.toUpperCase() ?? "A"}</div><div><span className="trust-label">Signed-in identity</span><strong>{user.displayName}</strong><span>{user.email}</span></div><span className="identity-note">Identity verified by workspace headers</span></div>}

        <section className="publisher-access-card" aria-label="Registry access status">
          <div className="publisher-access-heading"><div><p className="section-kicker">Registry access</p><h2>Publisher read session</h2></div><span className={`publisher-status ${access.className}`}>{access.label}</span></div>
          <p className="publisher-access-copy">{user ? access.description : "Sign in before requesting a read-scoped registry session."}</p>
          <dl className="publisher-access-details">
            <div><dt>Selected scope</dt><dd><code>{PUBLISHER_READ_SCOPE}</code> · read-only</dd></div>
            <div><dt>Version history</dt><dd>{workspace ? "Registry-backed package records" : "Unavailable without an active session"}</dd></div>
            <div><dt>Browser tokens</dt><dd>HttpOnly and never displayed</dd></div>
          </dl>
          {user ? <RegistrySessionAction mode={workspaceResult.state === "absent" || workspaceResult.state === "unconfigured" ? "connect" : "disconnect"} /> : null}
        </section>

        {workspace ? <>
          <PublicationIntentAction />
          <div className="publisher-summary">
            <div className="publisher-stat"><span className="trust-label">Namespaces</span><strong>{namespaces.length}</strong><span>Owned by this publisher identity</span></div>
            <div className="publisher-stat"><span className="trust-label">Packages</span><strong>{packages.length}</strong><span>Immutable package names</span></div>
            <div className="publisher-stat"><span className="trust-label">Releases</span><strong>{releases.length}</strong><span>Reserved and published versions</span></div>
          </div>

          <section className="publisher-list-card">
            <div className="builder-card-heading"><div><p className="section-kicker">Registry records</p><h2>Your skills and versions</h2></div><Link className="publisher-small-link" href="/publish">Draft a skill →</Link></div>
            {namespaces.length === 0 ? <p className="publisher-empty">No namespace is owned by this publisher identity yet.</p> : <div className="publisher-namespace-list">{namespaces.map((namespace) => <section className="publisher-namespace" key={namespace.namespace}>
              <div className="publisher-namespace-heading"><h3>@{namespace.namespace}</h3><span>{namespace.packages.length} package{namespace.packages.length === 1 ? "" : "s"}</span></div>
              {namespace.packages.length === 0 ? <p className="publisher-empty">No release versions have been reserved in this namespace.</p> : <div className="publisher-package-list">{namespace.packages.map((item) => <details className="publisher-package-history" key={item.package.name}>
                <summary className="publisher-package-row"><div><span className="package-coordinate">@{namespace.namespace}/{item.package.name}</span><span className="publisher-package-meta">{item.latestVersion ? `Latest public v${item.latestVersion}` : "No active public release"} · {item.releases.length} immutable version{item.releases.length === 1 ? "" : "s"}</span></div><span className="publisher-history-toggle">View history</span></summary>
                <div className="publisher-version-list">{item.releases.map((release) => <VersionRow key={release.releaseId} release={release} />)}</div>
              </details>)}</div>}
            </section>)}</div>}
            <p className="publisher-boundary"><span className="note-mark">i</span> Registry records remain read-only. The handoff above reserves only a server-derived release coordinate; artifact upload, scanning, activation, deprecation, and quarantine stay on guarded registry/CLI workflows.</p>
          </section>
        </> : user ? <section className="publisher-list-card publisher-empty-card"><p className="section-kicker">Registry records</p><h2>Connect to load your package history</h2><p>No demo publisher data is shown here. Only records returned for a valid <code>{PUBLISHER_READ_SCOPE}</code> session will appear.</p></section> : null}
      </section>

      <footer className="footer"><span>AgentCargo <span className="footer-muted">· Publisher context without hidden trust.</span></span><Link href="/">Return to catalog ↗</Link></footer>
    </main>
  );
}

function VersionRow({ release }: { release: PublisherReleaseSummary }) {
  const date = release.publishedAt ?? release.completedAt ?? release.createdAt;
  return <article className="publisher-version-row">
    <div><strong>v{release.version}</strong><span>{formatDate(date)}{release.digest ? ` · ${shortDigest(release.digest)}` : ""}</span></div>
    <span className={`publisher-status ${release.status}`}>{release.status}</span>
  </article>;
}

function registryAccessPresentation(state: "absent" | "unconfigured" | "unavailable" | "invalid" | "active") {
  if (state === "active") return { label: "Connected", className: "active", description: "A valid read-scoped AgentCargo session is loading only the namespaces and releases owned by its publisher identity." };
  if (state === "unavailable") return { label: "Unavailable", className: "rejected", description: "The registry could not be reached. Disconnect the stale cookie or try again later." };
  if (state === "invalid") return { label: "Expired", className: "expired", description: "The registry rejected this session. Disconnect it, then request a new read-scoped session." };
  if (state === "unconfigured") return { label: "Not configured", className: "draft", description: "This host has not configured the server-only publisher registry connection." };
  return { label: "Not connected", className: "draft", description: "Request a read-scoped AgentCargo session to load your publisher records." };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function shortDigest(value: string): string {
  return value.length > 24 ? `${value.slice(0, 15)}…${value.slice(-8)}` : value;
}
