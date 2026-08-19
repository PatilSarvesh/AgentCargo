# Security Policy

AgentCargo processes untrusted skill packages and performs local filesystem mutations. Please report security problems privately so users can be protected before technical details are public.

## Supported versions

AgentCargo is pre-release. Security fixes are made on the latest commit of `main`; no released version line is supported yet.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** form in the repository's Security tab once the public repository has private vulnerability reporting enabled. If that form is unavailable, contact a repository maintainer through an established private channel. Do not open a public issue for a suspected vulnerability.

Include, when possible:

- The affected command, package, version, or commit.
- A minimal reproduction or malicious fixture.
- The expected and observed filesystem or trust-boundary behavior.
- Potential impact and whether exploitation requires user confirmation.
- Any suggested remediation, without including real credentials or sensitive user data.

Maintainers will make a best effort to acknowledge a complete report within three business days and provide a status update within seven business days. Timelines for a fix and disclosure depend on severity, affected releases, and coordination needs.

## In scope

- Archive traversal, link, collision, replacement-race, or expansion-limit bypasses.
- Writes or removals outside a validated installation scope.
- Lockfile, operation-lock, staging, rollback, or ownership-receipt vulnerabilities.
- Digest-verification or immutable-artifact failures.
- Authentication, authorization, namespace, publication, quarantine, and denylist failures once those hosted components exist.
- Misleading trust evidence that could cause users to treat declared behavior as enforced.
- Credential exposure or execution of untrusted package content by AgentCargo infrastructure.

## Usually out of scope

- Harmful instructions that AgentCargo accurately presents as untrusted and does not execute.
- Runtime behavior of a third-party host unless AgentCargo misstates or bypasses that host's documented boundary.
- Denial of service that stays within documented package limits and has no durable impact.
- Social engineering, automated scanning of infrastructure, and reports without a reproducible security impact.

Please test only against systems and data you own or are authorized to use. Do not access other users' data, degrade services, or publish exploit details before maintainers have had a reasonable opportunity to respond.
