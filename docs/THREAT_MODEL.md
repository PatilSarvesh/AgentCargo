# AgentCargo Threat Model

- Status: Initial Milestone 1 model
- Last reviewed: 2026-08-13
- Scope: local skill validation, canonical artifacts, Codex installation, lockfiles, inspection, removal, and diagnostics

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
- Successful historical update and rollback are not implemented yet.

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
- A user can intentionally edit receipts and accept the consequences; future audit can compare registry metadata when online.

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

### 6.7 Skill instructions and host execution

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

Direct GitHub repository access is not part of MVP identity and therefore is outside the current local threat surface.

### 6.9 AgentCargo supply chain

Required controls include pinned lockfile-based installs, deny-by-default dependency build scripts, dependency review, repository secret scanning, protected release workflows, signed release artifacts, provenance, and multi-factor authentication for maintainers. The current workspace permits only explicitly reviewed dependency build scripts, but public release signing and provenance are pending.

## 7. Diagnostics and recovery

`agentcargo doctor` is read-only in Milestone 1. It reports:

- Host-path health failures.
- Invalid lockfiles and invalid managed destinations.
- Clean, modified, missing, or invalid installation state.
- Active, stale, or malformed scope operation locks.
- Abandoned install and removal staging paths.

It does not automatically delete a lock, staging directory, or preserved local file. Recovery automation must first define ownership proof, user confirmation, and rollback behavior for each interruption point.

## 8. Verification expectations

Security-relevant changes require tests proportional to the boundary changed. The current suite covers deterministic digest vectors, malicious archive headers and paths, links and special files, expansion limits, destination containment, lockfile validation, installation rollback, drift classification, forced preservation of untracked files, invalid-link refusal, stale locks, and abandoned stages across the configured operating-system and Node.js CI matrix.

Before a public beta, AgentCargo also needs archive/parser fuzzing, a focused external review of artifact and filesystem transactions, hosted authentication and authorization tests, dependency/release provenance checks, and an incident-response exercise.

## 9. Reporting and review cadence

A public security policy and private reporting channel must be added before external distribution. Revisit this model when any of these boundaries changes:

- A second host adapter is added.
- Remote registry installation is implemented.
- Authentication or publishing launches.
- Scanner rules begin blocking or quarantining content.
- Update or rollback mutates existing installations.
- Private packages or organization policy are introduced.
