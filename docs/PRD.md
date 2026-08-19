# AgentCargo MVP Product Requirements Document

| Field | Value |
| --- | --- |
| Status | Draft for implementation |
| Product | AgentCargo |
| Release | MVP / v0.1 |
| Primary audience | Developers using AI coding agents |
| Initial hosts | Codex and Claude Code |
| Business model | Free public service; no monetization in MVP |

## 1. Product summary

AgentCargo is a public registry and cross-agent package manager for reusable AI-agent skills. It lets creators publish versioned skill packages and lets developers discover, inspect, install, update, audit, and remove those packages using one CLI.

The registry does not replace an agent's native skill format. It preserves the skill's source format and uses installation adapters to place or transform the package for each supported host.

### One-line pitch

> Publish an agent skill once, install it anywhere, and know exactly what you are trusting.

## 2. Problem

Agent skills are distributed through repositories, vendor-specific directories, and independent marketplaces. Developers currently have to answer several questions manually:

- Where can I find a skill for a particular job?
- Does it support my agent and operating system?
- What files and scripts will it install?
- Has the downloaded content changed since it was published?
- What changed in a new version?
- How do I install or remove it without learning each host's directory conventions?
- Can I distinguish publisher claims from checks that were actually performed?

Creators also repeat packaging, documentation, and installation work for every host they want to support.

## 3. Product thesis

Source hosting alone is not a product advantage; Git repositories already solve that problem. AgentCargo is useful if it provides:

1. A portable package contract built around existing skill formats.
2. A consistent CLI across supported agents.
3. Immutable releases, checksums, lockfiles, update diffs, and rollback.
4. Transparent, reproducible validation and security findings.
5. Search metadata based on compatibility and evidence rather than download counts alone.

## 4. Goals

The MVP must:

- Let a creator publish a valid skill from a Git repository or local checkout.
- Assign the skill a unique publisher-scoped name and immutable semantic version.
- Validate package structure before making a release installable.
- Let a developer find and inspect skills without signing in.
- Install a selected version into Codex and Claude Code.
- Support project and user installation scopes when the target host provides them.
- Verify an artifact checksum before installation.
- Record exact installed versions in a lockfile.
- Preview changes before updating.
- Remove only files that AgentCargo owns.
- Show scan findings and their limitations clearly.
- Give maintainers a way to quarantine a malicious release.

## 5. Non-goals

The MVP will not:

- Support every editor, agent, or operating-system edge case.
- Execute untrusted skill scripts in the AgentCargo infrastructure.
- Produce a universal `Security 98/100` or `Quality 96/100` score.
- Guarantee runtime permission enforcement by third-party agents.
- Rank skills using expensive model-based benchmarks.
- Sell paid skills, subscriptions, advertisements, or verification badges.
- Provide private organization registries, SSO, or enterprise policy management.
- Resolve arbitrary skill-to-skill dependency graphs.
- Provide a full browser IDE for advanced scripted skills.
- Automatically modify an installed package outside an explicit CLI operation.

## 6. Terminology

| Term | Meaning |
| --- | --- |
| Skill | A directory containing agent instructions and optional resources or scripts. |
| Package | A normalized, versioned archive containing one skill and AgentCargo metadata. |
| Release | An immutable package version identified by namespace, name, semantic version, and SHA-256 digest. |
| Host | An AI tool capable of loading a skill, such as Codex. |
| Adapter | Host-specific logic for detection, validation, destination selection, installation, and removal. |
| Scope | Where a skill is installed: project or user. |
| Finding | A validation or security observation with severity, evidence, and rule version. |
| Quarantine | A registry state that blocks new installations of a release while preserving audit history. |

## 7. Target users

### 7.1 Skill consumer

A developer who uses one or more AI coding agents and wants reusable workflows without manually copying repositories into host-specific folders.

Needs:

- Fast discovery.
- Predictable installation.
- Clear compatibility.
- Evidence about package contents and risks.
- Reproducible team setup.

### 7.2 Skill creator

A developer, consultant, or maintainer who has created a repeatable agent workflow.

Needs:

- Simple initialization and validation.
- One publishing workflow.
- Version history and release visibility.
- Useful error messages.
- A public page that documents installation and compatibility.

### 7.3 Registry maintainer

A AgentCargo project maintainer responsible for abuse reports and registry health.

Needs:

- Publisher and release audit history.
- Quarantine and unquarantine controls.
- Name dispute and malicious-content workflows.
- Rate limits and observable publishing failures.

## 8. Core user journeys

### 8.1 Discover and install

1. The developer searches on the website or with `agentcargo search`.
2. Results show the publisher, description, supported hosts, latest version, script presence, and scan status.
3. The developer opens `agentcargo inspect` to see files, permissions declared by the author, observed findings, checksum, source commit, and publication time.
4. The developer runs `agentcargo add @publisher/name --agent codex --scope project`.
5. The CLI resolves a version, downloads the immutable artifact, verifies its checksum, revalidates its structure, and displays material warnings.
6. The Codex adapter installs the skill atomically in the project skill directory.
7. The CLI updates `agentcargo.lock` and reports the installed location.

### 8.2 Publish a skill

1. The creator runs `agentcargo init` in a skill directory or adds `agentcargo.yaml` to an existing skill.
2. `agentcargo validate` checks required files, metadata, archive safety, and compatibility declarations.
3. The creator signs in through GitHub and claims a personal namespace.
4. `agentcargo publish` builds a deterministic archive and submits its metadata, source commit, checksum, and files.
5. The registry runs server-side validation and static rules.
6. If blocking checks pass, the release becomes installable. Non-blocking findings remain visible.
7. Reusing the same namespace, name, and version is rejected even if the previous release is quarantined.

### 8.3 Update safely

1. `agentcargo update --dry-run` compares installed versions with compatible releases.
2. The CLI displays version changes, file additions/removals, manifest changes, script changes, permission declaration changes, and new findings.
3. The user explicitly applies the update.
4. The CLI downloads and verifies the artifact, stages it, atomically replaces the managed package, and updates the lockfile.
5. If installation fails before commit, the old version remains active.

### 8.4 Remove and recover

1. `agentcargo remove @publisher/name --agent codex` reads installation ownership from the lockfile.
2. It removes the managed skill directory only if the current contents match known managed state, unless the user explicitly confirms removal of local modifications.
3. The lockfile is updated atomically.
4. A failed update can be reversed with `agentcargo rollback @publisher/name` when a previous artifact is still available.

## 9. Product surfaces

### 9.1 Public website

P0 pages:

- Home and search.
- Search results.
- Skill detail and version history.
- Publisher profile.
- Sign-in and namespace setup.
- Publish instructions.
- Report-content form.

Each skill detail page must display:

- Scoped package name.
- Plain-language description.
- Publisher identity and source repository.
- Latest stable version and release time.
- Compatible hosts and scopes.
- License.
- Package digest and source commit.
- Full file list with sizes and classifications.
- Whether executable/script-like content is present.
- Declared capabilities or permissions.
- Observed findings with evidence.
- Scanner version and scan time.
- Installation command.
- Version history and quarantine state.

### 9.2 CLI

P0 commands:

```text
agentcargo auth login
agentcargo auth logout
agentcargo init
agentcargo validate [path]
agentcargo scan [path]
agentcargo pack [path] [--output <file>]
agentcargo publish [path]
agentcargo search <query>
agentcargo inspect <package>[@version]
agentcargo add <package>[@version]|<local-path> --agent <host> --scope <project|user>
agentcargo list [--agent <host>]
agentcargo update [package] [--dry-run]
agentcargo remove <package> --agent <host>
agentcargo audit
agentcargo doctor
agentcargo rollback <package> --agent <host>
```

CLI requirements:

- Commands must support human-readable output and `--json` where automation is reasonable.
- Destructive or permission-expanding changes must require confirmation unless `--yes` is provided.
- CI mode must never open a browser or wait for interactive input.
- Errors must include a stable error code and a suggested next action.
- Tokens must be stored through the operating system's secure credential store when available.
- The CLI must never print authentication tokens.
- Telemetry is off by default in the MVP.

### 9.3 Registry API

The website and CLI use a versioned public API. Anonymous users may search, inspect, and download non-quarantined public releases. Authentication is required to publish, manage namespaces, or report abuse at higher rate limits.

## 10. Functional requirements

### P0: Identity and namespaces

- GitHub OAuth is the initial identity provider.
- A user receives a unique personal namespace.
- Package coordinates use `@namespace/name`.
- Package names are lowercase ASCII with hyphens and are immutable after first publication.
- Namespace and package ownership changes create audit events.
- Protected names and impersonation reports can be reviewed by maintainers.

### P0: Package validation

- A package must contain exactly one root `SKILL.md`.
- `SKILL.md` must contain valid front matter with at least `name` and `description`.
- The package name and skill metadata name must match after documented normalization.
- `agentcargo.yaml` is required for publication but is not copied into host-specific metadata unless the adapter chooses to preserve it.
- Paths must be relative, normalized UTF-8 paths.
- Absolute paths, traversal segments, device files, sockets, and hard links are rejected.
- Symlinks are rejected in registry artifacts for the MVP.
- Unpacked file count and byte-size limits are enforced.
- Every artifact receives a SHA-256 digest.

### P0: Versioning

- Versions follow semantic versioning.
- Published versions are immutable and cannot be reused.
- A release may be active, deprecated, or quarantined.
- Deprecation warns users but does not block an explicitly selected version.
- Quarantine blocks new installation unless a future maintainer-only recovery mechanism is used.
- The registry retains metadata and audit history for removed or quarantined content.

### P0: Compatibility

- Compatibility is declared per host in `agentcargo.yaml`.
- A declaration is labelled `publisher declared` until validated by an adapter test.
- The CLI refuses an unsupported host by default and allows an explicit experimental override only if the adapter can safely install it.
- Adapter versions are recorded in scan and installation metadata.
- Local-path installation requires the package to explicitly declare the selected host and scope; publisher compatibility remains a declaration rather than an AgentCargo-enforced sandbox.

### P0: Search

- Search covers package name, description, tags, publisher, and supported host.
- Filters include host, scripts present/absent, license, and scan state.
- Exact package-name matches rank above fuzzy text matches.
- Quarantined releases and packages with no active release are excluded from normal results.
- Download counts are not presented as proof of quality.

### P0: Trust evidence

The UI must separate:

- **Declared:** permissions, capabilities, dependencies, and compatibility supplied by the publisher.
- **Observed:** file types, scripts, suspicious patterns, network references, environment-variable references, and validation results detected by AgentCargo.
- **Enforced:** restrictions that the selected host demonstrably enforces. AgentCargo must say `not enforced by AgentCargo` when it cannot establish enforcement.

Every finding includes:

- Rule identifier and rule version.
- Severity: informational, low, medium, high, or blocking.
- Affected path and bounded evidence.
- Explanation and remediation guidance.
- Scan timestamp.

### P0: Moderation

- Authenticated users can report a package or release.
- Maintainers can quarantine a release immediately.
- All moderation actions create append-only audit events.
- A quarantined release remains addressable in audit history but is not downloadable through normal public endpoints.
- The registry must support an emergency digest denylist consumed by recent CLI versions.

### P1: Web authoring

- A guided editor may create instruction-only skills.
- The editor must preview the generated files and permit export to GitHub.
- Script upload and execution are excluded until a separate sandbox design exists.

## 11. Package metadata

An initial `agentcargo.yaml` example:

```yaml
schema_version: 1
name: react-review
version: 0.1.0
description: Reviews React changes for correctness, accessibility, and maintainability.
license: MIT
repository: https://github.com/acme/react-review

compatibility:
  codex:
    scopes: [project, user]
  claude-code:
    scopes: [project, user]

capabilities:
  filesystem:
    read: true
    write: false
  shell: false
  network: false
  environment: []

# Descriptive runtime requirements; AgentCargo does not install or resolve them.
dependencies: [git>=2.40, node>=22]

tags: [react, review, accessibility]
```

These capabilities are declarations, not a portable sandbox policy. The registry and CLI must not describe them as enforced unless a host adapter supplies verifiable enforcement evidence.

## 12. Success metrics

### Activation funnel

- Search-to-detail conversion.
- Detail-to-install-command copy or CLI install initiation.
- Successful installs divided by install attempts.
- Percentage of new CLI users completing one install.
- Successful publications divided by publish attempts.

### Reliability

- At least 95% successful installation for supported host/scope/OS combinations in the compatibility test matrix.
- At least 99% of downloads pass checksum verification; any lower value triggers an incident investigation.
- No known path traversal, arbitrary overwrite, or token exposure vulnerability at public beta launch.
- Median registry metadata request under 500 ms, excluding artifact download.

### Adoption targets for public beta

- 20 useful, manually reviewed seed skills.
- 10 external creators who successfully publish without maintainer intervention.
- 100 successful installs by users outside the core project team.
- At least one community-contributed or independently maintained adapter or validation rule.

These are learning targets rather than investor-style vanity metrics.

## 13. Launch acceptance criteria

The MVP is ready for public beta only when:

- All P0 journeys work end to end on macOS, Linux, and Windows for the supported test matrix.
- Both initial adapters pass fixture-based and real-host installation tests.
- Interrupted installation cannot leave a partially active managed skill.
- Update preview detects file, script, capability, and version changes.
- Archive extraction is covered by malicious-archive tests.
- Packages are immutable and their digest is verified by both registry and CLI.
- Quarantine prevents new downloads within the documented propagation time.
- The trust UI has been reviewed to remove unsupported security claims.
- Documentation includes installation, publishing, threat model, reporting, and removal.

## 14. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Marketplace cold start | Seed a small curated catalog and make GitHub import easy. |
| Vendor formats change | Keep all host behavior in versioned adapters with contract tests. |
| Malicious or compromised publisher | Immutable releases, identity history, scans, quarantine, digest denylist, and update diffs. |
| Prompt instructions hide dangerous behavior | Treat instruction content as untrusted, show evidence, and avoid claiming static scans guarantee safety. |
| Arbitrary code in scripts | Never execute community scripts in MVP infrastructure; label and inspect them statically. |
| Typosquatting | Scoped names, similarity warnings, protected namespaces, and moderation. |
| Free hosting becomes expensive | Enforce artifact limits, cache public downloads, use PostgreSQL search initially, and avoid model-based scans. |
| Low repeat usage | Measure installs and updates, interview activated users, and prioritize team lockfile workflows. |
| Official vendor marketplace competition | Focus on cross-agent portability, local CLI transparency, and an open adapter ecosystem. |

## 15. Decisions made for MVP

- The product is free to use.
- The CLI, specification, adapters, scanner rules, and public API contracts are open source under Apache License 2.0.
- The registry is a hosted public service and may remain separately deployed.
- The package format wraps existing skills rather than replacing their native format.
- Codex is the first adapter; Claude Code is the selected second adapter based on the dated comparison and verified host contract in ADR 0005.
- Project installations vendor host-ready files beneath the host's project skill root; they do not use symlinks or a central content cache in the MVP.
- Only static analysis is performed server-side.
- Trust is communicated as evidence and findings, not a composite score.
- The initial system is a modular monolith, not microservices.

## 16. Open product questions

These questions do not block initial repository setup but must be resolved before public beta:

- Should project installations commit the full skill, a pointer, or both?
- Should anonymous aggregate download counts be displayed at all?
- What package and artifact size limits balance useful assets with affordable hosting?
- Which licenses are accepted, and how should missing licenses be presented?
- What is the appeal process for package quarantine and namespace disputes?
