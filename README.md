# AgentCargo

AgentCargo is a cross-agent registry and package manager for reusable AI-agent skills.

Creators publish a skill once. Developers can then discover, inspect, install, update, and remove it through a single CLI while AgentCargo handles package integrity, versioning, and agent-specific installation.

## Project status

AgentCargo is in early MVP development. The local workflow can create, validate, deterministically package, and install a skill into Codex project or user scope with SHA-256 verification and ownership tracking. Registry publishing and remote installation are not implemented yet.

## Try the current CLI

Requirements: Node.js 22 or newer and pnpm 11.

```bash
pnpm install
pnpm verify

# Create a skill in a new directory
pnpm dev:cli init ./my-skill \
  --description "Explain what the skill does and when an agent should use it."

# Validate it
pnpm dev:cli validate ./my-skill

# Create a deterministic .agentcargo artifact
pnpm dev:cli pack ./my-skill

# Install into an isolated Codex project
mkdir ./agentcargo-demo
pnpm dev:cli add ./examples/hello-skill \
  --agent codex \
  --scope project \
  --project-root ./agentcargo-demo

# Validate the checked-in example
pnpm dev:cli validate ./examples/hello-skill
```

Machine-readable validation and packing output are available with `--json`.

## Product principles

- Use open skill formats instead of inventing another authoring standard.
- Keep the CLI, package specification, adapters, and validation rules open source.
- Make every release immutable and verifiable.
- Present security evidence, not misleading numerical trust scores.
- Separate declared permissions, observed behavior, and host-enforced restrictions.
- Prefer a narrow, reliable MVP over a large marketplace with incomplete workflows.

## Documents

- [Project context for contributors and coding agents](AGENTS.md)
- [Current implementation status](docs/STATUS.md)
- [Product requirements](docs/PRD.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Implementation roadmap](docs/ROADMAP.md)

## Proposed CLI experience

```bash
agentcargo search "react code review"
agentcargo inspect @acme/react-review
agentcargo add @acme/react-review --agent codex --scope project
agentcargo update --dry-run
agentcargo audit
```

Local-path `init`, `validate`, `pack`, and `add` are implemented today. The remaining commands describe the MVP direction.

## Initial open-source boundary

The CLI, core package library, package specification, adapters, validation rules, and example skills should be public. The hosted registry can remain a separately deployed service while the project is being validated.
