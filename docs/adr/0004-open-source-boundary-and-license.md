# ADR 0004: Open-Source Boundary and License

- Status: Accepted
- Date: 2026-08-13
- Decision owners: AgentCargo maintainers

## Context

AgentCargo asks users to install untrusted packages into agent-owned filesystem locations. Its package formats, verification logic, adapter behavior, scanner findings, and ownership rules must be inspectable and independently implementable. An open adapter ecosystem is also central to proving cross-agent portability.

The hosted registry may need operational code, abuse controls, deployment configuration, and credentials that are not required to implement a compatible client or registry. The source boundary must not be confused with the public service's anonymous-read product promise.

The public repository previously had no license, so outside users had no general permission to use, modify, or redistribute its contents.

## Decision

The contents of this public repository are licensed under the Apache License, Version 2.0, using SPDX identifier `Apache-2.0`.

Apache-2.0 is selected because it is permissive while including an explicit patent grant and contribution terms suitable for a package-manager and adapter ecosystem. Its trademark clause also keeps copyright permission separate from rights in the provisional AgentCargo name.

The public, versioned surface includes:

- The CLI and reusable core libraries.
- Artifact, manifest, and lockfile specifications and fixtures.
- Adapter contracts and first-party adapters.
- Validation and static-scanner rules, rule identifiers, and evidence formats.
- Public API contracts and generated or handwritten clients.
- Example skills and contributor documentation created by this project.

The following may be implemented or deployed separately and are not required to be published merely because they interoperate with the public contracts:

- Hosted registry, website, worker, moderation-console, and operations implementations.
- Deployment configuration, credentials, incident material, and provider-specific infrastructure.
- Private detection intelligence whose disclosure would create an active abuse risk, provided public findings still identify the applicable public rule and limitations accurately.

If hosted implementation source is added to this Apache-licensed repository, it is covered by the repository license unless an explicit, legally reviewed exception says otherwise. A separately licensed or private hosted implementation should live in a clearly separate repository or distribution. Regardless of implementation license, public clients must be able to rely on the versioned API, package, digest, and finding contracts.

Skills published through AgentCargo remain under their publishers' declared licenses. The AgentCargo repository license does not relicense package contents, third-party dependencies, vendor products, or third-party trademarks.

Contributions use Apache-2.0's inbound-equals-outbound terms. No contributor license agreement or developer certificate of origin is required initially; maintainers may revisit this before accepting contributions from legal entities with additional requirements.

## Consequences

Benefits:

- Users can inspect, fork, redistribute, and independently verify the trust-critical client surface.
- The explicit patent grant reduces ambiguity for contributors and downstream adapters.
- Alternative registries can implement the public contracts without copying private service operations.

Tradeoffs:

- Proprietary hosted source cannot be casually mixed into this repository.
- License and attribution compliance becomes part of release engineering.
- Public rules can reveal some defensive behavior, so high-risk operational intelligence needs a separate disclosure policy.
