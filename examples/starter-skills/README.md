# AgentCargo starter skills

These ten instruction-only skills are the maintained seed set for the public-beta catalog. They are deliberately small, reviewable fixtures that exercise the native Agent Skills format and both first-party adapters.

The catalog is opt-in: AgentCargo may recommend these skills, but it never installs them without an explicit user action. The entries are local starter fixtures until they are published as immutable registry releases.

Each skill has:

- a root `SKILL.md` with native Agent Skills frontmatter;
- an `agentcargo.yaml` manifest with Codex and Claude Code compatibility;
- no scripts, network declarations, environment access, or executable files;
- a matching entry in [`catalog.json`](catalog.json).

Validate and scan the complete seed set with:

```bash
pnpm --filter @agentcargo/core test
```

The starter-fixture test validates every directory against the shared core and rejects catalog drift, invalid metadata, or scanner findings.
