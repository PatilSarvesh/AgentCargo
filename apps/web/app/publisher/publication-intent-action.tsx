"use client";

import type { FormEvent } from "react";
import { useState } from "react";

type IntentState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "reserved"; coordinate: string; releaseId: string; expiresAt: string; replayed: boolean };

export function PublicationIntentAction() {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [state, setState] = useState<IntentState>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "working" });
    const idempotencyKey = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `web-${Date.now()}`;
    try {
      const response = await fetch("/api/publisher-publication", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim().toLowerCase(), version: version.trim(), idempotencyKey }),
      });
      const body = await response.json() as unknown;
      if (!response.ok) {
        const error = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string" ? body.error.message : "Publication intent was not accepted.";
        setState({ kind: "error", message: error });
        return;
      }
      if (!isRecord(body) || !isRecord(body.coordinate) || typeof body.coordinate.namespace !== "string" || typeof body.coordinate.name !== "string" || typeof body.coordinate.version !== "string" || typeof body.releaseId !== "string" || typeof body.expiresAt !== "string") {
        setState({ kind: "error", message: "The server returned invalid reservation metadata." });
        return;
      }
      const coordinate = body.coordinate;
      setState({
        kind: "reserved",
        coordinate: `@${coordinate.namespace}/${coordinate.name}@${coordinate.version}`,
        releaseId: body.releaseId,
        expiresAt: body.expiresAt,
        replayed: body.replayed === true,
      });
    } catch {
      setState({ kind: "error", message: "The publication service is unavailable." });
    }
  }

  return <section className="publisher-intent-card" aria-label="Start browser publication">
    <div className="builder-card-heading compact"><div><p className="section-kicker">Start publication</p><h2>Reserve a release handoff</h2></div><span className="builder-step">Write-scoped</span></div>
    <p className="publisher-intent-copy">Enter only the skill name and version. AgentCargo derives your owned namespace from the authenticated workspace; this browser action accepts no namespace selector, package files, or credentials.</p>
    <form className="publisher-intent-form" onSubmit={submit}>
      <label className="field-label" htmlFor="publication-name">Skill name</label>
      <input id="publication-name" className="builder-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="code-review" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={64} />
      <label className="field-label" htmlFor="publication-version">Version</label>
      <input id="publication-version" className="builder-input" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" required pattern="(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+)?" />
      <button className="builder-submit" type="submit" disabled={state.kind === "working" || name.trim().length === 0}>{state.kind === "working" ? "Requesting…" : "Start publication handoff"}<span aria-hidden="true">→</span></button>
    </form>
    {state.kind === "error" ? <p className="publisher-intent-error" role="status">{state.message}</p> : null}
    {state.kind === "reserved" ? <div className="publisher-intent-result" role="status"><strong>{state.replayed ? "Existing reservation confirmed" : "Release reserved"}</strong><code>{state.coordinate}</code><span>Release ID {state.releaseId} · expires {new Date(state.expiresAt).toLocaleString()}</span><p>Continue upload, scanning, and activation through the authenticated CLI. No package files were accepted by this browser action.</p></div> : null}
  </section>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
