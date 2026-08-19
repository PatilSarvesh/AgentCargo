"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Host = "codex" | "claude-code";
type Scope = "project" | "user";

const hosts: readonly Host[] = ["codex", "claude-code"];
const scopes: readonly Scope[] = ["project", "user"];

export default function PublishPage() {
  const [name, setName] = useState("my-skill");
  const [description, setDescription] = useState("Explain what this skill does and when an agent should use it.");
  const [version, setVersion] = useState("0.1.0");
  const [namespace, setNamespace] = useState("your-namespace");
  const [selectedHosts, setSelectedHosts] = useState<Record<Host, boolean>>({ codex: true, "claude-code": true });
  const [selectedScopes, setSelectedScopes] = useState<Record<Scope, boolean>>({ project: true, user: true });
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const normalizedName = name.trim().toLowerCase();
  const nameIsValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedName) && normalizedName.length <= 64;
  const normalizedNamespace = namespace.trim().toLowerCase();
  const namespaceIsValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedNamespace) && normalizedNamespace.length <= 64;
  const versionIsValid = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+)?$/.test(version.trim());
  const descriptionIsValid = description.trim().length > 0 && description.trim().length <= 1024;
  const selectedHostNames = hosts.filter((host) => selectedHosts[host]);
  const selectedScopeNames = scopes.filter((scope) => selectedScopes[scope]);
  const canGenerate = nameIsValid && namespaceIsValid && versionIsValid && descriptionIsValid && selectedHostNames.length > 0 && selectedScopeNames.length > 0;

  const skillMarkdown = useMemo(() => `---\nname: ${normalizedName || "my-skill"}\ndescription: ${yamlString(description.trim() || "Explain what this skill does.")}\n---\n\n# ${titleCase(normalizedName || "my-skill")}\n\n## Instructions\n\nDescribe the workflow the AI agent should follow.\n`, [description, normalizedName]);

  const manifestYaml = useMemo(() => {
    const compatibility = selectedHostNames.map((host) => `  ${host}:\n    scopes:\n${selectedScopeNames.map((scope) => `      - ${scope}`).join("\n")}`).join("\n");
    return `schema_version: 1\nname: ${normalizedName || "my-skill"}\nversion: ${version.trim() || "0.1.0"}\ndescription: ${yamlString(description.trim() || "Explain what this skill does.")}\ncompatibility:\n${compatibility}\ncapabilities:\n  shell: false\n  network: false\n  environment: []\ntags: []\n`;
  }, [description, normalizedName, selectedHostNames, selectedScopeNames, version]);

  const publishCommand = `agentcargo publish ./${normalizedName || "my-skill"} --namespace ${normalizedNamespace || "your-namespace"} --registry https://registry.example.test`;

  function toggleHost(host: Host) {
    setSelectedHosts((current) => ({ ...current, [host]: !current[host] }));
  }

  function toggleScope(scope: Scope) {
    setSelectedScopes((current) => ({ ...current, [scope]: !current[scope] }));
  }

  async function copyValue(key: string, value: string) {
    await navigator.clipboard?.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <main className="site-shell publish-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="AgentCargo home">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>AgentCargo</span>
        </Link>
        <Link className="quiet-button" href="/">Back to catalog <span aria-hidden="true">↩</span></Link>
      </header>

      <section className="publish-hero">
        <p className="eyebrow"><span className="eyebrow-dot" /> Draft an instruction-only skill</p>
        <h1>Make a useful skill <em>clear.</em></h1>
        <p className="hero-lede">Create the two files AgentCargo needs, review the generated instructions, then publish locally with the CLI. Nothing is uploaded from this browser page.</p>
      </section>

      <section className="builder-layout" aria-label="Skill builder">
        <form className="builder-card" onSubmit={(event) => { event.preventDefault(); if (canGenerate) setGenerated(true); }}>
          <div className="builder-card-heading">
            <div><p className="section-kicker">01 · Describe</p><h2>Skill details</h2></div>
            <span className="builder-step">Local draft</span>
          </div>
          <label className="field-label" htmlFor="skill-name">Skill name</label>
          <input id="skill-name" className="builder-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="code-review" />
          {!nameIsValid && name.length > 0 ? <p className="field-error">Use lowercase letters, numbers, and single hyphens.</p> : null}
          <label className="field-label" htmlFor="skill-description">Description</label>
          <textarea id="skill-description" className="builder-textarea" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
          <div className="field-hint"><span>{description.trim().length}/1024</span><span>Tell agents when to use it.</span></div>
          <div className="builder-two-col">
            <div><label className="field-label" htmlFor="skill-version">Version</label><input id="skill-version" className="builder-input" value={version} onChange={(event) => setVersion(event.target.value)} /></div>
            <div><label className="field-label" htmlFor="skill-namespace">Namespace for CLI publish</label><input id="skill-namespace" className="builder-input" value={namespace} onChange={(event) => setNamespace(event.target.value)} />{!namespaceIsValid && namespace.length > 0 ? <p className="field-error">Use lowercase letters, numbers, and single hyphens.</p> : null}</div>
          </div>

          <div className="builder-divider" />
          <div className="builder-card-heading compact"><div><p className="section-kicker">02 · Declare</p><h2>Compatibility</h2></div></div>
          <fieldset className="choice-group"><legend className="field-label">Hosts</legend><div className="choice-row">{hosts.map((host) => <label className="choice" key={host}><input type="checkbox" checked={selectedHosts[host]} onChange={() => toggleHost(host)} /><span>{host === "claude-code" ? "Claude Code" : "Codex"}</span></label>)}</div></fieldset>
          <fieldset className="choice-group"><legend className="field-label">Install scopes</legend><div className="choice-row">{scopes.map((scope) => <label className="choice" key={scope}><input type="checkbox" checked={selectedScopes[scope]} onChange={() => toggleScope(scope)} /><span>{scope[0].toUpperCase() + scope.slice(1)}</span></label>)}</div></fieldset>
          <p className="builder-note"><span className="note-mark">i</span> Compatibility is a publisher declaration. AgentCargo does not treat it as a sandbox.</p>
          <button className="builder-submit" type="submit" disabled={!canGenerate}>{generated ? "Refresh draft" : "Generate skill files"}<span aria-hidden="true">→</span></button>
        </form>

        <aside className="preview-card" aria-live="polite">
          <div className="builder-card-heading"><div><p className="section-kicker">03 · Review</p><h2>Generated files</h2></div><span className={generated ? "preview-status ready" : "preview-status"}>{generated ? "Ready to review" : "Fill the form"}</span></div>
          {generated ? <>
            <PreviewFile name="SKILL.md" value={skillMarkdown} copied={copied === "skill"} onCopy={() => copyValue("skill", skillMarkdown)} />
            <PreviewFile name="agentcargo.yaml" value={manifestYaml} copied={copied === "manifest"} onCopy={() => copyValue("manifest", manifestYaml)} />
            <div className="publish-next"><span className="install-kicker">Publish after local review</span><code>{publishCommand}</code><button type="button" onClick={() => copyValue("command", publishCommand)}>{copied === "command" ? "Copied" : "Copy command"}</button></div>
          </> : <div className="preview-empty"><span className="preview-empty-mark">✦</span><h3>Your package starts here</h3><p>Choose the description and compatibility that should be visible to users before you generate the files.</p></div>}
        </aside>
      </section>

      <footer className="footer"><span>AgentCargo <span className="footer-muted">· Draft locally. Publish deliberately.</span></span><Link href="/">Return to catalog ↗</Link></footer>
    </main>
  );
}

function PreviewFile({ name, value, copied, onCopy }: { name: string; value: string; copied: boolean; onCopy: () => void }) {
  return <section className="preview-file"><div className="preview-file-heading"><code>{name}</code><button type="button" onClick={onCopy}>{copied ? "Copied" : "Copy"}</button></div><pre>{value}</pre></section>;
}

function titleCase(value: string): string {
  return value.split("-").map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part).join(" ");
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
