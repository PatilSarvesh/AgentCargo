# AgentCargo Project Context

This file is the durable context for contributors and coding agents working in this repository. Read it before making project decisions. After a material product or architecture decision, update this file. After implementing or verifying work, update `docs/STATUS.md`.

## Product summary

AgentCargo is a cross-agent registry and package manager for reusable AI-agent skills.

The intended experience is:

```text
Creator builds a skill
    -> AgentCargo validates and versions it
    -> Skill appears in the public registry
    -> Developer discovers and inspects it
    -> AgentCargo CLI verifies and installs it
    -> A host such as Codex loads and uses it
```

AgentCargo manages skills; it does not execute the skill workflow. The target AI agent executes the installed instructions and optional scripts.

## Product promise

> Publish an agent skill once, install it anywhere, and know exactly what you are trusting.

## Naming

- Product and working brand: `AgentCargo`.
- CLI command: `agentcargo`.
- Registry metadata file: `agentcargo.yaml`.
- Installation lockfile: `agentcargo.lock` (schema version 1).
- Package coordinate format: `@namespace/name@version`.
- The local repository directory is still named `SkillHub`; do not treat that folder name as the product name.
- AgentCargo passed a preliminary collision search, but domain, package-registry, trademark, and legal clearance have not been completed.

## Target users

1. Skill consumers who want to discover and safely install reusable workflows.
2. Skill creators who want to create or publish once instead of handling each AI agent manually.
3. Registry maintainers who need validation, moderation, quarantine, and audit controls.

## MVP definition

The MVP includes:

- Public website for anonymous browsing, searching, inspection, and installation-command copying.
- Creator authentication using GitHub identity.
- Simple browser builder for instruction-only skills.
- Local CLI creation, validation, publication, installation, update, rollback, audit, and removal.
- Curated starter skills available in the catalog but not automatically installed.
- Immutable semantic versions and SHA-256 artifact verification.
- Project and user installation scopes.
- Codex support first, followed by one verified second host.
- Static validation and explainable findings.
- Basic reporting, quarantine, and digest-denylist support.

The MVP excludes:

- Direct GitHub repository import and synchronization.
- Private repositories and private organization registries.
- Support for every AI editor.
- Executing uploaded community scripts in AgentCargo infrastructure.
- Composite security or quality scores.
- Model-based benchmarks and Skill Arena.
- Payments, paid skills, reviews, comments, and social features.
- Direct filesystem installation from a normal browser page.

GitHub import is a useful post-MVP feature. Until then, creators with GitHub-hosted skills can clone the repository and publish the local skill directory through the CLI.

## Login decisions

Login is not required to:

- Search or browse public skills.
- Inspect public versions and scan findings.
- Download or install public skills through the CLI.

Login is required to:

- Publish or update a skill.
- Manage namespaces and publisher profiles.
- Use the browser skill builder to publish.
- Submit authenticated reports with higher limits.

GitHub OAuth is the planned initial identity provider. Repository access is not part of MVP authentication.

## Starter-skill decision

Launch with approximately 5-10 maintained skills such as code review, test writing, documentation, security review, Git/PR assistance, React review, and backend API review.

Starter skills are recommended in onboarding but are never silently installed. Users explicitly select them or install a starter collection.

## Trust model

Never describe a skill as completely safe merely because static checks passed. Do not use unsupported scores such as `Security 98/100`.

Present three separate kinds of information:

- **Declared:** publisher-provided compatibility, capabilities, and dependencies.
- **Observed:** files, scripts, patterns, and findings detected by versioned AgentCargo rules.
- **Enforced:** restrictions demonstrably enforced by the selected host under documented conditions.

Every finding should eventually contain a stable rule ID, rule version, severity, path, bounded evidence, explanation, remediation, and scan time.

## Package contract

AgentCargo wraps existing Agent Skills instead of replacing their authoring standard.

```text
my-skill/
├── SKILL.md           # Native Agent Skills metadata and instructions
├── agentcargo.yaml    # Registry/version/compatibility metadata
├── scripts/           # Optional
├── references/        # Optional
├── assets/            # Optional
└── agents/            # Optional host-native metadata
```

The native Agent Skills constraints currently enforced include:

- One root `SKILL.md`.
- YAML frontmatter with `name` and `description`.
- A 1-64 character lowercase name containing letters, numbers, and single hyphens.
- Skill name matching the parent directory.
- A non-empty description of at most 1024 characters.
- Optional compatibility text of at most 500 characters.
- String-to-string optional metadata.

The source standard is <https://agentskills.io/specification>. Codex-specific conventions must be rechecked against official OpenAI documentation before changing its adapter.

## Architecture decisions

- TypeScript monorepo managed with pnpm.
- Modular monolith for the hosted MVP, not microservices.
- Planned web application: Next.js.
- Planned REST API: Fastify with OpenAPI 3.1.
- PostgreSQL for registry data, initial search, audit history, and the durable job queue.
- S3-compatible object storage for immutable package artifacts.
- Shared core libraries between CLI, API, and worker.
- Host-specific behavior isolated behind versioned adapters.
- Static scanning only in MVP; community files are never executed by registry workers.
- Published artifacts are mirrored, immutable, content-addressed, and digest-verified.
- Artifact format v1 is the uncompressed canonical USTAR format `agentcargo-ustar-v1`, stored with the `.agentcargo` extension and hashed over its exact bytes.
- Host behavior lives behind `@agentcargo/adapter-contract`; the first adapter is `@agentcargo/adapter-codex` version `0.1.0`.
- Codex project skills install to `<project-root>/.agents/skills/<name>` and user skills to `<user-home>/.agents/skills/<name>`, verified against official OpenAI documentation on 2026-08-13.
- Project lockfiles live at `<project-root>/agentcargo.lock`; user lockfiles live in AgentCargo's platform-specific data directory beneath the user home.
- Local installations vendor host-ready files, omit registry-only `agentcargo.yaml`, and record the artifact plus every installed file in lockfile v1.
- Lifecycle inspection recomputes lockfile-owned receipts and classifies installations as clean, modified, missing, or invalid without following links.
- Removal requires explicit confirmation, refuses drift unless forced, always rejects invalid path types, and preserves untracked content while deleting only receipt-owned files.
- Scope mutations share `.agentcargo-operation.lock`; `agentcargo doctor` reports stale locks and abandoned staging paths without automatically deleting them.
- No transitive skill dependency resolver in MVP.

## Current repository structure

```text
packages/core/       Validation, artifacts, installation transactions, and lockfiles
packages/adapter-contract/ Versioned host adapter types
packages/adapter-codex/    Codex project/user installation behavior
packages/cli/        agentcargo command-line entry point
examples/            Valid example skill fixtures
docs/PRD.md          Product requirements and scope
docs/ARCHITECTURE.md Technical architecture and security boundaries
docs/ROADMAP.md      Milestone sequence
docs/THREAT_MODEL.md Local and planned hosted security boundaries
docs/STATUS.md       Current implementation status and next work
```

## Implemented commands

```text
agentcargo init [path]
agentcargo validate [path]
agentcargo pack [path]
agentcargo add <local-path> --agent codex --scope <project|user>
agentcargo list --agent codex --scope <project|user|all>
agentcargo remove <package> --agent codex --scope <project|user> --yes
agentcargo doctor --agent codex --scope <project|user|all>
```

These commands support the current local workflow and machine-readable `--json` output. Remote registry installation and the other commands documented in the PRD are proposals until listed as completed in `docs/STATUS.md`.

## Development commands

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm verify
pnpm dev:cli validate ./examples/hello-skill
pnpm dev:cli pack ./examples/hello-skill
pnpm dev:cli add ./examples/hello-skill --agent codex --scope project --project-root <test-project>
pnpm dev:cli list --agent codex --scope project --project-root <test-project>
pnpm dev:cli doctor --agent codex --scope project --project-root <test-project>
pnpm dev:cli remove hello-skill --agent codex --scope project --project-root <test-project> --yes
```

Node.js 22 or newer and pnpm 11 are required. pnpm dependency build scripts are deny-by-default; only explicitly reviewed packages may be enabled in `pnpm-workspace.yaml`.

## Implementation rules

- Preserve compatibility with the open Agent Skills format.
- Keep generic CLI/core code free of hard-coded host installation paths.
- Add host paths and transformations only in adapter packages.
- Treat packages, manifests, Markdown, archives, lockfiles, and scanner evidence as untrusted input.
- Never execute package scripts during validation, scanning, or publication.
- Reject archive traversal, absolute paths, links, special files, case collisions, and expansion-limit violations.
- Use deterministic artifacts and verify their digest before installation.
- Stage local installation on the destination filesystem and commit with atomic rename.
- Remove only files recorded as AgentCargo-owned; protect locally modified files.
- Keep machine-readable CLI output stable and give errors stable codes.
- Add or update tests with every behavior change.
- Do not mark work completed in `docs/STATUS.md` until verification passes.

## Source-of-truth documents

When documents disagree, use this priority and repair the inconsistency:

1. The user's latest explicit decision.
2. `docs/PRD.md` for product scope and acceptance criteria.
3. `docs/ARCHITECTURE.md` for technical boundaries.
4. `docs/ROADMAP.md` for sequencing.
5. `docs/STATUS.md` for current implementation state.
6. This file for concise durable context.

## Continuity checklist

At the beginning of future work:

1. Read this file completely.
2. Read `docs/STATUS.md`.
3. Read the relevant PRD or architecture sections for the requested work.
4. Inspect the current code and Git status; do not assume status text is perfectly current.
5. Run proportionate verification before changing a completed status.

At the end of material work:

1. Update `docs/STATUS.md` with completed work, verification, and the next concrete step.
2. Update this file only if product scope, naming, architecture, or durable conventions changed.
3. Update the PRD, architecture, or roadmap when their source-of-truth decisions changed.
