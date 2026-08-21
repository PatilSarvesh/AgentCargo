# ADR 0007: Reproducible signed CLI release bundle

- Status: Accepted
- Date: 2026-08-20
- Decision owners: AgentCargo maintainers

## Context

The public-beta CLI must be independently verifiable across supported platforms. A platform archive command can inherit local timestamps, ownership, ordering, and implementation details, while an unsigned checksum does not authenticate the release metadata that users are asked to trust. The workspace also contains several first-party runtime packages that the CLI imports, so a release record needs to identify the complete built set rather than only `packages/cli`.

## Decision

The repository produces a signed CLI release bundle with `scripts/release-cli.mjs` and the root `pnpm release:cli` command.

- The bundle is an uncompressed, deterministic USTAR stream named `agentcargo-cli-<version>.tar` and uses format identifier `agentcargo-cli-ustar-v1`.
- The bundle contains the built CLI and its first-party `@agentcargo/*` runtime dependencies, their manifests, the lockfile, the license, and the root README. Entries are sorted by unsigned UTF-8 path bytes; modes, ownership, and timestamps are normalized.
- A canonical JSON manifest records the source commit, runtime requirements, package set, every bundled file's byte count/mode/SHA-256, and the archive digest. The manifest has no generated timestamp, so identical inputs produce identical bytes.
- The manifest is signed with an Ed25519 private key supplied at release time. The detached signature is a separate JSON envelope with a key identifier; private keys never enter the repository, archive, logs, or CLI arguments beyond the protected release job's file path.
- `node scripts/release-cli.mjs verify` verifies the Ed25519 signature and the archive digest/byte count using a separately distributed public key.
- The checked-in GitHub workflow is manual/tag-driven and fails closed until the protected `AGENTCARGO_CLI_RELEASE_PRIVATE_KEY` secret is configured. Publishing package names to an external package registry and hardware-backed key custody remain follow-up deployment decisions.

This bundle is a signed build/provenance artifact. It does not silently install a CLI, execute package files, or replace the AgentCargo skill-artifact format `agentcargo-ustar-v1`.

## Consequences

Maintainers can reproduce and verify a release without trusting a host-specific `tar` implementation, and operators have a clear place to publish checksums, signatures, and the public key. A release still needs protected key rotation, public-key distribution, and an eventual package-registry channel before it becomes a general end-user installer.
