# AgentCargo Incident Runbook

This runbook is for registry maintainers and operators responding to a suspected malicious skill, compromised credential, artifact-integrity failure, or abusive API client. It describes containment and evidence preservation; it is not a substitute for the deployment's access-control, backup, or incident-response policy.

## Operating rules

1. Use a separate, audited maintainer session for every emergency mutation.
2. Never paste provider tokens, AgentCargo sessions, signed URLs, request bodies, or package contents into tickets, chat, or logs.
3. Record the UTC timestamp, request ID, coordinate/digest, actor, action, reason, and verification result for each step.
4. Prefer reversible state changes (denylist, quarantine, or rollback) before deleting data.
5. Preserve the append-only moderation audit event and relevant storage/database access logs before rotating or pruning evidence.

## 1. Malicious or compromised artifact

Use this path when a published release is reported as malicious, begins downloading unexpected content, or has a confirmed scanner/signature issue.

1. Identify the exact `@namespace/name@version` and canonical `sha256:` digest from the release record. Do not act on a mutable tag or filename alone.
2. Add the digest to the emergency denylist through the maintainer-only API. Use a unique idempotency key and a bounded reason that names the incident reference, not secret evidence.
3. Confirm `GET /v1/security/denylist` contains the digest and that the exact public release lookup returns `404`.
4. If the release is still visible through a stale cache, purge the cache or wait for its documented TTL; do not broaden the denylist to unrelated digests.
5. Quarantine the release when release-level history must remain visible to maintainers. Denylisting is the artifact-wide containment control; quarantine is the package/version visibility control.
6. Preserve the audit event, scanner findings, artifact metadata, and storage access records. Do not download or execute the skill during triage.

When the incident is resolved, remove the digest only after a maintainer-approved replacement artifact has a different digest and a completed validation/scan. Removing a denylist entry never rewrites the historical add event.

## 2. Release quarantine or restoration

Use quarantine when a release should be hidden from anonymous package, search, and exact-version reads while maintainers investigate.

- Quarantine requires a maintainer role and an idempotency key.
- Restoration uses `unquarantine` and returns the prior public status (`active` or `deprecated`); it does not silently publish a rejected or incomplete release.
- Verify the public exact-release, package, and search responses after either transition.
- If the release digest is also denylisted, removing quarantine does not make it publicly resolvable until the denylist decision is separately reversed.

## 3. Suspected provider or registry-token compromise

1. Revoke the provider credential and all active AgentCargo sessions using the identity provider and registry controls.
2. Rotate signing, storage, database, and host-broker credentials according to the deployment's secret-rotation procedure.
3. Review authentication, session-introspection, mutation, and moderation audit logs for the affected subject and time window.
4. Check release reservations, upload completions, moderation events, denylist mutations, and worker activation records created by the subject.
5. Keep provider credentials and bearer values out of incident artifacts. Store only subject IDs, timestamps, request IDs, and the resulting revocation/rotation status.
6. Require a fresh, least-privilege session before any remediation mutation.

## 4. Artifact-integrity or storage failure

1. Stop activation and publication completion if digest or object metadata verification is failing.
2. Check whether the failure is limited to one digest, one storage replica, or the storage service as a whole.
3. Keep the release in `scanning`/rejected state; never bypass digest verification to restore availability.
4. Compare the reserved digest, completion metadata, object metadata, and worker verification evidence. The exact artifact bytes are the authority.
5. If a digest is known compromised, use the malicious-artifact procedure above. If storage is merely unavailable, restore the service and replay the durable scan job under its lease/retry policy.
6. Record the failed verification and recovery evidence in the incident timeline.

## 5. Abuse and rate-limit response

The API applies route-aware fixed-window limits to authentication, search, reporting, publishing, and moderation paths. A blocked request returns `429 REGISTRY_RATE_LIMITED`, `Retry-After`, and `RateLimit-*` headers. A limiter dependency failure returns a generic `503` and mutation paths fail closed.

1. Confirm the route, source address as interpreted by the trusted server configuration, request IDs, and response code. Do not use an untrusted forwarded header as identity evidence.
2. Preserve a bounded sample of request IDs and timestamps; do not retain credentials or full package bodies.
3. If the process-local limiter is insufficient for a multi-instance deployment, switch to the deployment's shared `RegistryRateLimiter` implementation before raising limits.
4. Tighten the affected policy or block the abusive subject at the trusted edge, then verify legitimate traffic still receives the expected response.
5. Treat repeated limiter-backend failures as an availability incident; restore the limiter dependency rather than bypassing it for mutations.

The in-memory limiter is intentionally bounded and suitable for local/single-process operation. It is not a distributed quota or a durable abuse ledger.

## 6. Rollback and recovery

1. Prefer `agentcargo rollback` for a clean local installation with a validated retained receipt; do not force removal of modified files without explicit approval.
2. For registry releases, use quarantine/denylist containment first, then restore only after validation and scan evidence are complete.
3. Verify lockfile receipts, artifact digests, scanner findings, and audit events after recovery.
4. Preserve failed-operation staging paths and recovery receipts for `agentcargo doctor`; do not delete them while evidence collection is active.

## Verification checklist

Run the proportionate checks after remediation and attach their exit status to the incident record:

```bash
pnpm --filter @agentcargo/registry-contract test
pnpm --filter @agentcargo/registry-db test
pnpm --filter @agentcargo/registry-api test
pnpm --filter @agentcargo/registry-client test
pnpm --filter @agentcargo/registry-worker test
pnpm verify
```

The final incident record should state what was contained, which digest/coordinate was affected, which audit event IDs were preserved, whether public resolution is blocked, and what follow-up control or runbook change is required.
