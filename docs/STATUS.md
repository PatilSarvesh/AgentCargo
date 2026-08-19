# AgentCargo Project Status

Last updated: 2026-08-19

This file tracks what is implemented, verified, currently active, and pending. Update it after every material development session. A feature is complete only when its implementation and proportionate verification both pass.

## Current phase

Milestone 4 publishing follow-ups plus the completed Milestone 5 safe-lifecycle slice.

The working vertical slice is:

```text
Skill name and description
    -> agentcargo init
    -> SKILL.md + agentcargo.yaml
    -> agentcargo validate
    -> agentcargo pack
    -> canonical .agentcargo artifact + SHA-256 digest
    -> digest-verified safe extraction
    -> Codex or Claude Code project/user adapter
    -> atomic activation + agentcargo.lock ownership receipt
```

The local Milestone 1 vertical slice is complete through installation inspection, modification-safe removal, and diagnostics. Milestone 2 has both selected host adapters and shared contract coverage. Milestone 3 is complete through the versioned anonymous read contract, PostgreSQL/object-storage boundaries, read-only API, CLI discovery and installation commands, local public catalog, ranked search, and a passing live integration harness. Milestone 4 now has the static scanner, durable namespace ownership, PostgreSQL-backed release/session/state/upload storage, bounded registry session scopes with publisher-write mutation enforcement, a permission-restricted GitHub device-flow CLI credential handoff with refresh support, a provider verifier and PKCE callback-flow boundary, generic bearer/cookie API boundaries, hosted GitHub start/callback/session routes, an initial hosted session exchange, the catalog's publish entry point, signed artifact upload/completion into scanning state, an authenticated local CLI publication path, and a leased PostgreSQL scan worker that verifies, safely extracts, scans, rejects, or activates releases; web publication, web session composition, production worker scheduling, and authenticated publisher management remain pending.

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
- [x] Selected Apache License 2.0 for the public repository and recorded the open-source boundary.
- [x] Recorded the TypeScript/pnpm monorepo and product/package naming decisions.
- [x] Compared current second-host candidates and selected Claude Code from first-party demand, contract, and testability evidence.

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
- [x] Added contribution guidelines, Contributor Covenant 2.1, security policy, pull-request template, and structured bug/feature issue forms.
- [x] Added Apache-2.0 SPDX metadata to the workspace and first-party package manifests.

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
- [x] Implemented `agentcargo scan [path]` with versioned, explainable static observations and bounded evidence.
- [x] Implemented `agentcargo pack [path]` with optional `--output`.
- [x] Implemented local-path `agentcargo add <path> --agent codex --scope <project|user>`.
- [x] Implemented registry-coordinate `agentcargo add <@namespace/name[@version]>` with latest-version resolution and digest-verified artifact installation.
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
- [x] Added `@agentcargo/adapter-claude-code` version `0.1.0` with documentation provenance.
- [x] Resolve Codex project skills to `<project-root>/.agents/skills/<name>`.
- [x] Resolve Codex user skills to `<user-home>/.agents/skills/<name>`.
- [x] Resolve Claude Code project skills to `<project-root>/.claude/skills/<name>`.
- [x] Resolve Claude Code user skills to `<user-home>/.claude/skills/<name>`.
- [x] Require publisher-declared Codex compatibility for the selected scope.
- [x] Require publisher-declared Claude Code compatibility for the selected scope.
- [x] Remove registry-only `agentcargo.yaml` from each host-ready staged skill.
- [x] Run a shared versioned adapter contract suite against Codex and Claude Code.
- [x] Register both host adapters in CLI host resolution without adding host paths to generic CLI or core logic.
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
- [x] Added architecture decision records for the monorepo, naming, open-source boundary/license, and second-host selection.
- [x] Added the dated Claude Code filesystem, compatibility, trust, detection, and verification contract.
- [x] Added the host adapter development guide covering package shape, provenance, contract implementation, shared tests, CLI registration, and review checks.
- [x] Added the versioned `@agentcargo/registry-contract` package for public read models, digest invariants, and immutable release lookup semantics.
- [x] Added `@agentcargo/registry-client` with validated anonymous search, package, and exact release lookups.
- [x] Added a typed registry-client GitHub session exchange with explicit registry scopes and stable rejected-credential handling.
- [x] Added the versioned GitHub bearer-credential contract and runtime validation.
- [x] Added the permission-restricted registry credential store plus `agentcargo auth status`, `agentcargo auth login`, `agentcargo auth refresh`, and `agentcargo auth logout`; tokens never enter lockfiles, command arguments, or command output.
- [x] Added GitHub OAuth PKCE authorization construction, device authorization polling, authorization-code exchange support, identity revalidation, and refresh-token rotation handling.
- [x] Added `GitHubPublisherTokenVerifier` and `GitHubHostedOAuthFlow` for provider identity verification and one-time redirect-bound PKCE callback completion.
- [x] Added registry artifact download handling with HTTPS enforcement and stable transport errors.
- [x] Added the public registry catalog UI with search, host/scope filters, package detail, trust evidence, and install-command copying.
- [x] Wired the catalog's `Publish a skill` action to the local-only `/publish` instruction builder; generated files remain in the browser until the creator explicitly hands them to the CLI.
- [x] Added a Codex-sandbox-safe local catalog preview configuration that keeps the normal Vite port available without the secondary dev inspector binding.
- [x] Recorded the registry read-path package boundaries and exact release lookup contract in ADR 0006.
- [x] Added the checked-in OpenAPI 3.1 `v1` document and runtime validators for release, search, and error responses.
- [x] Added `@agentcargo/registry-db` with an in-memory test repository and parameterized PostgreSQL-oriented release/package/search queries.
- [x] Added the PostgreSQL read-path migration with digest-addressed artifact keys, public projections, indexes, and immutable identity triggers.
- [x] Added `@agentcargo/registry-storage` with digest verification, immutable object writes, and S3-compatible signed-download delegation.
- [x] Added an opt-in live PostgreSQL/object-store integration-test harness and documented its environment adapter contract.
- [x] Added a checked-in PostgreSQL/MinIO CI adapter and provisioned workflow for the live integration harness; provider SDKs remain scoped to the integration package.
- [x] Made the live adapter preserve the HTTPS public download contract while supporting local HTTP MinIO endpoints in the test downloader.
- [x] Added `@agentcargo/registry-api` with Fastify `v1` search, package, and exact release routes plus stable error handling.
- [x] Added the authenticated publisher identity and release-reservation contract, OpenAPI schema, and runtime validation with bounded idempotency fields.
- [x] Added the short-lived AgentCargo session contract, runtime validation, and OpenAPI schema for provider-to-registry authentication handoff.
- [x] Added a gated `POST /v1/packages/:namespace/:name/releases` API boundary plus in-memory reservation semantics for tests; the default app remains `501` until an authentication/namespace resolver and reservation repository are composed.
- [x] Added `POST /v1/auth/github/session` with provider exchange, opaque hash-only session adapters, bounded expiry/revocation, `no-store` responses, and composition with the generic bearer publisher resolver.
- [x] Added bounded `publisher:read`/`publisher:write` session claims, durable PostgreSQL storage, scoped cookie resolution, and publisher-write enforcement at mutation routes.
- [x] Added hosted GitHub start/callback API routes with configured-redirect validation, one-time PKCE completion, Secure/HttpOnly session cookies, cookie publisher resolution, and token-redacted errors.
- [x] Added signed artifact upload URL issuance and completion into durable `scanning` state with digest/byte/media-type verification and idempotent replay handling.
- [x] Added PostgreSQL-backed hash-only session storage with expiry/revocation, migration `0003_registry_auth_sessions.sql`, and integration migration coverage.
- [x] Added PostgreSQL-backed one-time OAuth callback state storage with migration `0004_registry_oauth_state.sql` and integration migration coverage.
- [x] Added PostgreSQL-backed release upload intent/completion storage with migration `0005_registry_release_uploads.sql` and integration migration coverage.
- [x] Added PostgreSQL-backed scan jobs with migration `0006_registry_scan_jobs.sql`, short leases, `FOR UPDATE SKIP LOCKED` claims, attempt tracking, retry timestamps, and scan/rejection evidence.
- [x] Added `@agentcargo/registry-worker` to verify canonical artifacts, reuse core validation/scanning, compare completion metadata, and activate only validated releases through the database boundary.
- [x] Added authenticated `agentcargo publish` for local skills, including validation/scanning, deterministic artifact packing, reservation idempotency, signed upload, metadata checks, completion, and token-redacted output.
- [x] Added the local-only `/publish` instruction-skill builder with compatibility controls, generated `SKILL.md`/`agentcargo.yaml` previews, copyable CLI handoff, and an explicit no-upload boundary.
- [x] Added local package version history with release status, published date, scan findings, immutable digest selection, and version-specific install commands.
- [x] Added the local-only `/publisher` workspace with anonymous-safe sign-in gating, optional identity-header display, read-only namespace/package summaries, and an explicit no-mutation boundary.
- [x] Added an explicit read-only registry-access status to `/publisher`; workspace identity is labeled as display-only, the planned `publisher:read` scope is visible, and browser publication remains unavailable until a registry session is issued.
- [x] Added the fail-closed server-side `/api/registry-session` boundary; it reports sanitized identity-only status, rejects browser credentials, and returns no registry token until a request-scoped provider resolver is available.
- [x] Added the server-only web session bridge contract; it injects a host-owned provider resolver, requests `publisher:read` only, validates the short-lived session, and serializes an opaque HttpOnly cookie without exposing the token in JSON.
- [x] Added explicit web session-cookie revocation through `DELETE /api/registry-session`, with no provider credential required.
- [x] Added server-only opaque session-cookie parsing and optional read-session inspection; malformed, duplicate, expired, unavailable, and over-scoped cookies fail closed and only sanitized metadata crosses the web boundary.
- [x] Added bounded descriptive dependency declarations to `agentcargo.yaml` and registry metadata without adding a dependency resolver.
- [x] Added a deterministic update-preview engine covering version/digest, host-ready file receipts, scripts, capabilities, dependencies, manifest metadata, and added/resolved/changed scanner findings.
- [x] Added registry-scoped lockfile identities and `agentcargo update [@namespace/name[@version]] --dry-run`; target artifacts are downloaded, size/digest verified, safely extracted, adapter-prepared, and compared without changing installed files or the lockfile.
- [x] Added confirmed atomic `agentcargo update` and `agentcargo rollback` with clean-receipt enforcement, shared scope locking, destination-filesystem staging, digest verification, atomic directory swaps, lockfile restoration after failures, and a validated one-version rollback sidecar whose swaps remain reversible.
- [x] Integrated retained rollback state with removal and doctor: successful removal deletes both active and retained receipt-owned trees, valid backups are recognized, and missing/drifted/orphaned update or rollback paths are diagnosed without automatic repair.
- [x] Added read-only `agentcargo audit` for project/user/all scopes with artifact identity reporting, independently recomputed host-ready receipt integrity, detailed missing/modified/untracked/invalid path findings, rollback/operation recovery diagnostics, installed-tree static scanning, stable JSON, and actionable remediation.
- [x] Hardened static scanning to open stable regular-file identities without following links and added a host-ready scan entry point that does not require registry-only `agentcargo.yaml`.
- [x] Added publishing migration `0002_registry_publishing.sql` with publisher identities, namespace ownership, composite ownership enforcement, and pre-upload reservation uniqueness.
- [x] Added PostgreSQL namespace-claim and release-reservation repositories with replay/conflict handling and live integration coverage.
- [x] Added PostgreSQL full-text and trigram search projection/indexing with ranked, parameterized repository queries and CI fixture coverage.
- [x] Added Claude Code adapter metadata, unit tests, and CLI lifecycle coverage for add, list, doctor, and remove.
- [x] Added CLI and core coverage for registry installation metadata, coordinate checks, digest mismatches, and lockfile source receipts.
- [x] Added static scanner rules for scripts, network/download references, environment and likely secret references, destructive commands, prompt overrides, path escapes, encoded payloads, binaries, and nested archives.
- [x] Added `docs/THREAT_MODEL.md` for local boundaries, hosted requirements, residual risks, and recovery limits.

## Verification evidence

Last full verification on 2026-08-19:

```text
CI=true pnpm verify  PASS: all workspace TypeScript checks/builds, 23 test files and 193 tests passed, 1 opt-in live integration test skipped
CI=true pnpm --filter @agentcargo/cli test  PASS: 19 tests, including explicit device-login success and CI-interactive denial fixtures
pnpm --filter @agentcargo/registry-client test  PASS: 20 tests; POSIX permission assertions are scoped away from Windows, where Node does not expose Unix mode enforcement
pnpm verify  PASS before the worker slice: type-check, build, 18 test files, 155 passing tests, 1 opt-in integration test skipped
Direct publication-slice verification PASS: TypeScript checks for changed packages; 19 test files, 162 passing tests, 1 opt-in integration test skipped
pnpm verify rerun        BLOCKED by unavailable registry DNS while pnpm recreated dependencies; no code/test failure was observed
CLI init smoke test       PASS
CLI validate smoke test   PASS
CLI pack smoke test       PASS with deterministic duplicate artifacts
CLI pack error smoke test PASS with stable JSON error
CLI local add smoke test  PASS with Codex project install and lockfile
CLI repeated add test     PASS with stable INSTALL_ALREADY_RECORDED error
CLI list smoke test       PASS with clean receipt recomputation
CLI doctor smoke test     PASS with healthy host, lockfile, and installed tree
CLI remove smoke test     PASS with destination removal and empty-lockfile unlink
Registry client tests      PASS with URL-prefix, response-validation, network, HTTP-error, and artifact-download coverage
Registry storage tests     PASS with digest-addressed immutable writes, signed upload/download URLs, metadata verification, and bounded sizes
Registry worker tests      PASS with canonical artifact activation and tampered-artifact rejection
Credential store tests     PASS with canonical registry keys, atomic writes, permissions, expiry, malformed-store, and symlink coverage
GitHub OAuth client tests  PASS with PKCE/state, one-time callback flow, provider verification, code exchange, device polling, refresh rotation, identity revalidation, and token-redaction coverage
CLI registry tests         PASS for search, inspect, public release resolution, digest-verified install, and missing URL errors
Core registry install test PASS for expected-digest mismatch protection
Static scanner tests      PASS with stable rule IDs/versions, bounded evidence, metadata filtering, and no execution
CLI scan test             PASS with machine-readable scanner output
CLI auth tests             PASS with status/logout and token-redaction coverage
CLI OAuth tests            PASS with device login, refresh, token-redaction, and CI-interactive guard coverage
CLI publish tests          PASS with local validation, deterministic packing, authenticated reservation/upload/completion, metadata checks, and token redaction
Publisher contract tests  PASS with GitHub identity, session response, semver reservation, bounded idempotency, and OpenAPI references
Registry reservation tests PASS with first-write, replay, coordinate conflict, namespace ownership, and invalid-context coverage
Registry API publishing tests PASS with gated configuration, authentication, validation, stable conflict errors, signed upload URLs, and scanning completion
Registry API auth tests    PASS with bearer/cookie extraction, verifier delegation, malformed-header rejection, hosted start/callback redirects, cookie flags, outage redaction, opaque session expiry/revocation, provider exchange, and no-store session responses
Registry DB search/session tests PASS with full-text/trigram predicates, ranking, parameterization, hash-only session persistence, revocation, one-time OAuth state, upload completion, leased scan jobs, activation projection, and migration coverage
Example skill validation  PASS with no findings
Canonical example digest  PASS: sha256:90307a7319126612c81b5c371252a3d671a0895f9073df6b3e6a0a080f160729
Standard TAR inspection   PASS
Package-manifest JSON parse PASS
GitHub issue-form YAML parse PASS
Local Markdown link check PASS: 21 files, 46 local links
Workflow YAML parse PASS: CI and registry-integration workflows
Registry integration adapter check PASS: build and skip-without-environment behavior
Registry session-scope source checks PASS: contract, PostgreSQL adapter, and API boundary type-check with local TypeScript
Registry session-scope package tests PASS: cached local Vitest ran registry-contract, registry-api, and registry-db coverage (5 files, 60 tests)
Registry client session-exchange tests PASS: 8 client tests including scoped exchange and rejected-credential handling
Root pnpm dependency restoration PASS on 2026-08-19 after approved network access; locked workspace dependencies are available again
Live PostgreSQL/MinIO integration PASS: namespace claim, durable reservation replay, release activation, immutable lookup, signed download, digest verification, and retry
Web catalog build PASS: Vinext production build
Web catalog test PASS: server-rendered catalog and hosted publish-link assertions
Web catalog lint PASS
Web catalog browser demo PASS: local preview loaded; search, Codex filter, package findings, install-command copy, and version-history selection verified
Web builder browser demo PASS: `/publish` rendered locally; form generation, compatibility declarations, generated files, CLI command copy, and no-upload messaging verified
Web publisher browser demo PASS: `/publisher` rendered locally; anonymous sign-in gate, read-only package summary, identity boundary copy, and no-mutation messaging verified
Web publisher session-boundary checks PASS: production build, server-rendered anonymous/identity states, planned read-only scope, no-token copy, and lint
Web registry session route checks PASS: anonymous/identity-only status, sanitized cookie-state fields, no-store responses, rejected browser credentials, unconfigured-provider failure, and cookie revocation
Web registry session bridge tests PASS: 7 cases covering unset bridge, server-only provider resolution, read-scope enforcement, fail-closed invalid results, cookie serialization, bounded cookie parsing, and server-side session inspection
Core update-preview tests PASS: 7 focused cases plus the full 60-test core suite
CLI update dry-run tests PASS: verified registry metadata/artifact comparison with unchanged installed files and lockfile; full 17-test CLI suite passes
Core atomic update/rollback tests PASS: clean swaps, shared operation locking, drift refusal, reversible rollback, repeated-update backup replacement, removal cleanup, doctor inspection, and injected metadata-commit recovery
CLI update/rollback tests PASS: confirmed registry update, lockfile/file replacement, rollback restoration, and confirmation boundaries; full 18-test CLI suite passes
Core audit tests PASS: 11 core files and 77 tests, including clean receipt verification, artifact-digest labeling, installed-tree scanning, drift/missing/untracked/invalid paths, no-follow behavior, recovery findings, and shared update/rollback lock refusal
CLI audit tests PASS: clean and drifted JSON reports, actionable remediation, and failure exit status; full 19-test CLI suite passes
Registry dependency contract tests PASS: bounded unique descriptive requirements in runtime validation and OpenAPI
Whitespace scan and git diff --check PASS
```

The install and lifecycle test matrix covers Codex project and user scopes, declared-scope enforcement, unmanaged destinations, symlink escapes, lockfile parsing and atomic replacement, per-file ownership, drift classification, clean and forced removal, preservation of untracked content, invalid-link refusal, multiple lock entries, stale operation locks, abandoned staging paths, CLI confirmation, and rollback after a forced installation lockfile-commit failure.

## In progress

The hosted session-exchange boundary now has both an in-memory demo adapter and PostgreSQL hash-only session/state adapters with expiry, revocation, one-time PKCE callback completion, and bounded registry scope claims. The API exposes hosted start/callback/session routes, scoped cookie resolution, publisher-write enforcement for release mutations, signed artifact upload URL issuance, and idempotent completion into `scanning` state. The shared registry client can now request an explicitly scoped short-lived GitHub session with stable auth errors. The CLI has GitHub device login, identity revalidation, refresh-token rotation, permission-restricted persistence, authenticated local publication, verified update previews, atomic update, reversible rollback, and local integrity/static audit. The user-directed lifecycle slice is complete and fully verified. Host composition of a request-scoped provider resolver, authenticated web publication, production worker scheduling, and authenticated publisher management are the next pending product work.

## Recently completed slice

### Complete safe local lifecycle operations

- [x] Update-preview engine with file, script, capability, dependency, manifest, and finding changes.
- [x] `agentcargo update --dry-run` with registry artifact verification and no local mutation.
- [x] Atomic `agentcargo update` with modification protection, operation locking, retained recovery state, and lockfile rollback on failure.
- [x] `agentcargo rollback` with backup receipt validation and atomic restoration.
- [x] `agentcargo audit` with integrity, drift, scanner, and remediation reporting.

## Next recommended slice

### Continue publishing and publisher experience

- [x] GitHub OAuth device login for creator identity only, with identity revalidation.
- [x] Publisher namespaces and ownership.
- [x] Permission-restricted CLI credential handoff with login, refresh, status/logout, and token redaction.
- [x] GitHub OAuth login and refresh-capable CLI credential handoff.
- [x] Generic API bearer extraction, injected verification, and stable auth-outage handling.
- [x] Initial hosted GitHub session exchange with opaque hash-only sessions and `no-store` responses.
- [x] PostgreSQL-backed durable session storage with expiry and revocation.
- [x] GitHub provider verifier and PKCE hosted callback-flow boundary with one-time redirect-bound state.
- [x] PostgreSQL-backed durable OAuth callback state storage.
- [x] Hosted GitHub start/callback API routes with Secure/HttpOnly session-cookie handoff.
- [x] Registry-scoped session claims, durable storage, and publisher-write enforcement in the API boundary.
- [ ] Web-app session composition, scope selection, and short-lived registry-scoped CLI sessions (server-only bridge, cookie handoff, revocation, and optional cookie inspection are tested; a real host provider/session resolver and exchange configuration are still not wired).
- [x] Define and test the authenticated release-reservation boundary with publisher-scoped idempotency.
- [x] Durable namespace ownership and PostgreSQL-backed release reservation.
- [x] Immutable artifact upload and completion workflow through durable `scanning` state.
- [x] PostgreSQL-backed worker jobs, leased claims, retry handling, and validated activation boundary.
- [x] Initial static scanner rules with stable evidence and rule versions.
- [ ] Authenticated publisher pages and version-history management.
- [x] Simple UI builder for instruction-only skills with local file previews and CLI handoff.
- [x] CLI publication from local skill directories.
- [ ] Record an optional authenticated Claude Code or Agent SDK discovery smoke test without making credentials a normal CI requirement.

Exit condition: an authenticated creator can publish a validated immutable release whose versioned scan evidence is visible through the registry read path.

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
- [x] Architecture decision records for the monorepo, naming, and open-source boundary.

### Milestone 2: Second host

- [x] Compare demand, format stability, and testability of candidate hosts.
- [x] Select Claude Code as the second host.
- [x] Document the verified Claude Code host contract and provenance.
- [x] Implement the second adapter.
- [x] Run the shared adapter contract suite against both hosts.
- [x] Document third-party adapter development.

### Milestone 3: Registry read path

- [x] Define the versioned registry read models and immutable release lookup contract.
- [x] Add the OpenAPI 3.1 contract and runtime validation for the initial anonymous read operations.
- [x] Implement the PostgreSQL-oriented release repository boundary and read-only Fastify routes.
- [x] PostgreSQL schema and migrations.
- [x] S3-compatible artifact storage boundary.
- [x] Add opt-in live PostgreSQL/object-store integration harness.
- [x] Versioned read API and OpenAPI contract.
- [x] Public website search and skill-detail pages (local Sites/Vinext implementation; deployment remains separate).
- [x] PostgreSQL full-text and trigram search.
- [x] `agentcargo search` through the versioned anonymous API.
- [x] `agentcargo inspect` for package summaries and exact releases.
- [x] Remote registry installation with digest verification.
- [x] Run the live PostgreSQL/object-store integration test in a provisioned local environment.

### Milestone 4: Publishing and static analysis

- [x] GitHub OAuth device login for creator identity only, with identity revalidation.
- [x] Publisher namespaces and ownership.
- [x] Permission-restricted CLI credential handoff with login, refresh, status/logout, and token redaction.
- [x] GitHub OAuth login and refresh-capable CLI credential handoff.
- [x] Generic API bearer extraction, injected verification, and stable auth-outage handling.
- [x] Initial hosted GitHub session exchange with opaque hash-only sessions and `no-store` responses.
- [x] PostgreSQL-backed durable session storage with expiry and revocation.
- [x] GitHub provider verifier and PKCE hosted callback-flow boundary with one-time redirect-bound state.
- [x] PostgreSQL-backed durable OAuth callback state storage.
- [x] Hosted GitHub start/callback API routes with Secure/HttpOnly session-cookie handoff.
- [x] Registry-scoped session claims, durable storage, and publisher-write enforcement in the API boundary.
- [ ] Web-app session composition, scope selection, and short-lived registry-scoped CLI sessions.
- [x] Authenticated release-reservation contract and gated API boundary.
- [x] Durable namespace ownership and PostgreSQL-backed release reservation.
- [x] Immutable artifact upload and completion workflow through durable `scanning` state.
- [x] PostgreSQL-backed worker jobs, leased claims, retry handling, and validated activation boundary.
- [x] Static scanner rules with evidence and rule versions.
- [ ] Authenticated publisher pages and version-history management.
- [x] Simple UI builder for instruction-only skills with local file previews and CLI handoff.
- [x] CLI publication from local skill directories.

### Milestone 5: Lifecycle and moderation

- [x] Update preview with file, script, capability, dependency, manifest, and finding changes.
- [x] Atomic update and rollback.
- [x] Local drift audit.
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
- The public repository uses Apache License 2.0. A separately deployed hosted implementation may remain separately licensed, but public package, adapter, finding, and API contracts remain open and versioned.
- Local creation, validation, deterministic packaging, hashing, safe extraction, Codex/Claude Code installation, authenticated local registry publication, the local browser skill builder, public package version history, and the read-only publisher workspace shell exist. The shared client can request a scoped session, and the web app has a tested server-only bridge contract, cookie handoff, revocation, fail-closed status route, and optional server-side cookie inspection. API-side registry session scopes, durable storage, and mutation enforcement are verified. Host-specific provider resolution, live web session exchange, authenticated browser publication, and publisher management do not exist yet.
- Local installations can be listed, audited, safely removed, diagnosed, compared with verified registry targets, atomically updated, and rolled back to the retained prior version. Audit reverifies host-ready receipts but labels source-artifact digests as recorded because source artifact bytes are intentionally not retained locally.
- Claude Code has a local adapter and shared contract coverage. An authenticated live-host discovery smoke test remains optional and has not run in the current unauthenticated environment.
- Package size and file-count limits are initial engineering defaults and need product validation.
- The canonical digest and installation assertions are wired into the existing OS/Node CI matrix. Remote CI exposed an inherited-`CI` assumption in the device-login success fixture and Unix-mode assertions on Windows; the fixtures now explicitly model non-CI login, retain separate CI-denial coverage, and limit POSIX permission assertions to POSIX hosts. The live registry harness passes locally.

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
