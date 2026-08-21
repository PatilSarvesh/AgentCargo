# AgentCargo Project Status

Last updated: 2026-08-21

This file tracks what is implemented, verified, currently active, and pending. Update it after every material development session. A feature is complete only when its implementation and proportionate verification both pass.

## Current phase

Milestone 4 publishing follow-ups plus the completed Milestone 5 moderation/lifecycle slice; implementation of the public-beta readiness slice is complete and deployment/recruitment follow-ups remain.

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

The local Milestone 1 vertical slice is complete through installation inspection, modification-safe removal, and diagnostics. Milestone 2 has both selected host adapters and shared contract coverage. Milestone 3 is complete through the versioned anonymous read contract, PostgreSQL/object-storage boundaries, read-only API, CLI discovery and installation commands, local public catalog, ranked search, and a passing live integration harness. Milestone 4 now has the static scanner, durable namespace ownership, PostgreSQL-backed release/session/state/upload storage, bounded registry session scopes with publisher-write mutation enforcement, a permission-restricted GitHub device-flow CLI credential handoff with refresh support, a provider verifier and PKCE callback-flow boundary, generic bearer/cookie API boundaries, hosted GitHub start/callback/session routes, token-free registry session inspection, signed artifact upload/completion into scanning state, just-in-time `publisher:write` CLI publication sessions, a leased PostgreSQL scan worker that verifies, safely extracts, scans, rejects, or activates releases, an authenticated read-only publisher workspace backed by owner-scoped package/version history, and a server-only browser publication intent handoff that reserves a server-derived release coordinate without accepting package files. Milestone 5 now also has bounded authenticated reports and append-only maintainer audit reads backed by migration `0008_registry_moderation.sql`, guarded publisher deprecation and maintainer quarantine/restoration backed by migration `0009_release_moderation.sql`, emergency SHA-256 digest denylist enforcement backed by migration `0010_digest_denylist.sql`, route-aware API rate limiting, the operator incident runbook, a focused security review that fixed the optional worker denylist boundary, configurable local web port coexistence, and a production scheduler with queue health/readiness and graceful lease-aware shutdown. Public-beta preparation now includes ten maintained starter fixtures with synchronized catalog metadata and a deterministic, Ed25519-signed CLI release-bundle workflow; browser artifact upload and activation remain intentionally out of scope for this handoff.

Public-beta readiness also includes the public `/v1/status`/`/status` operational view and implementation-aligned privacy, content, platform-support, and retention policies; deployment probes, alert wiring, legal identity, external package-registry publication, key custody, and creator/user recruitment remain follow-ups.

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
- [x] Added ten maintained public-beta starter-skill fixtures under `examples/starter-skills/`, a reviewed catalog manifest, and shared validation/static-scan coverage; all are instruction-only and opt-in.
- [x] Added the reproducible signed CLI release-bundle procedure, verifier, ADR, and protected tag/manual workflow; package-registry publication and key custody remain deployment work.
- [x] Added the versioned `/v1/status` contract, injected API/worker/storage/moderation signals, public `/status` page, and operator composition guidance; live deployment probes and alert wiring remain environment work.
- [x] Published implementation-aligned privacy, content, platform-support, and retention policies; hosted legal identity, contacts, jurisdiction, and deployment-specific schedules remain operator work.
- [x] Added `docs/BETA_READINESS.json` plus `check:beta`/`test:beta` scripts and a CI gate that distinguish repository readiness from deployment and external-beta actions.
- [x] Added the controlled public-beta launch handoff covering hosted services, status probes/alerts, release-key custody, policy setup, and evidence capture.
- [x] Added privacy-conscious creator/user feedback prompts and a machine-readable PRD activation/reliability/adoption metric dictionary in `docs/BETA_FEEDBACK.md` and `docs/BETA_METRICS.json`.
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
- [x] Added the bounded `RegistryReleaseWorkerScheduler` loop with immediate first run, non-overlapping lease claims, retry-aware failure health, queue lag/counter metrics, readiness snapshots, and graceful lease-aware shutdown.
- [x] Added authenticated `agentcargo publish` for local skills, including validation/scanning, deterministic artifact packing, reservation idempotency, signed upload, metadata checks, completion, and token-redacted output.
- [x] Scoped CLI publication to a just-in-time, non-persisted `publisher:write` registry session; provider credentials are used only for exchange, and expired or differently scoped sessions fail closed.
- [x] Added the local-only `/publish` instruction-skill builder with compatibility controls, generated `SKILL.md`/`agentcargo.yaml` previews, copyable CLI handoff, and an explicit no-upload boundary.
- [x] Added local package version history with release status, published date, scan findings, immutable digest selection, and version-specific install commands.
- [x] Added the local-only `/publisher` workspace with anonymous-safe sign-in gating, optional identity-header display, read-only namespace/package summaries, and an explicit no-mutation boundary.
- [x] Added the authenticated browser publication intent handoff; the server derives the owned namespace from the read-scoped workspace, issues a one-shot `publisher:write` session in memory, and reserves an idempotent release without accepting browser namespace selectors, package files, or tokens.
- [x] Added an explicit registry-access status to `/publisher`; workspace identity is labeled as display-only, the exact `publisher:read` scope is visible, and the intent-only browser reservation remains unavailable until a registry session is issued.
- [x] Added the fail-closed server-side `/api/registry-session` boundary; it reports sanitized identity-only status, rejects browser credentials, and returns no registry token until a request-scoped provider resolver is available.
- [x] Added the server-only web session bridge contract; it injects a host-owned provider resolver, requests `publisher:read` only, validates the short-lived session, and serializes an opaque HttpOnly cookie without exposing the token in JSON.
- [x] Added token-free `GET /v1/auth/session` introspection across the versioned contract, registry client, in-memory/PostgreSQL stores, and Fastify API; only expiry and scopes are returned.
- [x] Wired the web bridge to an authenticated server-to-server provider broker plus the registry exchange/introspection routes through fail-closed server-only environment settings; browser inputs and tokens are not forwarded or returned.
- [x] Added explicit web session-cookie revocation through `DELETE /api/registry-session`, with no provider credential required.
- [x] Added server-only opaque session-cookie parsing and optional read-session inspection; malformed, duplicate, expired, unavailable, and over-scoped cookies fail closed and only sanitized metadata crosses the web boundary.
- [x] Added the authenticated `GET /v1/publisher/workspace` contract, client, Fastify route, and PostgreSQL repository for owner-scoped namespaces, packages, and immutable reservation/upload/scan/public release histories.
- [x] Replaced local demo records on `/publisher` with registry-backed version histories loaded only through an exact `publisher:read` session; invalid, unavailable, over-scoped, or structurally invalid data fails closed.
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

Verification history (latest full verification on 2026-08-21):

```text
pnpm verify          PASS: all workspace TypeScript checks/builds, 23 test files, 200 tests passed, 1 opt-in live integration test skipped
CI=true pnpm verify  PASS: all workspace TypeScript checks/builds, 23 test files and 195 tests passed, 1 opt-in live integration test skipped
CI=true pnpm --filter @agentcargo/cli test  PASS: 21 tests, including write-only publication session exchange, scope/expiry rejection, device-login success, and CI-interactive denial fixtures
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
CLI status tests PASS: human/JSON output, degraded-success and outage-failure exit semantics, bounded worker/queue details, and `/v1/status` routing
Core registry install test PASS for expected-digest mismatch protection
Static scanner tests      PASS with stable rule IDs/versions, bounded evidence, metadata filtering, and no execution
CLI scan test             PASS with machine-readable scanner output
CLI auth tests             PASS with status/logout and token-redaction coverage
CLI OAuth tests            PASS with device login, refresh, token-redaction, and CI-interactive guard coverage
CLI publish tests          PASS with 21 CLI cases covering write-only session exchange, local validation, deterministic packing, authenticated reservation/upload/completion, fail-closed scope/expiry checks, metadata checks, and provider/session token redaction
Publisher contract tests  PASS with GitHub identity, session/metadata responses, semver reservation, bounded idempotency, and OpenAPI references
Registry reservation tests PASS with first-write, replay, coordinate conflict, namespace ownership, and invalid-context coverage
Registry API publishing tests PASS with gated configuration, authentication, validation, stable conflict errors, signed upload URLs, and scanning completion
Registry API auth tests    PASS with bearer/cookie extraction, verifier delegation, malformed-header rejection, hosted start/callback redirects, cookie flags, outage redaction, opaque session expiry/revocation, provider exchange, token-free introspection, and no-store session responses
Registry DB search/session tests PASS with full-text/trigram predicates, ranking, parameterization, hash-only session persistence, token-free metadata resolution, revocation, one-time OAuth state, upload completion, leased scan jobs, activation projection, and migration coverage
Registry moderation tests PASS with bounded report validation, publisher-scoped idempotent report intake, append-only audit-event mapping, maintainer API authorization, and migration coverage
Registry release moderation tests PASS with publisher ownership guards, maintainer quarantine/restoration, idempotent status transitions, public status filtering, client routes, and migration coverage
Registry digest denylist tests PASS with idempotent maintainer mutations, append-only audit events, public filtering, worker activation rejection, client routes, and migration coverage
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
Registry client session tests PASS: 9 client tests including scoped exchange, token-free inspection, and rejected-credential handling
Root pnpm dependency restoration PASS on 2026-08-19 after approved network access; locked workspace dependencies are available again
Live PostgreSQL/MinIO integration PASS: namespace claim, durable reservation replay, release activation, immutable lookup, signed download, digest verification, and retry
Web catalog build PASS: Vinext production build
Web catalog test PASS: server-rendered catalog and hosted publish-link assertions
Web catalog lint PASS
Web catalog browser demo PASS: local preview loaded; search, Codex filter, package findings, install-command copy, and version-history selection verified
Web builder browser demo PASS: `/publish` rendered locally; form generation, compatibility declarations, generated files, CLI command copy, and no-upload messaging verified
Web publisher browser demo PASS: `/publisher` rendered locally; anonymous sign-in gate, exact read-scope boundary, no-demo-data state, and no-mutation messaging verified
Web publisher session-boundary checks PASS: production build, server-rendered anonymous/identity states, exact read-only scope, no-token copy, and lint
Web registry session route checks PASS: anonymous/identity-only status, sanitized cookie-state fields, no-store responses, rejected browser credentials, unconfigured-provider failure, and cookie revocation
Web registry session bridge tests PASS: 11 cases covering unset bridge, authenticated host-broker composition, exact read-scope exchange, token-free registry inspection, owner-scoped publisher history loading, unsafe/partial configuration rejection, cookie serialization/parsing, and fail-closed invalid results
Web registry session composition PASS: Vinext production build, 16 rendered/bridge tests, and ESLint
Authenticated publisher workspace tests PASS: strict contract/OpenAPI validation, typed client auth, read-scope API enforcement, session-derived actor isolation, PostgreSQL history/status mapping, server-only web loading, and fail-closed rendering
Core update-preview tests PASS: 7 focused cases plus the full 60-test core suite
CLI update dry-run tests PASS: verified registry metadata/artifact comparison with unchanged installed files and lockfile; full 17-test CLI suite passes
Core atomic update/rollback tests PASS: clean swaps, shared operation locking, drift refusal, reversible rollback, repeated-update backup replacement, removal cleanup, doctor inspection, and injected metadata-commit recovery
CLI update/rollback tests PASS: confirmed registry update, lockfile/file replacement, rollback restoration, and confirmation boundaries; full 18-test CLI suite passes
Core audit tests PASS: 11 core files and 77 tests, including clean receipt verification, artifact-digest labeling, installed-tree scanning, drift/missing/untracked/invalid paths, no-follow behavior, recovery findings, and shared update/rollback lock refusal
CLI audit tests PASS: clean and drifted JSON reports, actionable remediation, and failure exit status; full 19-test CLI suite passes
Registry dependency contract tests PASS: bounded unique descriptive requirements in runtime validation and OpenAPI
Registry rate-limit tests PASS: bounded fixed-window capacity, stable `429`/`Retry-After` responses, reporting throttling, and publishing fail-closed behavior
Focused Milestone 5 security review PASS: required worker denylist dependency, fail-closed outage behavior, malformed/auth/replay checks, and residual-risk documentation in `docs/SECURITY_REVIEW_2026-08-20.md`
Web port coexistence tests PASS: `AGENTCARGO_WEB_PORT` validation, explicit CLI precedence, web build, rendered/session/publication tests (24), and lint
Web publication intent tests PASS: server-derived namespace ownership, exact write scope, same-origin mutation checks, idempotent reservation mapping, browser-input rejection, no-token responses, and fail-closed errors
Worker scheduler tests PASS: non-overlap, bounded interval/start-stop, failure/readiness redaction, queue lag/stale-lease health, and scheduled denylist rejection
Registry scan queue health tests PASS: PostgreSQL queue counters, stale lease count, oldest available time, and package-content exclusion
Starter fixture verification PASS: ten catalog entries match their directories; shared validation and static scanning report no findings for every fixture
Web starter catalog checks PASS: local catalog renders the maintained starter entries alongside the preview records; build, rendered tests, and lint pass
CLI release-bundle tests PASS: deterministic duplicate USTAR bundles, canonical manifest inventory, Ed25519 signature verification, and tampered-archive rejection (23 CLI tests)
CLI release workflow smoke PASS: local Ed25519 key generated outside the repository; `scripts/release-cli.mjs` built and verified a signed bundle with archive digest `sha256:f07eb510c4f18cac7f11110341148934f818cf7302c1b56cb08e5f9dd7eaac5d`
CLI release workflow YAML check PASS: manual/tag trigger, protected-key fail-closed gate, public-key export, verification, artifact upload, and ephemeral-key cleanup are present
Registry status contract/API tests PASS: bounded OpenAPI/validator coverage, injected database/storage/worker/moderation signals, sanitized failures, degraded/outage semantics, and cache headers
Worker status adapter tests PASS: stopped/degraded readiness before a run, operational readiness after a successful run, queue counters, and redacted health details
Registry client status test PASS: public `/v1/status` fetch validates the versioned response and rejects malformed payloads
Web status page checks PASS: `/status` server-only fetch, fail-closed not-connected/unavailable states, rendered counter/readiness cards, build, 25 rendered tests, and lint
Policy documentation checks PASS: README links resolve to privacy, content, platform-support, and retention documents; each states current MVP boundaries and deployment/legal follow-ups without claiming unsupported guarantees
Beta readiness verifier PASS: `node scripts/check-beta-readiness.mjs --strict` reports all six repository gates ready and six deployment/external gates pending without exposing secrets
Beta readiness tests PASS: repository-ready/pending summary and missing-path/evidence failure cases (2 tests)
Beta readiness workflow check PASS: CI runs `pnpm check:beta` after the existing cross-platform workspace verification
Migration preflight verification PASS: `pnpm check:migrations` reports ten contiguous migrations through `0010`; focused tests cover malformed names, gaps, duplicates, destructive SQL, and unreadable directories; the result explicitly reports `databaseState: not_checked`
Windows CI path-fix verification PASS: the signed CLI release-artifact tests now resolve the workspace root with `fileURLToPath`; the prior Node 24 Windows `D:\\D:\\a\\...` path failure is covered by the same two-test suite and no longer reproduces locally
Beta feedback/metrics templates PASS: JSON metric definitions parse, feedback fields are bounded/pseudonymous, and PRD adoption/reliability targets map to aggregate records
Beta launch handoff checks PASS: readiness/metrics JSON parse and local links resolve across README, launch, feedback, and policy documents
Full workspace verification PASS on 2026-08-20: `pnpm verify` completed all package checks/builds/tests; the live registry integration test remained skipped without its opt-in environment
CLI status slice verification PASS on 2026-08-20: focused CLI check/test, strict beta-readiness check/test, workspace `pnpm verify`, and web build/rendered tests/lint all passed; live registry integration remained skipped without opt-in environment
Starter catalog expansion verification PASS on 2026-08-21: ten fixture directories match catalog metadata; core validation/static scanning, web build/rendered tests/lint, `pnpm verify`, beta checks, and `git diff --check` passed; live registry integration remained skipped without opt-in environment
Full workspace verification PASS on 2026-08-21: `pnpm verify` completed all package checks/builds/tests; the opt-in live registry integration test remained skipped without its environment
Web workspace verification PASS on 2026-08-21: web production build, 25 rendered/bridge/publication tests, and lint all passed
Whitespace scan and git diff --check PASS
```

The install and lifecycle test matrix covers Codex project and user scopes, declared-scope enforcement, unmanaged destinations, symlink escapes, lockfile parsing and atomic replacement, per-file ownership, drift classification, clean and forced removal, preservation of untracked content, invalid-link refusal, multiple lock entries, stale operation locks, abandoned staging paths, CLI confirmation, and rollback after a forced installation lockfile-commit failure.

## In progress

The authenticated publisher read path is complete from the versioned contract through the client, scoped Fastify endpoint, PostgreSQL ownership query, server-only web resolver, and `/publisher` presentation. The API derives publisher ownership only from an exact `publisher:read` session; the browser cannot select a namespace or publisher identity. Reserved, expired, uploading, uploaded, scanning, active, deprecated, quarantined, and rejected immutable versions can be represented without exposing provider or registry tokens. Bounded reports, append-only maintainer audit reads, publisher deprecation, maintainer quarantine/restoration, emergency digest denylist enforcement, route-aware API rate limiting, the operator incident runbook, focused security review, local port coexistence, the browser publication intent handoff, the production worker scheduler, ten maintained starter fixtures, the signed CLI release-bundle workflow, operational status signals, the anonymous `agentcargo status` command, public-beta policy documentation, the auditable readiness handoff, and aggregate feedback/metrics templates are implemented and verified. Browser artifact upload, scanning, and activation remain CLI/registry operations; deployment-specific probes, alert wiring, legal setup, external registry publication/key custody, and creator/user recruitment are next.

## Recently completed slice

### Expand the curated public-beta starter set

- [x] Add `sql-review`, `incident-triage`, and `dependency-review` as instruction-only fixtures with both-host compatibility and no executable capabilities.
- [x] Synchronize ten catalog entries with their directories, manifests, descriptions, tags, and explicit-selection policy.
- [x] Extend the core fixture test to require exactly ten maintained entries and keep validation/static scanning clean for every fixture.
- [x] Add the three maintained skills to the local web catalog and rendered catalog coverage.

Exit condition: the public-beta starter catalog reaches the initial ten-skill target without silently installing or executing any fixture.

### Expose public registry status through the CLI

- [x] Add anonymous `agentcargo status [--registry <url>]` with human-readable and `--json` output backed by the validated `/v1/status` contract.
- [x] Keep degraded availability informational while returning a non-zero exit status for an outage or transport/response-validation error.
- [x] Render bounded component, worker-readiness, queue-lag, and moderation counters without package contents, credentials, or raw infrastructure errors.
- [x] Add CLI coverage for degraded JSON output, outage exit semantics, URL routing, bounded human output, and stable missing-registry errors.
- [x] Document the command in the README, contributor context, and controlled public-beta launch handoff.

Exit condition: operators and automation can consume the same safe public status contract from the terminal without treating a degraded registry as a transport failure.

### Add an auditable public-beta readiness handoff

- [x] Add machine-readable repository, deployment, and external-beta gates in `docs/BETA_READINESS.json`, with explicit status semantics and operator actions.
- [x] Add `scripts/check-beta-readiness.mjs` with human/JSON output, safe path/evidence validation, and `--strict` failure only for repository gates.
- [x] Add root `check:beta` and `test:beta` commands and run the strict verifier in the cross-platform CI workflow.
- [x] Verify that repository readiness is complete while hosted service configuration, release-key custody, legal setup, creator recruitment, and learning targets remain pending.
- [x] Document the ordered deployment/recovery sequence and signed-key/public-fingerprint distribution in `docs/BETA_LAUNCH.md` without treating local verification as hosted readiness.
- [x] Define bounded creator, user, maintainer, and adapter-contributor feedback fields plus aggregate-only metric records; external collection remains pending.

Exit condition: a clean checkout can report repository readiness deterministically, while the launch handoff makes deployment and external-user blockers explicit instead of presenting an unsafe all-clear.

### Add PostgreSQL migration preflight verification

- [x] Add `scripts/check-migrations.mjs` with human/JSON output, stable error codes, SHA-256 inventory, strict failure mode, and an explicit `databaseState: not_checked` boundary.
- [x] Reject unsafe migration entries, invalid names, sequence gaps, duplicate numbers, destructive SQL, and unsafe SQL without connecting to PostgreSQL.
- [x] Add focused tests for the real ten-migration repository, malformed temporary repositories, and missing migration directories.
- [x] Wire `check:migrations` and `test:migrations` into the beta scripts, repository readiness evidence, README/development commands, and cross-platform CI.
- [x] Document that this preflight verifies checked-in repository order only; applied database state remains a deployment concern.

Exit condition: operators get a deterministic migration inventory and strict repository gate before applying migrations, while deployment-only database state remains explicitly unverified.

### Fix Windows release-artifact CI path resolution

- [x] Diagnose the failed `main` CI run: all jobs passed except `verify (windows-latest, 24)`, where the CLI release-artifact tests built an invalid `D:\\D:\\a\\...` workspace path from `URL.pathname`.
- [x] Use Node's cross-platform `fileURLToPath` conversion in `packages/cli/src/release-artifacts.test.ts`.
- [x] Verify the focused CLI suite, full workspace verification, beta checks, migration tests, and whitespace checks.

Exit condition: the signed release-artifact test resolves repository paths correctly on Windows, macOS, and Linux without changing release contents or signing behavior.

### Add bounded reports and append-only moderation audit events

- [x] Define versioned report, actor, target, status, and moderation-event contracts with bounded evidence and metadata.
- [x] Add PostgreSQL migration `0008_registry_moderation.sql`, idempotent report persistence, and an append-only audit-event trigger.
- [x] Add authenticated `POST /v1/reports` intake and maintainer-only `GET /v1/admin/audit-events` reads with no-store responses and stable authorization errors.
- [x] Add typed client methods plus in-memory/PostgreSQL repository, contract, API, migration, and persistence tests.

Exit condition: users can submit bounded reports and maintainers can inspect an append-only, attributable moderation history without mutable audit records or credential disclosure.

### Add guarded release deprecation and quarantine

- [x] Add versioned deprecation/quarantine request and response contracts, OpenAPI routes, and typed client operations.
- [x] Add publisher-owned deprecation plus maintainer-only quarantine/unquarantine transitions with bounded reasons and idempotent replay.
- [x] Preserve release identity, record prior public status for restoration, and append immutable moderation events for every transition.
- [x] Exclude quarantined releases from in-memory and PostgreSQL public package, search, and exact-release reads while retaining maintainer audit visibility.
- [x] Verify ownership, role/scope rejection, state conflicts, replay behavior, public status overlays, client calls, and migrations `0009_release_moderation.sql`.

Exit condition: authorized publishers can deprecate their own releases, maintainers can quarantine or restore releases, and public reads never expose quarantined content.

### Add emergency SHA-256 digest denylist enforcement

- [x] Add a maintainer-controlled, content-addressed denylist with bounded reason metadata and append-only add/remove events.
- [x] Enforce active denylist entries on public exact/package/search reads, signed artifact resolution, worker activation, and local registry installation through the public client path.
- [x] Keep denylist mutations idempotent, fail-closed at trust boundaries, and attributable to maintainer actors without exposing credentials.
- [x] Verify contract/OpenAPI, migration `0010_digest_denylist.sql`, repository, API, client, worker, and public-filtering tests.

Exit condition: a denylisted SHA-256 digest cannot be activated or publicly resolved, and every emergency change is attributable, reversible, and audited.

### Add rate limiting and incident runbooks

- [x] Add an injectable, bounded route-aware limiter for authentication, search, reporting, publishing, workspace/audit reads, release moderation, and denylist mutations.
- [x] Return stable `429 REGISTRY_RATE_LIMITED` errors with `RateLimit-*`/`Retry-After` headers and fail closed with a generic `503` when limiter state is unavailable.
- [x] Add deterministic in-memory limiter capacity/window tests plus API coverage for search throttling, reporting mutation throttling, and publishing fail-closed behavior.
- [x] Document digest denylisting, quarantine/restoration, token compromise, artifact integrity, abuse throttling, rollback, evidence preservation, and verification in `docs/INCIDENT_RUNBOOK.md`.

Exit condition: abuse-sensitive API paths enforce observable bounded limits, operators have a tested emergency response procedure, and limiter behavior does not expose secrets.

### Run focused security review

- [x] Review reports, audit events, release moderation, denylisting, public filtering, worker activation, and rate limiting against the threat model.
- [x] Fix the worker/PostgreSQL activation fail-open risk by requiring a denylist reader and failing closed on reader outages.
- [x] Exercise malformed input, authorization, replay, failure, and stale-cache response scenarios and record residual risks.
- [x] Publish the review evidence and follow-ups in `docs/SECURITY_REVIEW_2026-08-20.md`.

Exit condition: the reviewed moderation and abuse-control slice has no untriaged high-severity findings and its residual risks are explicit.

### Make local web port coexistence explicit

- [x] Add a validated `AGENTCARGO_WEB_PORT` override and explicit `--port` precedence for local Vinext dev/preview commands.
- [x] Document running AgentCargo on port 3001 (or another free port) while Bridge owns localhost:3000.
- [x] Add port parsing and wrapper tests without changing Bridge configuration or shared project state.
- [x] Verify the web build, rendered/session tests, lint, and port helper tests.

Exit condition: AgentCargo local dev/preview can move off port 3000 deterministically and the coexistence procedure is documented.

### Add authenticated browser publication intent handoff

- [x] Add a browser-triggered, server-only publication intent route that accepts only a bounded skill name, semantic version, and idempotency key.
- [x] Resolve namespace ownership from the exact `publisher:read` workspace; ambiguous or missing ownership fails closed without a browser namespace selector.
- [x] Exchange the server-side provider credential for exactly one `publisher:write` session in memory and use it only for idempotent release reservation.
- [x] Keep artifact upload, scanning, activation, and all package-file handling on the CLI/registry boundary; return no-store responses without tokens or provider metadata.
- [x] Verify contract, API, server-rendered UI, build/lint, malformed-input, scope, replay, and unavailable-boundary tests.

Exit condition: an authenticated publisher can start a reviewable browser publication handoff while registry ownership and artifact safety remain server-enforced; artifact upload and activation remain explicit CLI/registry steps.

### Wire production worker scheduling and operational checks

- [x] Add a bounded scheduler loop around the durable scan-job worker with an immediate first cycle, retry-aware health state, and lease-aware graceful shutdown.
- [x] Add queue-only counters, stale-lease count, oldest available time, dispatch/run-age metrics, and sanitized readiness snapshots without package contents or credentials.
- [x] Verify no overlapping claims, scheduled denylist enforcement, failure redaction, queue lag readiness, stale-lease reporting, and shutdown draining.

Exit condition: a deployment can run the worker continuously with bounded retries, observable lag, and safe shutdown/recovery behavior.

### Add operational status and dashboard signals

- [x] Define and validate a versioned `/v1/status` response and OpenAPI schemas for API, database, storage, worker, moderation, queue, readiness, and lag signals.
- [x] Add a public, cache-bounded Fastify status route with injected probes, generic failure redaction, explicit degraded/outage semantics, and no authentication requirement.
- [x] Adapt scheduler health into the contract, expose a typed registry-client `getStatus()` method, and render a server-only `/status` page with bounded counters and fail-closed unavailable states.
- [x] Document deployment composition, alert guidance, and secret/content redaction in `docs/OPERATIONS.md`; verify contract, API, worker, client, and web coverage.

Exit condition: operators and anonymous users can inspect safe API/queue/worker/moderation availability signals without package content, credentials, or raw infrastructure errors.

### Publish public-beta policy documentation

- [x] Publish `docs/PRIVACY.md` describing current data categories, provider/session boundaries, public release visibility, user requests, and hosted-deployment legal follow-ups.
- [x] Publish `docs/CONTENT_POLICY.md` covering allowed/prohibited skill content, declared/observed/enforced trust evidence, reporting, quarantine, denylisting, and appeals.
- [x] Publish `docs/PLATFORM_SUPPORT.md` covering Node/pnpm and OS support, Codex/Claude Code paths, browser/local-port boundaries, and explicit MVP exclusions.
- [x] Publish `docs/RETENTION.md` with immutable-release, moderation, session, callback-state, credential, job, log, and local-draft handling plus operator schedules.
- [x] Link the four policies from the README and keep deployment identity, jurisdiction, contacts, subprocessors, and exact retention periods as explicit operator-owned follow-ups.

Exit condition: a prospective public-beta user can find the current privacy, content, platform-support, and retention boundaries without mistaking implementation defaults for legal or host-enforced guarantees.

### Prepare reproducible signed CLI release artifacts

- [x] Define the `agentcargo-cli-ustar-v1` bundle containing the built CLI and first-party runtime package set, with normalized USTAR metadata and unsigned-UTF-8 path ordering.
- [x] Record the source commit, runtime requirements, package versions, every file receipt, and archive SHA-256 in a canonical manifest with no generated timestamp.
- [x] Sign the canonical manifest with an operator-supplied Ed25519 key, provide a detached signature/checksum, and add a verifier that rejects key, signature, digest, and byte-count mismatches.
- [x] Add deterministic duplicate-build, signature, tamper, and CLI smoke coverage plus a protected-key manual/tag GitHub workflow that fails closed until configured.
- [x] Document key handling, public-key distribution, update/rollback boundaries, and the remaining package-registry publication/key-custody work in `docs/RELEASE.md` and ADR 0007.

Exit condition: maintainers can build, sign, reproduce, and independently verify a CLI release bundle without committing or exposing a private key.

### Curate the initial public-beta starter set

- [x] Add ten maintained instruction-only fixtures covering code review, test writing, documentation, security review, Git/PR assistance, React review, backend API review, SQL review, incident triage, and dependency review.
- [x] Add synchronized catalog metadata with maintainer, review date, explicit-selection policy, tags, and both-host compatibility.
- [x] Keep every fixture free of scripts, network/environment declarations, and executable files; users must explicitly select a starter skill before installation.
- [x] Verify every catalog entry against its directory with shared validation and static scanning, and render the starter set in the local catalog preview.

Exit condition: the public-beta catalog has a maintained, reviewable seed set that is validated before presentation and never silently installed.

### Add authenticated publisher version history

- [x] Define and validate bounded owner-scoped namespace, package, and immutable release-history response models in the registry contract and OpenAPI document.
- [x] Add a parameterized PostgreSQL publisher-workspace repository and a no-store Fastify route requiring `publisher:read`.
- [x] Add the typed registry client method and server-only web resolver using only the opaque AgentCargo session cookie.
- [x] Replace publisher demo data with authenticated registry histories and fail-closed empty/error states.
- [x] Verify scope rejection, actor isolation, row mapping, response validation, web composition, rendering, build, and lint.

### Compose read-only web registry sessions

- [x] Add token-free registry session introspection backed by the active in-memory or PostgreSQL session store.
- [x] Configure the web bridge from a trusted host provider broker and registry URL using server-only deployment settings.
- [x] Request exactly `publisher:read`, reject partial/unsafe configuration, and keep browser headers, provider tokens, registry tokens, and publisher identity out of browser responses.

### Scope CLI publication credentials

- [x] Exchange the stored GitHub provider credential for a short-lived AgentCargo session before publication.
- [x] Request exactly `publisher:write` and reject expired or differently scoped sessions.
- [x] Keep the registry session in memory and use it, rather than the provider token, for all release mutation requests.
- [x] Verify provider and session token redaction in machine-readable output.

### Complete safe local lifecycle operations

- [x] Update-preview engine with file, script, capability, dependency, manifest, and finding changes.
- [x] `agentcargo update --dry-run` with registry artifact verification and no local mutation.
- [x] Atomic `agentcargo update` with modification protection, operation locking, retained recovery state, and lockfile rollback on failure.
- [x] `agentcargo rollback` with backup receipt validation and atomic restoration.
- [x] `agentcargo audit` with integrity, drift, scanner, and remediation reporting.

## Next recommended slice

### Prepare public-beta operations

- [x] Publish the reproducible signed CLI release-bundle workflow and document update/rollback channels; external package-registry publication remains pending.
- [x] Add operational dashboards/status information backed by the scheduler, API, storage, and moderation signals; deployment-specific probes and alert wiring remain pending.
- [x] Expose the same bounded operational status through `agentcargo status` with stable human/JSON output and outage exit semantics; live deployment probes and alert routing remain pending.
- [x] Publish privacy, content, platform-support, and retention documentation; hosted legal identity, contacts, jurisdiction, and exact schedules remain pending.
- [x] Add an auditable `docs/BETA_READINESS.json` launch checklist, strict local verifier, and cross-platform CI gate that report repository readiness separately from deployment/external blockers.
- [x] Add a repository-only PostgreSQL migration preflight with strict CI/beta wiring; applied database state and live integration remain deployment work.
- [x] Define privacy-conscious creator/user feedback and aggregate PRD metric templates; collecting external responses and reaching targets remain pending.
- [ ] Recruit external creators/users and measure the PRD beta learning targets.

Exit condition: the implemented vertical slice is packaged for a controlled public beta with seed content, release artifacts, operator visibility, and user-facing policy documentation.

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
- [x] `agentcargo status` through the versioned anonymous operational-status API.
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
- [x] Short-lived registry-scoped CLI publication sessions.
- [x] Web-app session composition and scope selection.
- [x] Authenticated release-reservation contract and gated API boundary.
- [x] Durable namespace ownership and PostgreSQL-backed release reservation.
- [x] Immutable artifact upload and completion workflow through durable `scanning` state.
- [x] PostgreSQL-backed worker jobs, leased claims, retry handling, and validated activation boundary.
- [x] Static scanner rules with evidence and rule versions.
- [x] Authenticated publisher pages and version-history management.
- [x] Authenticated browser publication intent handoff with server-derived namespace ownership and write-scoped idempotent reservation (artifact upload remains CLI/registry-bound).
- [x] Simple UI builder for instruction-only skills with local file previews and CLI handoff.
- [x] CLI publication from local skill directories.

### Milestone 5: Lifecycle and moderation

- [x] Update preview with file, script, capability, dependency, manifest, and finding changes.
- [x] Atomic update and rollback.
- [x] Local drift audit.
- [x] Reports and append-only moderation audit events.
- [x] Release deprecation and quarantine.
- [x] Emergency digest denylist.
- [x] Rate limiting and incident runbooks.
- [x] Focused security review.
- [x] Production worker scheduling and operational checks.

### Milestone 6: Public beta

- [x] Curate 10 initial starter skills, growing toward 20 useful seed skills.
- [x] Produce reproducible signed CLI release bundles; external package-registry publication and production key custody remain pending.
- [x] Add operational dashboards, public status information, and the anonymous `agentcargo status` view; deployment-specific probes and alert wiring remain pending.
- [x] Publish privacy, content, platform-support, and retention documentation; hosted legal identity, contacts, jurisdiction, and exact schedules remain pending.
- [x] Add the machine-readable public-beta readiness checklist and strict CI/local verifier.
- [x] Define aggregate-only creator/user feedback and PRD metric templates; external collection remains pending.
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
- Local creation, validation, deterministic packaging, hashing, safe extraction, Codex/Claude Code installation, authenticated local registry publication, the local browser skill builder, public package version history, authenticated read-only publisher histories, bounded reports, append-only moderation audit reads, guarded release deprecation/quarantine, emergency digest denylist enforcement, route-aware API rate limiting, the incident runbook, focused security review, configurable local port coexistence, the server-only browser publication intent handoff, and the production worker scheduler exist. CLI publication exchanges its stored provider credential for a non-persisted short-lived `publisher:write` session. The web app has a server-only host-broker composition, exact read-scope exchange, opaque cookie handoff/revocation, fail-closed status route, token-free registry-backed cookie inspection, an owner-scoped workspace read, and an intent-only write-scoped reservation route. A deployment must still provide the trusted provider-broker endpoint and its service credential; browser package-file upload/activation, a shared multi-instance limiter, and other publisher mutations remain pending. The scheduler health/readiness snapshot must be wired into the hosting platform's own health endpoint and alerting before public beta.
- Local installations can be listed, audited, safely removed, diagnosed, compared with verified registry targets, atomically updated, and rolled back to the retained prior version. Audit reverifies host-ready receipts but labels source-artifact digests as recorded because source artifact bytes are intentionally not retained locally.
- Claude Code has a local adapter and shared contract coverage. An authenticated live-host discovery smoke test remains optional and has not run in the current unauthenticated environment.
- Package size and file-count limits are initial engineering defaults and need product validation.
- The signed CLI release workflow produces a verifiable build bundle and protected-key CI path, but no external package registry or hardware-backed release-key service is configured yet. The public key and fingerprint must be distributed through a trusted release channel before public consumption.
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
