# AgentCargo Project Status

Last updated: 2026-08-13

This file tracks what is implemented, verified, currently active, and pending. Update it after every material development session. A feature is complete only when its implementation and proportionate verification both pass.

## Current phase

Milestone 1: local package core.

The working vertical slice is:

```text
Skill name and description
    -> agentcargo init
    -> SKILL.md + agentcargo.yaml
    -> agentcargo validate
    -> agentcargo pack
    -> canonical .agentcargo artifact + SHA-256 digest
    -> digest-verified safe extraction
    -> Codex project or user adapter
    -> atomic activation + agentcargo.lock ownership receipt
```

The local Milestone 1 vertical slice is complete through installation inspection, modification-safe removal, and diagnostics.

## Completed and verified

### Product and planning

- [x] Selected `AgentCargo` as the working product name.
- [x] Renamed the PRD, architecture, roadmap, README, commands, manifest, and lockfile references from SkillHub to AgentCargo.
- [x] Defined MVP users, scope, exclusions, journeys, functional requirements, risks, metrics, and launch criteria.
- [x] Defined the modular-monolith architecture, package model, CLI transaction boundaries, APIs, database model, worker responsibilities, and security model.
- [x] Defined the milestone roadmap from local CLI through public beta.
- [x] Decided that direct GitHub repository import is post-MVP.
- [x] Decided that anonymous users can browse and install public skills; creator actions require login.
- [x] Decided that starter skills are curated and opt-in rather than automatically installed.
- [x] Decided to present trust evidence instead of composite quality/security scores.

### Repository foundation

- [x] Initialized a local Git repository with `main` as the initial branch.
- [x] Created a TypeScript pnpm monorepo.
- [x] Added strict TypeScript configuration.
- [x] Added workspace build, type-check, test, and verification commands.
- [x] Added a pnpm dependency-build allowlist with only `esbuild` approved.
- [x] Added a cross-platform GitHub Actions CI matrix for Ubuntu, macOS, and Windows on Node.js 22 and 24.
- [x] Added `.gitignore` coverage for dependencies, builds, coverage, environments, logs, and local pnpm cache.
- [x] Added LF normalization for deterministic checked-in fixtures and binary handling for `.agentcargo` files.
- [x] Prepared the verified local package core as the repository's initial Git commit on `main`.

### Core validation

- [x] Added human-title-to-skill-name normalization.
- [x] Added YAML-safe `SKILL.md` template generation.
- [x] Added `agentcargo.yaml` template generation.
- [x] Validate that the target is an existing directory.
- [x] Validate the required root `SKILL.md`.
- [x] Parse YAML frontmatter.
- [x] Validate native skill name, description, compatibility, metadata, and allowed-tools fields.
- [x] Enforce skill name and parent-directory matching.
- [x] Warn when `SKILL.md` is empty or exceeds the 500-line recommendation.
- [x] Parse and validate `agentcargo.yaml` schema version 1.
- [x] Validate semantic versions, compatibility scopes, capability declarations, environment names, and tags.
- [x] Treat a missing `agentcargo.yaml` as a publishing warning rather than invalidating a native skill.
- [x] Inventory files deterministically.
- [x] Reject symlinks and special files.
- [x] Enforce initial per-file, file-count, and expanded-size limits.
- [x] Report the presence of scripts without executing them.
- [x] Return stable finding codes, severity, message, and optional path.

### Deterministic artifacts and integrity

- [x] Defined artifact format v1 as `agentcargo-ustar-v1` in ADR 0001.
- [x] Create uncompressed canonical USTAR artifacts with exact-byte SHA-256 digests.
- [x] Sort entries by unsigned UTF-8 path bytes and normalize archive modes, ownership, timestamps, headers, padding, and end markers.
- [x] Require a valid `agentcargo.yaml` before packing.
- [x] Reject output paths inside the source skill and refuse to overwrite artifacts.
- [x] Recheck source identity and metadata while packing to detect concurrent mutation.
- [x] Reject absolute paths, traversal, drive prefixes, UNC paths, unsafe portable names, links, special files, and case-insensitive collisions.
- [x] Enforce file-count, per-file, expanded-size, and artifact-size limits while streaming.
- [x] Verify an expected digest before destination mutation and again after extraction to close artifact replacement races.
- [x] Extract only canonical regular files beneath an explicit missing or empty staging root.
- [x] Use exclusive destination creation and clean up files created by failed extraction.
- [x] Added a checked-in cross-platform digest vector plus malicious archive and generated traversal-path tests.

### CLI

- [x] Implemented `agentcargo init [path]`.
- [x] Implemented `agentcargo validate [path]`.
- [x] Implemented `agentcargo pack [path]` with optional `--output`.
- [x] Implemented local-path `agentcargo add <path> --agent codex --scope <project|user>`.
- [x] Added an explicit `--project-root` option for isolated and non-current-directory project installation.
- [x] Added `--description` and optional `--name` initialization inputs.
- [x] Refuse to overwrite an existing `SKILL.md` or `agentcargo.yaml`.
- [x] Refuse to generate a declared name that does not match the target directory.
- [x] Added human-readable validation output.
- [x] Added machine-readable `--json` output.
- [x] Added structured artifact errors to human-readable and JSON CLI output.
- [x] Set a non-zero exit status for invalid skills and CLI errors.
- [x] Added stable CLI error codes for implemented error paths.
- [x] Implemented `agentcargo list` for project, user, or both scopes.
- [x] Implemented `agentcargo remove` with required `--yes` confirmation and separate `--force` drift acknowledgement.
- [x] Implemented read-only `agentcargo doctor` diagnostics for project, user, or both scopes.

### Host adapters and local installation

- [x] Added the versioned `@agentcargo/adapter-contract` package without vendor paths in generic core logic.
- [x] Reverified Codex skill structure and locations against official OpenAI documentation on 2026-08-13.
- [x] Added `@agentcargo/adapter-codex` version `0.1.0` with documentation provenance.
- [x] Resolve Codex project skills to `<project-root>/.agents/skills/<name>`.
- [x] Resolve Codex user skills to `<user-home>/.agents/skills/<name>`.
- [x] Require publisher-declared Codex compatibility for the selected scope.
- [x] Remove registry-only `agentcargo.yaml` from the host-ready staged skill.
- [x] Verify and extract artifacts before activating a destination.
- [x] Reject symlinked installation path components and unmanaged destination conflicts.
- [x] Stage on the destination filesystem and activate the complete directory with atomic rename.
- [x] Serialize installation using a scope operation lock.
- [x] Roll back the active destination if the lockfile commit fails.
- [x] Added schema-validated, size-limited, atomic `agentcargo.lock` v1 reads and writes.
- [x] Record artifact digest, adapter version, scope, portable destination, source kind, aggregate files digest, and every owned file's digest, byte count, and canonical mode.
- [x] Keep local source filesystem paths out of the lockfile.
- [x] Added separate platform-specific user lockfile locations beneath the user home.

### Local lifecycle safety

- [x] Recompute installed SHA-256, byte-count, and canonical-mode receipts without following links.
- [x] Classify installations as clean, modified, missing, or invalid.
- [x] Report missing, modified, untracked, and invalid paths separately.
- [x] Constrain every lockfile destination beneath the adapter's validated skill root.
- [x] Serialize install and removal with a shared metadata-bearing scope operation lock.
- [x] Refuse normal removal when any local drift is present.
- [x] Refuse linked, special, case-conflicting, or otherwise invalid content even under forced removal.
- [x] Stage removal with atomic rename and reinspect before committing the lockfile.
- [x] Roll back the destination if lockfile commit fails.
- [x] Unlink only lockfile-owned regular files and prune only empty owned directories.
- [x] Preserve untracked content at the original destination after forced removal.
- [x] Atomically replace non-empty lockfiles and unlink an empty lockfile.
- [x] Diagnose active/stale/invalid operation locks, abandoned install/removal stages, host-path failures, lockfile failures, and installation drift.
- [x] Keep `doctor` read-only; it never automatically deletes recovery evidence.

### Examples and documentation

- [x] Added `examples/hello-skill` with valid native and AgentCargo metadata.
- [x] Added local CLI instructions to the README.
- [x] Added the durable root `AGENTS.md` context file.
- [x] Added this implementation-status tracker.
- [x] Added the canonical artifact format architecture decision record.
- [x] Added `docs/THREAT_MODEL.md` for local boundaries, hosted requirements, residual risks, and recovery limits.

## Verification evidence

Last full verification on 2026-08-13:

```text
pnpm check   PASS
pnpm test    PASS: 7 test files, 58 tests
pnpm build   PASS
CLI init smoke test       PASS
CLI validate smoke test   PASS
CLI pack smoke test       PASS with deterministic duplicate artifacts
CLI pack error smoke test PASS with stable JSON error
CLI local add smoke test  PASS with Codex project install and lockfile
CLI repeated add test     PASS with stable INSTALL_ALREADY_RECORDED error
CLI list smoke test       PASS with clean receipt recomputation
CLI doctor smoke test     PASS with healthy host, lockfile, and installed tree
CLI remove smoke test     PASS with destination removal and empty-lockfile unlink
Example skill validation  PASS with no findings
Canonical example digest  PASS: sha256:7642e1b5daefdde9f75eb6ec45cd22571fda276cff29bc13b9c14f5ce3e5db84
Standard TAR inspection   PASS
Whitespace scan and git diff --check PASS
```

The install and lifecycle test matrix covers Codex project and user scopes, declared-scope enforcement, unmanaged destinations, symlink escapes, lockfile parsing and atomic replacement, per-file ownership, drift classification, clean and forced removal, preservation of untracked content, invalid-link refusal, multiple lock entries, stale operation locks, abandoned staging paths, CLI confirmation, and rollback after a forced installation lockfile-commit failure.

## In progress

No implementation task is currently in progress.

## Next recommended slice

### Finish public-project decisions, then select the second host

- [ ] Decide the initial open-source boundary and choose a license for the public CLI/core/adapters.
- [ ] Record the monorepo, naming, and open-source-boundary architecture decisions.
- [ ] Add contribution guidelines, code of conduct, security policy, and issue templates.
- [ ] Compare candidate second hosts by demand, format stability, current official documentation, and automated testability.
- [ ] Select the second host and document its verified skill contract before implementing its adapter.

Exit condition: the public collaboration boundary is explicit, the repository has baseline community/security documents, and the second host is selected from current evidence rather than assumption.

## Pending by milestone

### Milestone 1: Local package core

- [x] Deterministic packaging and SHA-256 digests.
- [x] Safe streaming archive extraction.
- [x] Host adapter contract package.
- [x] Codex adapter with project and user scopes.
- [x] Atomic staged installation.
- [x] `agentcargo.lock` schema and atomic writes.
- [x] Local-path `agentcargo add`.
- [x] `agentcargo list`.
- [x] `agentcargo remove` with local-modification protection.
- [x] `agentcargo doctor`.
- [x] Formal `docs/THREAT_MODEL.md`.
- [x] Architecture decision record for the artifact format.
- [ ] Architecture decision records for the monorepo, naming, and open-source boundary.

### Milestone 2: Second host

- [ ] Compare demand, format stability, and testability of candidate hosts.
- [ ] Select and document the second host.
- [ ] Implement the second adapter.
- [ ] Run the shared adapter contract suite against both hosts.
- [ ] Document third-party adapter development.

### Milestone 3: Registry read path

- [ ] PostgreSQL schema and migrations.
- [ ] S3-compatible artifact storage.
- [ ] Versioned read API and OpenAPI contract.
- [ ] Public website search and skill-detail pages.
- [ ] PostgreSQL full-text and trigram search.
- [ ] `agentcargo search`.
- [ ] `agentcargo inspect`.
- [ ] Remote registry installation with digest verification.

### Milestone 4: Publishing and static analysis

- [ ] GitHub OAuth for creator identity only.
- [ ] Publisher namespaces and ownership.
- [ ] Secure CLI authentication.
- [ ] Release reservation and immutable upload workflow.
- [ ] PostgreSQL-backed worker jobs.
- [ ] Static scanner rules with evidence and rule versions.
- [ ] Publisher pages and version history.
- [ ] Simple UI builder for instruction-only skills.
- [ ] CLI publication from local skill directories.

### Milestone 5: Lifecycle and moderation

- [ ] Update preview with file, script, capability, and finding changes.
- [ ] Atomic update and rollback.
- [ ] Local drift audit.
- [ ] Reports and append-only moderation audit events.
- [ ] Release deprecation and quarantine.
- [ ] Emergency digest denylist.
- [ ] Rate limiting and incident runbooks.
- [ ] Focused security review.

### Milestone 6: Public beta

- [ ] Curate 5-10 initial starter skills, growing toward 20 useful seed skills.
- [ ] Publish signed CLI release artifacts.
- [ ] Add operational dashboards and public status information.
- [ ] Publish privacy, content, platform-support, and retention documentation.
- [ ] Recruit external creators and users.
- [ ] Reach the PRD beta learning targets.

## Post-MVP backlog

- [ ] Direct GitHub repository import.
- [ ] GitHub App with selected-repository read access.
- [ ] Private-repository support.
- [ ] Repository-change notification and explicit new-release creation.
- [ ] Private team registries and policy allowlists.
- [ ] Organization namespaces and delegated roles.
- [ ] Skill packs and curated collections.
- [ ] Compatibility evaluation environments.
- [ ] Model/agent-specific benchmarks and Skill Arena.
- [ ] Semantic recommendations.
- [ ] Registry federation.

## Known limitations and unresolved decisions

- The working name `AgentCargo` still needs domain, npm, GitHub organization, trademark, and legal clearance before public branding is finalized.
- No open-source license has been selected or added yet.
- The hosted registry may remain private-source even if CLI, schemas, adapters, and validation rules become open source; this boundary needs a formal decision.
- Local creation, validation, deterministic packaging, hashing, safe extraction, and Codex installation exist. Remote installation, registry, authentication, and the website do not exist yet.
- Local installations can be listed, drift-inspected, safely removed, and diagnosed. Update, full audit, and rollback of successful historical versions are not implemented yet.
- The second supported host has not been chosen.
- Package size and file-count limits are initial engineering defaults and need product validation.
- The canonical digest and installation assertions are wired into the existing OS/Node CI matrix, but remote CI has not run because the repository has not been pushed.
- The repository directory is named `SkillHub` even though the product is AgentCargo.

## Status update template

Use this structure after future work:

```text
Date:
Completed:
- ...

Verification:
- command — PASS/FAIL

Decisions or changes:
- ...

Current blocker:
- None / explanation

Next concrete step:
- ...
```
