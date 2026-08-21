# AgentCargo data retention

_MVP retention policy; reviewed 2026-08-20._

This policy distinguishes immutable registry history from operational data
that can be expired. The repository provides bounded fields, expiry checks, and
safe state transitions; a hosted deployment still has to configure storage,
backup, log, and deletion schedules and publish its legal retention periods.

## Retention matrix

| Record | MVP handling | Retention decision |
| --- | --- | --- |
| Public package metadata, release identity, artifact bytes, digest, and immutable version state | Content-addressed and retained for public inspection, installation, integrity, and moderation history; deprecation/quarantine changes visibility, not identity | Retain while the registry offers the release; a deployment must document archival/removal exceptions |
| Scanner findings and validation evidence | Stored with the release and tagged with rule/version and scan time | Retain with the corresponding release so trust evidence is reproducible |
| Reports and bounded evidence | Durable moderation record with status and timestamps; evidence is bounded and must not contain secrets | Retain through resolution and the deployment's documented abuse/audit period; no silent mutation |
| Moderation audit events and denylist changes | Append-only, attributable events used for incident response and release integrity | Retain for the deployment's security/audit period; publish the period before public beta |
| AgentCargo registry sessions | Opaque digests with scopes, expiry, and revocation; expired sessions are rejected and may be evicted | Retain only until expiry/revocation plus the short operational cleanup window |
| GitHub OAuth callback state | One-time, redirect-bound transient state | Delete or make unusable after completion, expiry, or replay detection |
| Local CLI credentials | Stored on the user's machine in the permission-restricted credential store; never in lockfiles or artifacts | Until logout, replacement, expiry, or user removal; the user controls backups |
| Scan jobs and worker leases | Durable while queued/running/retrying; stale leases are recoverable and status counters are operational | Remove/compact completed history according to deployment operations and audit needs |
| Request, rate-limit, worker, and web logs | Deployment-controlled operational telemetry; status responses contain bounded summaries only | Use the shortest period that supports abuse response, reliability, and security investigations |
| Browser builder drafts and local installations | Drafts stay in the browser; installed files and lockfiles stay in the user's project/home scope | User-controlled; AgentCargo does not upload or remotely retain them by default |

## Deletion and visibility

Public releases are immutable by design. A publisher can deprecate an owned
release, and an authorized maintainer can quarantine or denylist a release when
policy or safety requires it. Those controls remove public visibility or block
resolution without rewriting the digest, release identity, or audit trail.

Identity or account requests must be handled by the hosted deployment and may
need to preserve namespace ownership, moderation, fraud-prevention, and legal
records. The deployment must provide a contact path, verify requesters, state
which records can be deleted, and explain any required exceptions.

## Operator obligations

Before public beta, the operator must configure database/object-storage backup
and deletion schedules, log and telemetry expiry, report/evidence review,
session cleanup, incident holds, and regional/legal requirements. Retention
changes must be reviewed with the privacy notice and recorded in deployment
documentation; they must not weaken immutable digest verification or audit
integrity.
