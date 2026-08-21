# AgentCargo platform support

_MVP support matrix; reviewed 2026-08-20._

AgentCargo separates package-format support, CLI runtime support, and host
behavior. A compatible package is not evidence that every host enforces the
same restrictions.

## Supported first-party surfaces

| Surface | Support in this repository |
| --- | --- |
| CLI runtime | Node.js 22 or newer; the workspace is managed with pnpm 11. The release bundle records its runtime requirements. |
| Operating systems | macOS, Linux, and Windows are exercised by the CI matrix. Filesystem and permission behavior remains host/OS specific. |
| Codex adapter | Project skills: `<project-root>/.agents/skills/<name>`; user skills: `<user-home>/.agents/skills/<name>`. |
| Claude Code adapter | Project skills: `<project-root>/.claude/skills/<name>`; user skills: `<user-home>/.claude/skills/<name>`. |
| Registry API/catalog | Anonymous search, inspection, public release reads, and digest-verified CLI installation when a registry URL is configured. |
| Publisher authentication | GitHub identity at the provider boundary; publisher mutations use short-lived scoped AgentCargo sessions. |

The native package contract is a root `SKILL.md` plus `agentcargo.yaml`, with
optional `scripts/`, `references/`, `assets/`, and host metadata. The selected
adapter decides which files are host-ready. See [ADAPTERS.md](ADAPTERS.md),
the [Codex host guidance](../AGENTS.md), and the
[Claude Code contract](hosts/claude-code.md) before adding another host.

## Browser and local development boundaries

The public browser can browse and create a local instruction-only draft. It
does not install files directly into a user's filesystem, upload package files,
or execute community scripts. CLI publication and installation remain the
explicit boundaries for those actions.

AgentCargo's local web app defaults to port `3000`. If another local project
such as Bridge owns that port, run AgentCargo on a free port, for example:

```bash
AGENTCARGO_WEB_PORT=3001 pnpm --dir apps/web dev
```

The validated `--port` argument takes precedence when using the local wrapper.
This setting changes only AgentCargo's local process; it does not change Bridge
or a hosted deployment.

## Not supported in the MVP

- Direct GitHub repository import or synchronization.
- Private repositories, private organization registries, or SSO policy
  management.
- Every AI editor or host; third-party adapters require the documented
  contract and review process.
- Browser filesystem installation or browser package upload/activation.
- Automatic execution of uploaded community scripts in registry infrastructure.
- Transitive dependency resolution or automatic installation of a skill's
  descriptive runtime requirements.

Compatibility, capabilities, and dependencies are declarations. Enforcement is
reported only when the selected adapter or host provides verifiable evidence.
