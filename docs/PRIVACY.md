# AgentCargo privacy notice

_Implementation notice for the MVP; reviewed 2026-08-20._

This document describes the data flows implemented in the open AgentCargo
repository. A hosted registry operator must adapt it to the deployment's legal
entity, jurisdictions, contact address, subprocessors, and applicable law
before inviting external users. It is not legal advice.

## What AgentCargo does

AgentCargo publishes, catalogs, validates, scans, and distributes reusable
agent skills. Anonymous users can browse public metadata, inspect releases,
and install public releases through the CLI. GitHub authentication is required
for publisher and maintainer actions. The registry does not execute uploaded
skill files; static scanning observes them and the selected host executes an
installed skill under that host's rules.

## Data categories and purposes

| Data | Why it is processed | Where it is exposed |
| --- | --- | --- |
| Public package metadata, immutable artifacts, SHA-256 digests, compatibility declarations, scanner findings, and release state | Catalog search, inspection, integrity verification, installation, moderation, and release history | Public catalog/API unless a release is deprecated, quarantined, or denylisted |
| GitHub provider subject and optional login, namespace ownership, and publisher actions | Authenticate a publisher, authorize namespace mutations, attribute moderation events, and show an owner-scoped workspace | Provider boundary, registry authorization/audit records, and the authenticated publisher view; not anonymous browser responses |
| Short-lived AgentCargo session digest, scopes, expiry, and revocation state | Authorize a bounded publisher request and revoke access | Registry session store; the browser receives only an opaque HttpOnly cookie and token-free session metadata |
| Reports, bounded evidence, request IDs, moderation decisions, scanner observations, and operational counters | Abuse handling, incident response, release safety, and service operation | Maintainer/operator views according to deployment access policy; public status contains only bounded component signals |
| Request, rate-limit, and deployment logs | Reliability, abuse prevention, debugging, and security investigations | The hosting deployment's log systems, subject to its configured retention |

Provider access/refresh tokens stay at the credential or provider-broker
boundary. They are not written to lockfiles, package artifacts, browser JSON
responses, or status pages. Local CLI credential storage is controlled by the
user's operating system and is removed by `agentcargo auth logout`.

The browser skill builder creates a reviewable local draft. It does not upload
the draft or install files. See [data retention](RETENTION.md) for lifecycle
defaults and deployment responsibilities.

## Sharing and disclosure

AgentCargo shares data only as needed to provide the selected flow: the chosen
identity provider verifies publisher identity; the registry database and
object storage retain registry records and immutable artifacts; and authorized
maintainers operate moderation and incident controls. A deployment may use an
edge proxy, log service, database provider, or object-storage provider, each of
which must be documented by that deployment.

Public releases are intentionally public. Do not publish secrets, personal
data, or confidential source in a skill package. A maintainer may hide a
release through quarantine or digest denylisting, but immutable release and
audit records are not silently rewritten.

## Choices and requests

You may browse without an account. Publishers may request correction of an
identity or namespace record through the hosted deployment's support channel.
Requests to remove a public release must account for immutable digest and
moderation history requirements; the normal controls are deprecation,
quarantine, or denylisting rather than rewriting history. The deployment must
publish its contact and response process before public beta.

## Security boundaries

The implementation uses scoped sessions, token-free introspection, no-store
responses for authenticated mutations, bounded input validation, digest
verification, and static scanning. These controls reduce risk but do not make a
skill safe or prevent a selected host from executing harmful instructions.
Report vulnerabilities using [SECURITY.md](../SECURITY.md), not a public
package description.

## Deployment checklist

Before public beta, the operator must name the data controller/operator,
publish contact and jurisdiction information, list subprocessors, configure
log and evidence retention, provide an account/rights request path, and review
cookie, consent, cross-border, and deletion requirements with qualified counsel.
