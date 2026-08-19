# AgentCargo

AgentCargo is a cross-agent registry and package manager for reusable AI-agent skills.

Creators publish a skill once. Developers can then discover, inspect, install, update, and remove it through a single CLI while AgentCargo handles package integrity, versioning, and agent-specific installation.

## Project status

AgentCargo is in early MVP development. The local workflow can create, validate, deterministically package, install, inspect, safely remove, and diagnose a skill in Codex or Claude Code project and user scopes with SHA-256 verification and ownership tracking. Anonymous registry search, inspection, and digest-verified public installation are available when a registry URL is configured. The CLI also supports permission-restricted GitHub device-flow login, identity revalidation, refresh, status, logout, and authenticated local publication into a registry's scanning workflow; hosted publisher pages and browser publication are still pending.

Claude Code is the selected second MVP host, with a versioned adapter and shared contract tests alongside Codex.

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

# Inspect the installation and any local drift
pnpm dev:cli list \
  --agent codex \
  --scope project \
  --project-root ./agentcargo-demo

# Diagnose host paths, lockfiles, drift, and interrupted operations
pnpm dev:cli doctor \
  --agent codex \
  --scope project \
  --project-root ./agentcargo-demo

# Remove an unchanged installation after explicit confirmation
pnpm dev:cli remove hello-skill \
  --agent codex \
  --scope project \
  --project-root ./agentcargo-demo \
  --yes

# Validate the checked-in example
pnpm dev:cli validate ./examples/hello-skill

# Run versioned static observations (files are never executed)
pnpm dev:cli scan ./examples/hello-skill

# Search a configured anonymous registry
AGENTCARGO_REGISTRY_URL=https://registry.example.test \
  pnpm dev:cli search "code review"

# Inspect a package or exact release
AGENTCARGO_REGISTRY_URL=https://registry.example.test \
  pnpm dev:cli inspect @acme/review@1.2.3

# Inspect or remove the local registry credential without printing its token
AGENTCARGO_REGISTRY_URL=https://registry.example.test \
  pnpm dev:cli auth status --json

# Sign in with the GitHub device flow. Set the client ID in the environment;
# the command never accepts or prints access/refresh tokens.
AGENTCARGO_REGISTRY_URL=https://registry.example.test \
AGENTCARGO_GITHUB_CLIENT_ID=Iv1.example \
  pnpm dev:cli auth login

# Refresh the stored credential when a refresh token is available
AGENTCARGO_REGISTRY_URL=https://registry.example.test \
AGENTCARGO_GITHUB_CLIENT_ID=Iv1.example \
  pnpm dev:cli auth refresh --json

# Publish a validated local skill after authenticating with the registry
AGENTCARGO_REGISTRY_URL=https://registry.example.test \
  pnpm dev:cli publish ./my-skill --namespace acme --json
```

Machine-readable output is available with `--json`. Removal refuses local drift unless `--force --yes` is provided; forced removal still preserves untracked files and refuses links or special files.

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
- [Threat model](docs/THREAT_MODEL.md)
- [Claude Code host contract](docs/hosts/claude-code.md)
- [Host adapter development](docs/ADAPTERS.md)
- [Registry read-path contract](docs/adr/0006-registry-read-path-contract.md)
- [Registry OpenAPI 3.1 document](packages/registry-contract/openapi/registry-v1.json)
- [Registry integration test](docs/REGISTRY_INTEGRATION.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## CLI experience

```bash
agentcargo search "react code review"
agentcargo inspect @acme/react-review
agentcargo add @acme/react-review --agent codex --scope project
agentcargo update @acme/react-review --dry-run
agentcargo update @acme/react-review --yes
agentcargo rollback @acme/react-review --agent codex --scope project --yes
agentcargo audit
```

Local-path `init`, `validate`, `scan`, `pack`, `add`, `list`, `remove`, `doctor`, `audit`, atomic registry `update`/`rollback`, and authenticated `publish`, plus anonymous registry `search`, `inspect`, digest-verified coordinate `add`, and GitHub auth `login`, `refresh`, `status`, and `logout`, are implemented today. The local browser skill builder is also implemented; authenticated hosted publisher pages remain future work.

## Open-source boundary

AgentCargo's CLI, core libraries, package contracts, adapters, validation and scanner rules, public API contracts, documentation, and project examples are licensed under [Apache License 2.0](LICENSE). Publisher skill packages retain their own declared licenses. The hosted registry implementation may be separately deployed or licensed while its public contracts remain open and versioned; see [ADR 0004](docs/adr/0004-open-source-boundary-and-license.md).
