# AgentCargo Implementation Roadmap

This roadmap sequences risk before polish. Each milestone should end with a demonstrable workflow and automated tests.

## Milestone 0: Foundation and decisions

Outcome: contributors can clone, understand, test, and change the project consistently.

- Initialize Git and choose an open-source license for the public code.
- Create the pnpm TypeScript monorepo.
- Add formatting, linting, type checking, unit tests, and CI.
- Add contribution guidelines, code of conduct, security policy, and issue templates.
- Write architecture decision records for the monorepo, package naming, archive format, and open-source boundary.
- Verify the current native contracts for Codex and candidate second hosts.
- Select the second host using user demand, format stability, and testability.

Exit criteria:

- A clean checkout passes one documented validation command.
- CI runs on macOS, Linux, and Windows for CLI/core packages.
- Major design choices are written down rather than living only in chat history.

## Milestone 1: Local package core

Outcome: a developer can create, validate, pack, install, list, remove, and diagnose a local skill without a hosted registry.

- Implement package coordinates and manifest schema v1.
- Implement `agentcargo init`, `agentcargo validate`, and `agentcargo pack`.
- Implement deterministic package creation and SHA-256 digests.
- Implement safe streaming extraction.
- Define and test the host adapter contract.
- Implement the Codex adapter for project and user scopes.
- Implement atomic installation and ownership receipts.
- Implement `agentcargo add <local-path>`, `list`, `remove`, and `doctor`.
- Implement lockfile v1.
- Create malicious archive and path-handling fixtures.
- Write `docs/THREAT_MODEL.md`.

Exit criteria:

- A fixture skill installs into an isolated Codex test home and project.
- Installation never writes outside the resolved scope root.
- The same fixture produces the same canonical digest on all supported operating systems.
- Removal refuses to destroy untracked local modifications without confirmation.

## Milestone 2: Second host and adapter ecosystem

Outcome: AgentCargo proves that the package abstraction is genuinely cross-agent.

- Document the selected host's current skill contract and provenance.
- Implement its project/user scopes where supported.
- Run the shared adapter contract suite.
- Add `agentcargo doctor` host detection.
- Document how contributors create third-party adapters.
- Add adapter compatibility metadata and last-verified host version.

Exit criteria:

- The same source skill can be installed into both initial hosts.
- No host-specific paths exist in CLI core.
- Adapter failures produce stable, actionable errors.

## Milestone 3: Registry read path

Outcome: users can search, inspect, resolve, download, and install immutable public releases.

- Create PostgreSQL schema and migrations.
- Implement registry read API and OpenAPI contract.
- Add S3-compatible artifact storage.
- Implement package detail and search pages.
- Implement PostgreSQL full-text and trigram search.
- Implement `agentcargo search`, `inspect`, and remote `add`.
- Verify digest before installation.
- Add CDN/cache behavior for immutable artifacts.

Exit criteria:

- Seed packages are searchable from web and CLI.
- A release resolves to immutable bytes and a documented digest.
- Anonymous installation works without a registry account.

## Milestone 4: Publishing and static analysis

Outcome: external creators can publish without direct maintainer involvement.

- Add GitHub OAuth and namespace creation.
- Implement CLI authentication without exposing tokens.
- Implement release reservation, upload, completion, and idempotency.
- Build worker state machine and PostgreSQL-backed jobs.
- Share package validation rules between CLI and worker.
- Add initial static scanner rules and explainable findings.
- Add publisher pages and version history.
- Reject unsafe archive structure and known-denylisted content.

Exit criteria:

- Ten invited external creators can publish successfully using documentation alone.
- A modified artifact cannot pass digest verification.
- Scanner results include rule versions, evidence, and limitations.

## Milestone 5: Safe lifecycle and moderation

Outcome: users can understand and control changes after installation, and maintainers can respond to abuse.

- Implement `update --dry-run` with semantic and file diffs.
- Implement atomic update and rollback.
- Implement `audit` and local drift detection.
- Add deprecation, quarantine, reports, and audit events.
- Add digest denylist distribution.
- Add rate limits, abuse controls, and maintainer runbooks.
- Perform a focused security review of archive, install, auth, and moderation boundaries.

Exit criteria:

- Permission, script, and file changes are visible before update.
- Quarantine blocks new installs within the documented propagation window.
- Recovery from an interrupted update is tested.
- Reporting and incident runbooks have been exercised once.

## Milestone 6: Public beta

Outcome: AgentCargo is useful to developers outside the project team.

- Curate 20 high-quality seed skills.
- Polish onboarding and error messages using observed failures.
- Publish CLI packages and signed release artifacts.
- Add public status and basic operational dashboards.
- Document privacy, content policy, supported platforms, and data retention.
- Recruit creators and collect structured feedback.
- Measure the activation and reliability metrics in the PRD.

Exit criteria:

- 100 successful external installs.
- 95% installation success across the supported matrix.
- 10 external publishers.
- No open critical security issue.

## Later opportunities

Only prioritize these after the public beta demonstrates repeat use:

- Guided browser authoring for instruction-only skills.
- Private team registries and allowlists.
- Signed publisher releases and hardware-backed keys.
- Reproducible compatibility test environments.
- Skill evaluation suites and model/agent-specific benchmarks.
- Collections and skill packs.
- Semantic search and task-based recommendations.
- Organization namespaces and delegated roles.
- Alternative registries and federation.

## Recommended first implementation slice

Build this vertical slice before any website work:

```text
example SKILL.md
    -> agentcargo validate
    -> deterministic local package
    -> digest verification
    -> Codex project install
    -> agentcargo.lock
    -> list
    -> remove
```

It proves the package contract, filesystem safety, adapter boundary, and CLI experience—the hardest assumptions underlying the rest of AgentCargo.
