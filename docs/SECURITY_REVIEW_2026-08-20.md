# Focused security review — 2026-08-20

## Scope

This review covers the Milestone 5 moderation and abuse-control boundaries:

- bounded reports and append-only moderation audit events;
- publisher deprecation and maintainer quarantine/restoration;
- emergency SHA-256 digest denylisting;
- public package/search/exact-release filtering;
- worker activation and artifact verification;
- API rate limiting and failure behavior.

The review used the current threat model, contract validators, OpenAPI document,
PostgreSQL repositories/migrations, in-memory test doubles, Fastify routes, and
worker boundary. Uploaded skill content was not executed.

## Finding fixed during review

### Worker denylist dependency could be omitted

The worker and PostgreSQL scan repository previously accepted an optional
denylist reader. A misconfigured production composition could therefore reach
activation without checking the emergency digest denylist.

Resolution:

- `RegistryReleaseWorker` now requires a denylist reader at construction and
  refuses to start without one.
- `PostgresRegistryReleaseScanRepository` now requires the same boundary before
  activation is available.
- A denylist-reader failure stops processing before download/activation and
  leaves the durable job retryable; it is never treated as "not denylisted."
- Regression tests cover missing configuration, an active denylist entry, and a
  denylist backend outage.

## Review results

| Boundary | Result | Evidence |
| --- | --- | --- |
| Report validation and replay | Pass | bounded evidence/metadata validation, publisher-scoped idempotency, conflict tests |
| Audit immutability | Pass | append-only trigger migration, event mapping, maintainer-only reads |
| Release moderation | Pass | role/scope checks, ownership checks, guarded transitions, replay/conflict tests |
| Denylist mutation | Pass | normalized SHA-256 validation, maintainer role, idempotent add/remove, audit events |
| Public filtering | Pass | active/deprecated-only reads plus quarantined and denylisted digest exclusion |
| Worker activation | Pass after fix | required denylist dependency, pre-download check, outage/fail-closed tests |
| Rate limiting | Pass | bounded fixed-window state, route-aware keys, stable `429`, retry headers, generic `503` failure |
| Secret exposure | Pass | error responses redact backend details; audit metadata excludes evidence and credentials |

## Residual risks and follow-up

- Public read responses have short cache lifetimes. An emergency response must
  purge or wait out an already-served cache entry; the runbook does not claim
  that a remote cache can be invalidated automatically.
- The default rate limiter is process-local. A multi-instance deployment must
  inject shared limiter state before relying on quotas operationally.
- Hosted browser publication and the production worker scheduler still require
  deployment-specific authentication, scheduling, observability, and recovery
  review.

## Verification

```text
pnpm --filter @agentcargo/registry-worker test  PASS (5 tests)
pnpm --filter @agentcargo/registry-db test      PASS (32 tests)
pnpm --filter @agentcargo/registry-api test     PASS (32 tests)
node --test apps/web/tests/port-config.test.mjs PASS (3 tests)
git diff --check                              PASS
```

No high-severity untriaged finding remains in the reviewed Milestone 5
moderation/abuse-control slice. The residual risks above are deployment or
operational follow-ups, not silently enforced product guarantees.
