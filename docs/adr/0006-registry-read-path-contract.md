# ADR 0006: Versioned registry read path and immutable release contract

- Status: Accepted
- Date: 2026-08-13
- Owners: AgentCargo maintainers

## Context

Milestone 3 needs a public read path that can serve the website, CLI, and future alternative clients without coupling them to PostgreSQL tables or object-storage details. The read path must preserve AgentCargo's central promise: a release coordinate resolves to immutable artifact bytes whose exact SHA-256 digest can be verified locally.

The current repository has local package and adapter code but no registry implementation. The next implementation should establish the public contract before choosing route handlers, SQL queries, or storage providers.

## Decision

Use a versioned, read-only registry contract package named `@agentcargo/registry-contract`. Its initial API version is `v1`, and its public models are transport-safe TypeScript types with matching JSON shapes.

The package owns:

- API version constants and canonical artifact format/media-type constants;
- package and release coordinates;
- search request/response models;
- package summary and exact release detail models;
- artifact download descriptors;
- declared compatibility, file inventory, scan summary, and source metadata models;
- stable API error envelopes;
- small pure helpers for coordinate formatting, digest shape checks, and public release-status checks.

The package does not own HTTP, authentication, SQL, migrations, object storage, signed URL creation, pagination implementation, or CLI presentation.

### Read-path package boundaries

```text
apps/api                    Fastify routes, auth policy, request IDs, response serialization
packages/registry-contract  Versioned public JSON models and invariants
packages/api-client         Typed client generated from or conforming to the public contract
packages/db                 PostgreSQL schema, migrations, and repository queries
apps/worker                 Release activation, validation, scanning, and search indexing jobs
packages/core               Local coordinates, manifests, artifacts, extraction, and lockfiles
packages/cli                Commands and presentation; consumes api-client and core
apps/web                    Public pages; consumes api-client or server-side API calls
object storage              Immutable artifact bytes addressed by digest; never queried by web directly
```

The API is the only component that joins database metadata with a request-scoped artifact download URL. The database stores the immutable artifact key and digest; object storage serves the exact bytes; clients verify the digest before installation. Neither the API nor web layer may reconstruct package contents from database JSON.

### Initial public read operations

The first contract covers these anonymous operations:

```text
GET /v1/search?q=<query>&host=<host>&scope=<scope>&cursor=<cursor>&limit=<limit>
GET /v1/packages/:namespace/:name
GET /v1/packages/:namespace/:name/versions/:version
```

`GET /v1/packages/:namespace/:name/versions/:version` is the authoritative exact lookup used by remote installation. It returns a `RegistryReleaseLookupResponse` containing:

- the scoped coordinate and semantic version;
- active or deprecated status (never quarantined in a public response);
- publisher-declared metadata and host/scope compatibility;
- canonical artifact format, media type, byte length, and `sha256:<64 lowercase hex>` digest;
- a short-lived request-scoped download URL and expiry;
- deterministic file inventory and scan findings with rule versions;
- source repository/commit when available and publication time.

The URL is the only response field that is intentionally request-scoped. A new URL or expiry does not create a new release. Release identity remains `(namespace, name, version)` and the artifact digest must remain unchanged for the lifetime of that identity. A version cannot be reused after activation, deprecation, quarantine, or rejection reservation.

Search returns stable package summaries, not mutable download counters or arbitrary database rows. Cursor pagination is opaque to clients; `limit` is bounded by the API. Quarantined releases and packages with no public active/deprecated release are excluded from normal search and exact public lookup.

Every error uses the versioned `RegistryApiError` envelope with a stable code, safe message, request ID, and optional bounded details. Authentication is not required for these read operations, but rate limits and abuse controls remain API concerns.

## Consequences

Positive:

- The CLI and website depend on a stable public contract rather than database schema.
- Exact release lookup makes digest verification and immutable caching explicit.
- Signed URL rotation does not appear as a package update.
- Quarantine is enforced at the public read boundary instead of relying on clients to filter status.
- API, storage, and database implementations can evolve behind the contract.

Tradeoffs:

- The contract package must be versioned and reviewed as a public compatibility surface.
- Search summaries and exact release details may require separate database queries and cache policies.
- A future API version is needed for breaking JSON changes; additive optional fields must remain backwards compatible.
- Runtime JSON schema validation still needs to be wired into the API boundary before the registry launches.

## Rejected alternatives

### Expose database rows directly

Rejected because SQL schema, moderation state, storage keys, and internal IDs would become public compatibility commitments.

### Return permanent artifact URLs

Rejected because storage credentials, bucket layout, and CDN policy should remain replaceable. URLs are signed and request-scoped; digest and release identity are durable.

### Let each client define its own release model

Rejected because web and CLI could then disagree about quarantine, compatibility, file inventory, or digest semantics.

## Verification and follow-up

The initial contract, [OpenAPI 3.1 document](../../packages/registry-contract/openapi/registry-v1.json), and runtime validators are implemented in [`@agentcargo/registry-contract`](../../packages/registry-contract/src/index.ts) with invariant tests. The first repository, storage boundary, and Fastify route implementation is in [`@agentcargo/registry-db`](../../packages/registry-db/src/index.ts), [`@agentcargo/registry-storage`](../../packages/registry-storage/src/index.ts), and [`@agentcargo/registry-api`](../../packages/registry-api/src/index.ts). The next registry slice should add a live PostgreSQL/object-store integration test for release activation and lookup.
