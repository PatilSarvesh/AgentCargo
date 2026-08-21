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
- Local checkout directory names have no product meaning. The active repository directory is `AgentCargo`; historical `SkillHub` paths may still exist elsewhere.
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
- Codex support first, followed by Claude Code as the selected second host.
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
- Publish a browser-builder draft through an authenticated registry workflow.
- Submit authenticated reports with higher limits.

GitHub OAuth is the planned initial identity provider. Repository access is not part of MVP authentication.

## Starter-skill decision

Launch with approximately 5-10 maintained skills such as code review, test writing, documentation, security review, Git/PR assistance, React review, and backend API review.

Starter skills are recommended in onboarding but are never silently installed. Users explicitly select them or install a starter collection.

The maintained public-beta seed set currently contains ten instruction-only fixtures under `examples/starter-skills/`, with catalog metadata in `catalog.json`. Every seed fixture must validate and static-scan cleanly for both Codex and Claude Code before it is presented as curated; local catalog recommendations remain opt-in until immutable registry releases exist.

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

The source standard is <https://agentskills.io/specification>. Host-specific conventions must be rechecked against current first-party documentation before changing an adapter.

## Architecture decisions

- TypeScript monorepo managed with pnpm.
- Public repository contents use Apache License 2.0; trust-critical contracts, CLI/core, adapters, validation/scanner rules, and public API contracts remain open.
- Modular monolith for the hosted MVP, not microservices.
- Planned web application: Next.js.
- Planned REST API: Fastify with OpenAPI 3.1.
- PostgreSQL for registry data, initial search, audit history, and the durable job queue.
- S3-compatible object storage for immutable package artifacts.
- Shared core libraries between CLI, API, and worker.
- PostgreSQL scan jobs use short leases, `FOR UPDATE SKIP LOCKED` claims, attempt tracking, retry timestamps, and immutable release activation only after shared validation and static scanning.
- Host-specific behavior isolated behind versioned adapters.
- Static scanning only in MVP; community files are never executed by registry workers.
- Published artifacts are mirrored, immutable, content-addressed, and digest-verified.
- Artifact format v1 is the uncompressed canonical USTAR format `agentcargo-ustar-v1`, stored with the `.agentcargo` extension and hashed over its exact bytes.
- CLI beta releases use the separate deterministic `agentcargo-cli-ustar-v1` bundle produced by `scripts/release-cli.mjs`; its canonical manifest inventories the built CLI/runtime package set and is signed with an operator-supplied Ed25519 key. Private keys remain outside the repository, and package-registry publication/key custody remain deployment work.
- Host behavior lives behind `@agentcargo/adapter-contract`; the first adapter is `@agentcargo/adapter-codex` version `0.1.0`.
- Codex project skills install to `<project-root>/.agents/skills/<name>` and user skills to `<user-home>/.agents/skills/<name>`, verified against official OpenAI documentation on 2026-08-13.
- Claude Code is the selected second host. Its adapter ID is `claude-code` and package is `@agentcargo/adapter-claude-code` version `0.1.0`; project skills install to `<project-root>/.claude/skills/<name>` and user skills to `<user-home>/.claude/skills/<name>`, verified against official Anthropic documentation on 2026-08-13.
- Project lockfiles live at `<project-root>/agentcargo.lock`; user lockfiles live in AgentCargo's platform-specific data directory beneath the user home.
- Local installations vendor host-ready files, omit registry-only `agentcargo.yaml`, and record the artifact plus every installed file in lockfile v1.
- Lifecycle inspection recomputes lockfile-owned receipts and classifies installations as clean, modified, missing, or invalid without following links.
- Removal requires explicit confirmation, refuses drift unless forced, always rejects invalid path types, and preserves untracked content while deleting only receipt-owned files.
- Scope mutations share `.agentcargo-operation.lock`; `agentcargo doctor` reports stale locks and abandoned staging paths without automatically deleting them.
- No transitive skill dependency resolver in MVP.
- Manifest `dependencies` are bounded, descriptive runtime requirements only; AgentCargo displays their changes but does not resolve or install them.
- Registry installations record the scoped `@namespace/name` identity in lockfile v1 while adapters continue to receive the unscoped skill name for destination resolution.
- Update previews deterministically pack, digest-verify, extract, and adapter-prepare the target into temporary storage, then compare host-ready file receipts plus declared capabilities/dependencies and versioned scanner findings without mutating the installation or lockfile.
- Updates and rollbacks share the scope operation lock, require clean receipt-owned trees, stage on the destination filesystem, use atomic directory swaps, and restore the prior directory plus lockfile after commit failures.
- Successful updates retain one validated rollback receipt and backup per package in `.agentcargo-rollback.json`; rollback swaps the retained and active versions so the operation is itself reversible, and removal cleans both active and retained owned files.
- Local audit keeps artifact identity, installed receipt integrity, filesystem drift/path safety, recovery evidence, and versioned static scanner observations separate; it never claims to reverify source-artifact bytes that are not retained locally and never follows or executes installed content.
- Publishing API boundaries receive authenticated, namespace-authorized publisher context from injected middleware. The API exposes generic bearer/cookie resolver boundaries, provider-to-registry session exchange, token-free session introspection, an owner-scoped publisher workspace read, hosted GitHub start/callback routes, signed artifact-upload URL issuance, and upload completion into the scanning state; it does not validate GitHub OAuth tokens or own provider sessions. Release-version reservation and upload state are publisher-scoped, idempotent, and durably persisted; worker validation and public activation remain separate steps.
- CLI credentials use a canonical registry URL key and a permission-restricted atomic local store; tokens never enter lockfiles, command arguments, or command output. `GitHubOAuthClient` supports PKCE authorization requests, device-flow login, identity revalidation, and refresh-token rotation. `GitHubHostedOAuthFlow` composes PKCE code exchange with one-time redirect-bound state, and `GitHubPublisherTokenVerifier` adapts `/user` identity checks to the API boundary. In-memory and PostgreSQL session/state adapters retain only bounded opaque session digests and transient callback material. Registry sessions carry bounded `publisher:read`/`publisher:write` claims, and scoped mutation resolvers reject sessions without publisher-write access. The local web app exposes a fail-closed `/api/registry-session` boundary and uses a server-only, environment-configured host broker to resolve provider credentials, request exactly `publisher:read`, store only an opaque HttpOnly registry cookie, and inspect it through token-free registry metadata. Missing or unsafe configuration remains fail-closed; browser credentials and tokens never cross the JSON boundary. OS keychain integration and hosted publisher deployment remain pending.
- Authenticated CLI publication uses the stored GitHub credential only for a just-in-time session exchange. `agentcargo publish` requests exactly `publisher:write`, keeps the short-lived AgentCargo session in memory, rejects expired or differently scoped sessions, and sends only that registry session to release mutation endpoints.
- Authenticated local `agentcargo publish` composes validated deterministic packing, publisher-scoped reservation, signed artifact upload, completion, and token-redacted status output. The authenticated publisher UI performs only the server-derived, intent-only reservation handoff; browser package-file upload and activation remain pending.
- Reports use bounded authenticated submissions with publisher-scoped idempotency; migration `0008_registry_moderation.sql` persists reports and append-only moderation audit events. `POST /v1/reports` is reporter-authenticated, `GET /v1/admin/audit-events` is maintainer-authenticated, and audit metadata never contains report evidence or credentials.
- Release moderation uses migration `0009_release_moderation.sql`: publisher-write deprecation requires namespace ownership, maintainer quarantine/restoration requires an injected maintainer role, quarantine remembers the prior public status, and every transition is idempotent and append-only audited. Anonymous package/search/exact-release reads filter quarantined rows while maintainer audit history remains addressable.
- Emergency digest denylisting uses migration `0010_digest_denylist.sql`: only maintainer-scoped add/remove mutations are accepted, each change is idempotent and append-only audited, and active `sha256:` entries are checked before public release reads, worker activation, and artifact resolution. Denylist state is content-addressed, bounded, and fail-closed at each trust boundary; removal restores eligibility without rewriting historical events.
- Worker activation requires an injected digest-denylist reader; `RegistryReleaseWorker` and `PostgresRegistryReleaseScanRepository` refuse construction without it and treat reader outages as retryable failures before download/activation. The focused review and residual risks are recorded in `docs/SECURITY_REVIEW_2026-08-20.md`.
- Continuous scanning uses `RegistryReleaseWorkerScheduler`: bounded intervals, immediate first cycle, no overlapping claims, queue-only lag/counter health, consecutive-failure readiness, and graceful lease-aware `stop()` are enforced in the worker package. The scheduler never exposes package bytes or credentials; PostgreSQL `available_at`/lease recovery remains authoritative for retries and stale claims.
- Public operational status uses the versioned `GET /v1/status` contract and `/status` web page. API/database, artifact-storage, worker, and moderation signals are injected as bounded callbacks; `registryWorkerStatusSource` adapts scheduler readiness and queue counters without package contents, credentials, or raw errors. Required-boundary outages report `overall: "outage"`; optional control failures report `degraded`.
- Registry API abuse controls use an injectable `RegistryRateLimiter`: auth, search, reporting, publishing, and moderation routes have bounded route-aware fixed-window policies, stable `429`/`Retry-After` responses, and generic fail-closed `503` behavior when the limiter is unavailable. The default in-memory limiter is hard-bounded for local/single-process use; multi-instance deployments must provide shared state. Operator response procedures live in `docs/INCIDENT_RUNBOOK.md`.
- Local web dev/preview uses `AGENTCARGO_WEB_PORT` through `apps/web/scripts/run-vinext.mjs`; explicit `--port` flags take precedence, so AgentCargo can move off localhost:3000 without changing another project's port or shared configuration.
- The anonymous web catalog includes a local-only instruction-skill builder that generates reviewable `SKILL.md` and `agentcargo.yaml` drafts plus a CLI handoff; browser pages never upload package files or install them directly.
- The authenticated `/publisher` workspace reads owner-scoped namespaces, packages, and immutable release histories through an exact `publisher:read` AgentCargo session. Its publication intent form accepts only name/version/idempotency input, derives the namespace server-side, exchanges a one-shot `publisher:write` session in memory, and reserves a release without accepting browser package files or returning credentials; artifact upload, scanning, and activation remain CLI/registry-bound.

## Current repository structure

```text
apps/web/            Sites/Vinext public registry catalog UI
packages/core/       Validation, static scanning, artifacts, installation transactions, and lockfiles
packages/adapter-contract/ Versioned host adapter types
packages/adapter-codex/    Codex project/user installation behavior
packages/adapter-claude-code/ Claude Code project/user installation behavior
packages/registry-contract/ Versioned public registry read models and invariants
packages/registry-client/   Typed registry HTTP client, credential store, and GitHub OAuth adapter
packages/registry-db/       PostgreSQL-oriented release, namespace, and session repository boundaries
packages/registry-storage/  Digest-addressed S3-compatible artifact storage boundary
packages/registry-integration/ Opt-in live PostgreSQL/object-store test harness and CI adapter
packages/registry-api/      Fastify registry read and publishing routes
packages/registry-worker/   Durable scan-job worker, safe artifact verification, static scanning, and activation boundary
packages/cli/        agentcargo command-line entry point
examples/            Valid example skill fixtures
docs/adr/            Accepted architecture decisions
docs/hosts/          Verified host contracts and provenance
docs/ADAPTERS.md     Third-party adapter development guide
docs/PRD.md          Product requirements and scope
docs/ARCHITECTURE.md Technical architecture and security boundaries
docs/ROADMAP.md      Milestone sequence
docs/THREAT_MODEL.md Local and planned hosted security boundaries
docs/STATUS.md       Current implementation status and next work
docs/BETA_READINESS.json Machine-readable public-beta launch gates
docs/BETA_LAUNCH.md Controlled public-beta deployment handoff
docs/BETA_FEEDBACK.md Creator/user feedback and measurement template
docs/BETA_METRICS.json PRD beta metric definitions and record template
CONTRIBUTING.md      Contribution workflow and change requirements
SECURITY.md          Private vulnerability-reporting policy
LICENSE              Apache License 2.0 terms
```

## Implemented commands

```text
agentcargo init [path]
agentcargo validate [path]
agentcargo scan [path]
agentcargo pack [path]
agentcargo publish [path] --namespace <namespace> [--registry <url>]
agentcargo add <local-path>|<@namespace/name[@version]> --agent <codex|claude-code> --scope <project|user>
agentcargo list --agent <codex|claude-code> --scope <project|user|all>
agentcargo remove <package> --agent <codex|claude-code> --scope <project|user> --yes
agentcargo doctor --agent <codex|claude-code> --scope <project|user|all>
agentcargo search <query> [--registry <url>]
agentcargo status [--registry <url>]
agentcargo inspect <@namespace/name[@version]> [--registry <url>]
agentcargo update [@namespace/name[@version]] --agent <codex|claude-code> --scope <project|user> [--dry-run|--yes] [--registry <url>]
agentcargo rollback <package> --agent <codex|claude-code> --scope <project|user> --yes
agentcargo audit --agent <codex|claude-code> --scope <project|user|all>
agentcargo auth status [--registry <url>]
agentcargo auth login [--registry <url>] [--client-id <id>]
agentcargo auth refresh [--registry <url>] [--client-id <id>]
agentcargo auth logout [--registry <url>]
```

These commands support the current local workflow, versioned static observations, anonymous registry reads, digest-verified public registry installation, GitHub device-flow auth login/refresh, and authenticated local publication with machine-readable `--json` output. Set `AGENTCARGO_REGISTRY_URL` instead of passing `--registry`; browser package-file publication/activation and the other commands documented in the PRD remain proposals until listed as completed in `docs/STATUS.md`.

## Development commands

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm verify
pnpm check:beta
pnpm test:beta
pnpm dev:cli validate ./examples/hello-skill
pnpm dev:cli scan ./examples/hello-skill
pnpm dev:cli pack ./examples/hello-skill
pnpm dev:cli add ./examples/hello-skill --agent codex --scope project --project-root <test-project>
pnpm dev:cli list --agent codex --scope project --project-root <test-project>
pnpm dev:cli doctor --agent codex --scope project --project-root <test-project>
pnpm dev:cli remove hello-skill --agent codex --scope project --project-root <test-project> --yes
# The same local lifecycle is supported with --agent claude-code.
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
