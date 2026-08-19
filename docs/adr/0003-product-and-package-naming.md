# ADR 0003: Product and Package Naming

- Status: Accepted
- Date: 2026-08-13
- Decision owners: AgentCargo maintainers

## Context

The project needs names that are consistent across user commands, registry metadata, lockfiles, package coordinates, source packages, and documentation. Earlier planning used `SkillHub`, which is too generic and survives in some historical local paths. A durable convention is required before public collaboration and package publication.

The `AgentCargo` name has passed only a preliminary collision search. Domain, npm, GitHub organization, trademark, and legal clearance remain incomplete.

## Decision

- The working product and brand name is `AgentCargo`.
- Prose uses `AgentCargo`; machine identifiers use lowercase `agentcargo`.
- The CLI executable is `agentcargo`.
- Publisher metadata is stored in `agentcargo.yaml`.
- Installation ownership is stored in `agentcargo.lock`, currently schema version 1.
- Registry coordinates use `@namespace/name@version`; local, unpublished installations may use the unscoped native skill name in receipts and commands.
- First-party npm packages use the `@agentcargo/` scope, subject to registry availability before publication.
- Host adapters use `@agentcargo/adapter-<host-id>`, where the host identifier is lowercase ASCII with single hyphens.
- Artifact files use the `.agentcargo` extension. The versioned wire format is named separately from the product and is currently `agentcargo-ustar-v1`.
- New references to `SkillHub` are defects unless they describe repository history. Local checkout directory names have no product meaning.

Public-facing use of the name remains provisional until clearance is complete. A future rename must preserve published package coordinates, manifest schema compatibility, or an explicit migration path.

## Consequences

Benefits:

- Documentation, code, and user commands share one vocabulary.
- Package and adapter names are predictable.
- Wire-format versioning is not coupled to a future brand change.

Tradeoffs:

- A failed clearance may still require a costly rename before public release.
- The desired npm scope and organization names may not be available.
- Historical commits and developer checkout paths may retain the former name.
