"use client";

import { useState } from "react";

export function RegistrySessionAction({ mode }: { mode: "connect" | "disconnect" }) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");

  async function run() {
    setState("working");
    try {
      const response = await fetch("/api/registry-session", {
        method: mode === "connect" ? "POST" : "DELETE",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Registry session request failed.");
      window.location.reload();
    } catch {
      setState("error");
    }
  }

  return <div className="publisher-session-action">
    <button className="publisher-small-action" type="button" disabled={state === "working"} onClick={run}>
      {state === "working" ? "Working…" : mode === "connect" ? "Connect registry" : "Disconnect"}
    </button>
    {state === "error" ? <span role="status">Registry access is not configured or is temporarily unavailable.</span> : null}
  </div>;
}
