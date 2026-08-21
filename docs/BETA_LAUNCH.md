# Controlled public-beta launch handoff

This handoff turns the repository's completed implementation into an explicit
operator sequence. It does not provision infrastructure or claim that a local
build is a hosted release. The machine-readable source of truth is
[`BETA_READINESS.json`](BETA_READINESS.json); the verifier reports repository
gates separately from deployment and external-user gates.

## Start with the repository gate

From a clean checkout, run:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm check:migrations
pnpm test:migrations
pnpm check:beta
pnpm test:beta
```

`pnpm check:beta` must report all six repository gates as `READY`. Its normal
exit status remains successful while deployment/external gates are pending;
`--strict` fails when a repository gate is missing, which is the mode used by
CI. The verifier checks paths, root package scripts, and matching verification
evidence in `docs/STATUS.md`; it never checks secrets or calls a hosted service.

`pnpm check:migrations` is a repository-only preflight. It verifies that the
checked-in PostgreSQL migrations have safe numbered filenames, no gaps or
duplicate numbers, and no destructive SQL beyond idempotent trigger/constraint
drops. It reports migration digests and the latest checked-in version, but it
does not connect to PostgreSQL or claim that any deployment has applied them.

The anonymous CLI status view is available for operator checks and automation:

```bash
AGENTCARGO_REGISTRY_URL=https://registry.example.test agentcargo status
AGENTCARGO_REGISTRY_URL=https://registry.example.test agentcargo status --json
```

`agentcargo status` reports the bounded `/v1/status` response. A degraded
registry remains a successful command with an explicit degraded payload; an
outage, transport failure, or invalid response exits non-zero. It never prints
package contents, credentials, or raw infrastructure errors.

## Deployment sequence

Complete these gates in order and record the evidence next to the deployment
change or incident record.

1. **Provision durable services.** Create PostgreSQL with point-in-time
   recovery, apply every checked-in migration through
   `packages/registry-db/migrations/0010_digest_denylist.sql`, and provision a
   private S3-compatible bucket with immutable, digest-addressed objects. Run
   the opt-in integration harness against the target-compatible services.
2. **Compose the API and worker.** Inject short, bounded database, object-store,
   moderation, and scheduler probes as described in
   [`OPERATIONS.md`](OPERATIONS.md). Run one `RegistryReleaseWorkerScheduler`
   process with lease-aware shutdown; publish only sanitized readiness and
   queue counters through the hosting health path.
3. **Configure the web bridge.** Set the server-only
   `AGENTCARGO_REGISTRY_URL`, `AGENTCARGO_WEB_PROVIDER_BROKER_URL`, and
   `AGENTCARGO_WEB_PROVIDER_BROKER_TOKEN` values documented in
   [`apps/web/README.md`](../apps/web/README.md). The broker must accept only
   authenticated server-to-server requests, return a provider credential for
   the current workspace user, and never expose it to browser JSON.
4. **Exercise public status and recovery.** Verify `/v1/status` and `/status`
   in staging. Simulate a database outage, storage outage, worker lag, and
   moderation probe failure. Confirm required-boundary outages become
   `overall: "outage"`, optional failures become `degraded`, raw errors and
   package contents stay absent, and the incident procedure in
   [`INCIDENT_RUNBOOK.md`](INCIDENT_RUNBOOK.md) is usable.
5. **Route alerts.** Alert on sustained outage, worker `ready: false` for more
   than one interval, queue lag above the configured threshold, repeated
   consecutive failures, or stale leases that outlive the lease window. Route
   alerts to an on-call owner and perform one staged failure/recovery exercise
   before inviting external users.

## Release-key gate

The signed CLI workflow is reproducible, but it is not public-ready until
operators complete key custody and distribution:

1. Store `AGENTCARGO_CLI_RELEASE_PRIVATE_KEY` in a protected CI secret or an
   approved key service. Never commit it, put it in a lockfile, pass its
   contents as an argument, or print it.
2. Restrict `cli-v*` tag creation and manual workflow dispatch to maintainers.
3. Export the matching public key from the protected key in a controlled
   environment and record its SHA-256 fingerprint in the release notes. The
   fingerprint is an identifier, not a secret.
4. Publish the public key/fingerprint through a trusted release channel, then
   independently verify the uploaded archive and detached manifest signature
   with the public key. The exact command and output names are in
   [`RELEASE.md`](RELEASE.md).
5. Keep a rotation/revocation procedure and an offline recovery contact. A
   missing or compromised key blocks release; it does not justify bypassing
   signature verification.

## Policy and support gate

Before external access, fill the deployment-owned legal entity, jurisdiction,
privacy/support contacts, subprocessors, cookie/deletion process, and exact
log/report/backup retention periods. Review
[`PRIVACY.md`](PRIVACY.md), [`CONTENT_POLICY.md`](CONTENT_POLICY.md),
[`PLATFORM_SUPPORT.md`](PLATFORM_SUPPORT.md), and [`RETENTION.md`](RETENTION.md)
with qualified counsel. Do not change the implementation documents to imply a
hosted legal commitment that the deployment has not adopted.

## Handoff evidence

Record, at minimum:

- the commit and signed CLI artifact manifest/fingerprint;
- migration and integration-test output (without credentials or package data);
- the `/v1/status` staging response for healthy, degraded, and outage cases;
- alert delivery and incident-recovery timestamps;
- configured policy/contact/retention references; and
- the external creator/user cohort and feedback form version.

Update `docs/BETA_READINESS.json` only when the evidence exists. Keep
deployment-only and external-user gates marked as action items until their
owners complete them.
