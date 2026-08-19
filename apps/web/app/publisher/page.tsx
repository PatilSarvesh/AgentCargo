import Link from "next/link";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "../chatgpt-auth";
import { describeBrowserRegistrySession } from "../registry-session";

export const dynamic = "force-dynamic";

const publisherPackages = [
  { name: "patch-review", latest: "1.4.0", releases: 3, findings: 0, status: "Active" },
  { name: "release-notes", latest: "0.3.0", releases: 1, findings: 0, status: "Draft" },
];

export default async function PublisherPage() {
  const user = await getChatGPTUser();
  const registrySession = describeBrowserRegistrySession(user);
  const signInPath = chatGPTSignInPath("/publisher");
  const signOutPath = chatGPTSignOutPath("/publisher");

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
        <p className="hero-lede">{user ? "Review your local package record and release history before connecting an authenticated registry workflow." : "The catalog stays public. Sign in only when you need publisher actions tied to your identity."}</p>
      </section>

      <section className="publisher-content" aria-label="Publisher workspace">
        {!user ? <div className="publisher-gate">
          <div className="publisher-gate-icon" aria-hidden="true">↗</div>
          <div><p className="section-kicker">Publisher access</p><h2>Sign in to manage releases</h2><p>AgentCargo uses the workspace identity boundary for sign-in. This local preview never receives or displays provider tokens, and identity alone does not grant namespace access.</p></div>
          <Link className="builder-submit publisher-gate-action" href={signInPath}>Sign in with ChatGPT <span aria-hidden="true">→</span></Link>
        </div> : <div className="identity-banner"><div className="identity-avatar" aria-hidden="true">{user.displayName[0]?.toUpperCase() ?? "A"}</div><div><span className="trust-label">Signed-in identity</span><strong>{user.displayName}</strong><span>{user.email}</span></div><span className="identity-note">Identity verified by workspace headers</span></div>}

        <section className="publisher-access-card" aria-label="Registry access status">
          <div className="publisher-access-heading"><div><p className="section-kicker">Registry access</p><h2>Read-only session boundary</h2></div><span className="publisher-status draft">Not connected</span></div>
          <p className="publisher-access-copy">{registrySession.workspaceIdentity ? "Workspace identity is available for display, but this local preview has not exchanged it for an AgentCargo registry session." : "A workspace identity is not available yet, so no registry session can be requested in this local preview."}</p>
          <dl className="publisher-access-details">
            <div><dt>Planned scope</dt><dd><code>{registrySession.plannedScopes[0]}</code> · read-only</dd></div>
            <div><dt>Publisher writes</dt><dd>Unavailable until a registry session is issued</dd></div>
            <div><dt>Browser tokens</dt><dd>Never stored or displayed</dd></div>
          </dl>
        </section>

        <div className="publisher-summary">
          <div className="publisher-stat"><span className="trust-label">Namespace</span><strong>studio</strong><span>Publisher namespace</span></div>
          <div className="publisher-stat"><span className="trust-label">Packages</span><strong>{publisherPackages.length}</strong><span>Local workspace records</span></div>
          <div className="publisher-stat"><span className="trust-label">Releases</span><strong>{publisherPackages.reduce((total, item) => total + item.releases, 0)}</strong><span>Immutable history entries</span></div>
        </div>

        <section className="publisher-list-card">
          <div className="builder-card-heading"><div><p className="section-kicker">Package records</p><h2>Your skills</h2></div><Link className="publisher-small-link" href="/publish">Draft a skill →</Link></div>
          <div className="publisher-package-list">{publisherPackages.map((item) => <article className="publisher-package-row" key={item.name}><div><span className="package-coordinate">@studio/{item.name}</span><span className="publisher-package-meta">Latest v{item.latest} · {item.releases} release{item.releases === 1 ? "" : "s"} · {item.findings === 0 ? "No findings" : `${item.findings} finding${item.findings === 1 ? "" : "s"}`}</span></div><span className={`publisher-status ${item.status.toLowerCase()}`}>{item.status}</span></article>)}</div>
          <p className="publisher-boundary"><span className="note-mark">i</span> This workspace is read-only in the local demo. Publication still happens explicitly through <code>agentcargo publish</code>.</p>
        </section>
      </section>

      <footer className="footer"><span>AgentCargo <span className="footer-muted">· Publisher context without hidden trust.</span></span><Link href="/">Return to catalog ↗</Link></footer>
    </main>
  );
}
