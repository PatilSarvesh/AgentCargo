# AgentCargo Threat Model

- Status: Initial hosted-auth handoff model
- Last reviewed: 2026-08-15
- Scope: local skill validation, canonical artifacts, Codex/Claude Code installation, lockfiles, inspection, update, rollback, audit, removal, and diagnostics

## 1. Security goal

AgentCargo should install only the package bytes a user selected, write only beneath the destination authorized by the selected host and scope, and later remove only paths proven to be AgentCargo-owned.

The product promise is evidence and control, not a claim that community skills are completely safe. Static checks cannot prove that natural-language instructions or scripts are benign, and AgentCargo cannot enforce permissions that an AI-agent host does not enforce.

## 2. Assets to protect

- Files outside the selected project or user skill root.
- Existing unmanaged skills and local modifications.
- Package identity, version, artifact digest, and installed-file ownership receipts.
- Registry credentials and publisher identity when hosted services are added.
- Registry availability, audit history, immutable release metadata, and artifact bytes.
- Users' understanding of what is declared, observed, and enforced.

## 3. Trust boundaries

```text
Untrusted source directory
    -> native and AgentCargo validation
    -> canonical artifact bytes
    -> digest verification and safe extraction
    -> untrusted host adapter output
    -> constrained staging directory
    -> atomic activation
    -> untrusted local lockfile and installed tree
    -> inspection / removal
    -> AI-agent host runtime (outside AgentCargo enforcement)
```

For the future hosted registry, browser input, API requests, OAuth identity, uploaded artifacts, storage metadata, worker results, and rendered scanner evidence are separate trust boundaries.

## 4. Attacker and failure assumptions

- A skill author may deliberately create malicious paths, metadata, instructions, scripts, binaries, or oversized content.
- A local source directory, artifact, lockfile, or installed tree may change while AgentCargo reads it.
- A lockfile may be malformed or intentionally edited.
- Installation path components may be replaced with links or non-directories.
- AgentCargo may be interrupted between staging, activation, lockfile commit, and cleanup.
- Another AgentCargo process may target the same scope concurrently.
- The invoking operating-system user is trusted to control their own account. AgentCargo does not defend against an administrator or a same-user process that continuously races every filesystem operation.
- A valid GitHub identity will prove account control, not package safety.
- Dependencies or the AgentCargo build/release process may be compromised.

## 5. Local security invariants

The local implementation is designed around these invariants:

1. Validation, packing, registry scanning, and installation never execute package scripts.
2. Canonical artifacts contain regular files only and reject links, special files, unsafe paths, case collisions, and configured expansion-limit violations.
3. The exact artifact bytes are SHA-256 verified before extraction and reverified after extraction.
4. Host-specific paths originate in a versioned adapter, then core independently proves containment beneath a canonical scope root.
5. Installation stages on the destination filesystem and activates a complete directory with atomic rename.
6. Lockfile writes use a flushed sibling file and atomic rename.
7. Every installed regular file receives a path, SHA-256 digest, byte count, and canonical mode receipt.
8. Inspection never follows installed links and reports missing, modified, untracked, and invalid content separately.
9. Removal requires explicit CLI confirmation. Drift requires an additional force decision.
10. Forced removal still refuses linked, special, or invalid paths, unlinks only lockfile-owned file paths, and preserves untracked content.
11. Concurrent AgentCargo mutations in one scope are serialized by an exclusive operation lock.
12. Interrupted staging and stale locks are reported by `agentcargo doctor`; they are not deleted automatically.
13. Update, rollback, and audit never execute installed scripts; invalid installed paths are never followed.

## 6. Threats and controls

### 6.1 Malicious source trees and archives

Threats include traversal paths, absolute paths, Windows drive or UNC paths, links, device files, case aliases, archive bombs, malformed headers, unsafe permissions, and source replacement during packing.

Implemented controls:

- Root-relative NFC path normalization and cross-platform portable-name checks.
- Regular files only; links and special files are rejected.
- File-count, per-file, expanded-byte, and artifact-byte limits.
- Canonical USTAR headers with checksum and exact reconstruction verification.
- Exclusive output creation and refusal to overwrite an artifact.
- File identity, size, and timestamps are rechecked while source bytes are read.
- Extraction uses exclusive file creation beneath an explicit staging root.

Residual risk:

- Text or scripts can still be harmful when a host later uses them.
- Current size limits are engineering defaults and require product validation.
- Parser defects remain possible; fuzzing and external review are still needed.

### 6.2 Digest and artifact substitution

Threats include replacing an artifact after resolution, trusting storage metadata, or hashing a representation different from the installed bytes.

Implemented controls:

- SHA-256 covers the exact canonical artifact stream.
- Expected digest verification occurs before destination mutation.
- The artifact is reopened and reverified after extraction to detect replacement races.
- Lockfile receipts retain both the artifact digest and installed-file digests.

Future hosted controls:

- Immutable content-addressed storage, digest verification before and after storage, signed release metadata, and a digest denylist.

### 6.3 Adapter path escape or contract drift

Threats include a faulty or compromised adapter returning a destination outside the selected scope, host conventions changing, or generic core silently depending on a vendor path.

Implemented controls:

- Host paths live behind `@agentcargo/adapter-contract`.
- Core verifies adapter identity, scope, package, canonical scope root, relative destination, and path containment.
- Every created destination ancestor must be a real directory, not a link.
- The Codex adapter records its documentation URL, last verification date, and adapter version.

Residual risk:

- Host behavior can change after verification.
- AgentCargo cannot enforce the host's runtime sandbox or tool permissions.
- Third-party adapters will require contract tests, review guidance, and a distribution policy.

### 6.4 Existing files and installation transactions

Threats include overwriting an unmanaged skill, partial extraction, cross-filesystem rename, lockfile commit failure, and concurrent AgentCargo processes.

Implemented controls:

- Existing destinations are never replaced by local `add`.
- Extraction and adapter transformation finish in a sibling staging directory.
- Activation uses atomic rename on the destination filesystem.
- An exclusive scope operation lock serializes AgentCargo mutations.
- A failed lockfile commit renames an activated destination back to staging before cleanup.
- Temporary paths use exclusive creation and unpredictable suffixes.

Residual risk:

- Power loss and filesystem implementations can have durability semantics beyond Node's portable guarantees.
- A same-user adversary can attempt races outside AgentCargo's operation lock.
- A process or power loss between separate directory, lockfile, and rollback-sidecar commits can require manual inspection even though caught in-process failures are restored and recovery evidence is retained.

### 6.5 Lockfile tampering

Threats include malicious YAML, oversized input, links, duplicate identities, unsafe destinations, forged receipts, and concurrent mutation.

Implemented controls:

- A 1 MiB input limit, safe YAML parsing, exact fields, schema version validation, and normalized paths.
- Lockfiles must be regular files and are checked for identity and mutation while read.
- Package identities and per-file paths reject duplicates and case collisions.
- Lifecycle operations independently constrain lockfile destinations beneath the adapter's skill root.
- Writes use mode `0600`, flush, and atomic sibling replacement.

Residual risk:

- The lockfile is local user-controlled state, not a cryptographic authorization token.
- A user can intentionally edit receipts and accept the consequences. Local audit verifies host-ready receipt integrity; online registry comparison remains a future extension.

### 6.6 Drift-aware removal

Threats include deleting modified owned files, recursively deleting untracked content, following a malicious link, or committing the lockfile before a destination can be recovered.

Implemented controls:

- `list` recomputes owned-file digests, sizes, and canonical modes.
- Normal removal refuses missing, modified, untracked, linked, special, and invalid content.
- `--force` permits missing or modified state but does not permit invalid path types.
- Removal atomically moves the destination to a sibling staging name and reinspects it before lockfile commit.
- Cleanup unlinks only receipt-owned regular-file paths and prunes only empty owned parent directories.
- If untracked content remains, it is renamed back to the original destination and reported to the user.
- Empty lockfiles are removed with an atomic unlink; non-empty lockfiles use atomic replacement.
- A lockfile commit failure restores the original destination.

Residual risk:

- Cleanup interrupted after lockfile commit can leave an abandoned removal directory. `doctor` reports it for manual inspection.
- Automatic recovery is deliberately deferred until recovery choices and evidence retention are designed.

### 6.7 Update, rollback, and local audit

Threats include overwriting local modifications, accepting substituted update bytes, escaping the host root through retained backup metadata, losing the prior version after a metadata failure, following linked audit paths, or presenting recorded artifact identity as newly verified evidence.

Implemented controls:

- Registry update targets are downloaded and safely extracted with the immutable release digest, then deterministically repacked and digest-checked again in core before mutation.
- Update and rollback require clean active receipts and validate retained backup receipts before replacement.
- Both operations share the scope mutation lock, stage beneath the destination filesystem, and use atomic directory renames.
- Caught lockfile or rollback-state commit failures restore the prior active directory and lockfile; focused tests inject failures after activation.
- `.agentcargo-rollback.json` is size-limited, exact-schema, regular-file-only, written with mode `0600`, and stores contained portable backup paths plus validated previous/current lock entries.
- Rollback reverses the retained/current receipts, so a successful rollback remains reversible. Removal deletes retained content only through its verified receipt.
- Audit recomputes installed receipts without following links, scans only safely inventoried regular files, and skips static scanning when a destination is missing or invalid.
- Audit labels the source artifact digest as recorded because canonical artifact bytes are not retained locally; it reports installed receipt verification independently.

Residual risk:

- The filesystem cannot provide a portable multi-file transaction across the active directory, lockfile, and rollback sidecar. Abrupt termination can leave evidence that `doctor`/`audit` report for manual reconciliation.
- Local static rules are observations, not proof that host execution will be safe.
- A same-user process can race filesystem state outside the cooperative operation lock.

### 6.8 Skill instructions and host execution

Threats include prompt injection, destructive shell commands, credential access, network exfiltration, misleading capability declarations, and instructions that weaken host protections.

Controls and limits:

- AgentCargo records publisher declarations separately from observed static findings and documented host enforcement.
- Community files are never executed by AgentCargo infrastructure.
- Future scanner findings must include stable rule IDs, versions, bounded evidence, explanation, remediation, and scan time.
- `No finding` must never be presented as `safe`.

Residual risk:

- Static analysis cannot establish intent or prove safety.
- The selected AI-agent host decides whether and how instructions run and which tools are available.
- Users must review scripts, instructions, findings, and host permissions before use.

### 6.8 Hosted registry, identity, and web rendering

These controls are required before the corresponding hosted surfaces launch:

- GitHub OAuth with CSRF protection and secure session handling.
- Short-lived scoped CLI authentication and operating-system credential storage.
- Authorization checks for namespaces and immutable publication.
- Rate limits for authentication, publishing, search, and reporting.
- Output encoding and Content Security Policy for attacker-controlled metadata and findings.
- Private artifact storage with scoped URLs or a controlled download endpoint.
- Append-only security and moderation audit events without tokens or package contents.
- Quarantine and denylist propagation with documented timing.

Implemented auth-handoff controls:

- Registry credentials are keyed by a canonical HTTP(S) registry URL and validated as GitHub bearer credentials before storage.
- The local file backend creates a `0700` parent directory, writes credentials with `0600` permissions, and replaces the file atomically.
- `GitHubOAuthClient` uses PKCE for hosted authorization requests, supports GitHub device authorization for the CLI, revalidates `/user` identity after acquisition/refresh, and preserves rotated refresh-token metadata without printing token values.
- `agentcargo auth status` reports provider, expiry, and refresh availability only; `agentcargo auth login`, `agentcargo auth refresh`, and `agentcargo auth logout` never accept access/refresh tokens as command-line arguments or print them, and tokens are never written to lockfiles.
- The registry API's bearer boundary rejects malformed schemes, delegates credential verification to an injected provider/session adapter, and maps verifier failures to a generic unavailable error without returning provider details.
- The initial hosted session boundary exchanges a provider-verified bearer credential for a short-lived random opaque token, retains only its SHA-256 digest in memory, bounds its lifetime, supports revocation, and marks the session response `Cache-Control: no-store`.
- The PostgreSQL session adapter persists only the SHA-256 digest, normalized provider identity, issue/expiry timestamps, and revocation timestamp; its migration adds expiry indexing and never stores bearer token values.
- `GitHubHostedOAuthFlow` binds PKCE completion to one-time, redirect-bound callback state; the in-memory and PostgreSQL state adapters hash state values, expire records, and delete them on every consume attempt. `GitHubPublisherTokenVerifier` treats only GitHub HTTP 401 as an invalid credential and propagates network/provider failures for generic API outage handling.
- Hosted API callback routes allow redirects only to configured same-origin relative paths, set sessions as `Secure`, `HttpOnly`, `SameSite=Lax`, bounded-lifetime cookies, and never include provider or AgentCargo token values in redirect URLs or response bodies. Cookie publisher resolution rejects malformed or duplicate session cookies.
- Signed artifact upload URLs are digest- and byte-count-bound, use bounded expiries, and are issued only after release ownership is resolved. Completion checks the object-store head metadata against the declared SHA-256 digest, canonical media type, and byte count before durable completion state is recorded.
- Upload intent and completion metadata are stored separately from public release projections. Completion enters `scanning` state; worker validation must activate a release before anonymous read routes can expose it.
- Scan jobs use PostgreSQL uniqueness, short leases, `FOR UPDATE SKIP LOCKED`, attempt tracking, bounded error text, and retry timestamps. The worker rechecks the digest while extracting, rejects non-canonical archives, compares extracted manifest/file metadata with the completion request, and persists only bounded scan evidence.

Residual auth-handoff risk:

- The file backend is a permission-restricted fallback, not an OS keychain. Web-app composition, short-lived scope enforcement, expiry cleanup/eviction policy, platform keychain integration, authenticated publication, and explicit deployment composition remain pending; callback code verifiers require normal database encryption and access controls while resident. Worker activation is implemented behind an injected artifact fetcher and PostgreSQL projection boundary; production object-store fetch composition and operational worker scheduling remain deployment concerns.

Direct GitHub repository access is not part of MVP identity and therefore is outside the current local threat surface.

### 6.9 AgentCargo supply chain

Required controls include pinned lockfile-based installs, deny-by-default dependency build scripts, dependency review, repository secret scanning, protected release workflows, signed release artifacts, provenance, and multi-factor authentication for maintainers. The current workspace permits only explicitly reviewed dependency build scripts, but public release signing and provenance are pending.

## 7. Diagnostics and recovery

`agentcargo doctor` is read-only in Milestone 1. It reports:

- Host-path health failures.
- Invalid lockfiles and invalid managed destinations.
- Clean, modified, missing, or invalid installation state.
- Active, stale, or malformed scope operation locks.
- Abandoned install, removal, update, and unreferenced rollback staging paths.
- Invalid, missing, drifted, or lockfile-mismatched retained rollback state.

It does not automatically delete a lock, staging directory, or preserved local file. Recovery automation must first define ownership proof, user confirmation, and rollback behavior for each interruption point.

## 8. Verification expectations

Security-relevant changes require tests proportional to the boundary changed. The current suite covers deterministic digest vectors, malicious archive headers and paths, links and special files, expansion limits, destination containment, lockfile/rollback-state validation, installation and update failure recovery, reversible rollback, drift classification, forced preservation of untracked files, invalid-link refusal, no-follow audit scanning, stale locks, and abandoned stages across the configured operating-system and Node.js CI matrix.

Before a public beta, AgentCargo also needs archive/parser fuzzing, a focused external review of artifact and filesystem transactions, hosted authentication and authorization tests, dependency/release provenance checks, and an incident-response exercise.

## 9. Reporting and review cadence

A public security policy and private reporting channel must be added before external distribution. Revisit this model when any of these boundaries changes:

- A second host adapter is added.
- Remote registry installation is implemented.
- Authentication or publishing launches.
- Scanner rules begin blocking or quarantining content.
- Update/rollback recovery state or transaction ordering changes.
- Private packages or organization policy are introduced.
