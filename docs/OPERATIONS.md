# AgentCargo operational status

AgentCargo exposes a small public status surface for a controlled beta. It is intended for monitoring and user communication, not for debugging private infrastructure.

## Public endpoint and page

`GET /v1/status` returns a cacheable (`max-age=15`) `RegistryStatusResponse` with:

- overall `operational`, `degraded`, or `outage` state;
- API and database boundary status;
- artifact-storage configuration/health;
- worker readiness, bounded run counters, queue lag, failed jobs, and stale leases;
- moderation configuration and the count of active digest-denylist entries.

The response contains no package contents, signed URLs, credentials, raw dependency errors, or scan evidence. `api` and `database` are required boundaries: an unavailable signal from either produces `overall: "outage"`. Optional storage, worker, and moderation failures produce `overall: "degraded"` while anonymous reads can remain available.

The web app renders the same information at `/status` when `AGENTCARGO_REGISTRY_URL` is configured. Without that server-only setting it shows a deliberate “not connected” state; it never invents a healthy status from local demo data.

## Deployment composition

The API accepts status-source callbacks so deployments can connect real health checks without coupling the contract to PostgreSQL, S3, or the worker package. Each callback must return a bounded status and optional operator-safe detail. The worker package provides an adapter for scheduler readiness:

```ts
import { buildRegistryApp } from "@agentcargo/registry-api";
import { registryWorkerStatusSource } from "@agentcargo/registry-worker";

const app = buildRegistryApp({
  repository,
  artifactStorage,
  moderation,
  status: {
    database: async () => ({ status: "operational" }),
    storage: async () => ({ status: "operational" }),
    worker: async () => registryWorkerStatusSource(scanScheduler),
    moderation: async () => {
      const denylist = await moderation.listDenylistedDigests();
      return { status: "operational", activeDenylistEntries: denylist.items.length };
    },
  },
});
```

The database, object-store, and moderation callbacks should use short bounded probes appropriate to the deployment. If a probe throws, the API maps it to `unavailable` and emits only a generic detail. Worker `reason`, queue counters, and lag come from the scheduler's lease-aware readiness snapshot; package bytes and worker error text are never forwarded.

## Initial alert guidance

Alert on sustained `overall: "outage"`, worker `ready: false` for more than one interval, queue lag above the configured scheduler threshold, repeated `consecutiveFailures`, or any stale lease count that does not recover after the lease window. Pair alerts with [the incident runbook](INCIDENT_RUNBOOK.md); do not paste status payloads containing internal deployment details into public reports.

This is a basic operational dashboard, not a hosted monitoring service. Retention, alert routing, multi-instance metrics, and historical uptime reporting remain deployment responsibilities for the public-beta environment.
