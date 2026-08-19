# Registry integration test

The normal workspace tests use deterministic repository and object-store fakes. The live test is opt-in and exercises the same repository, storage, and read-path contracts against a real PostgreSQL database and an S3-compatible object store.

## Adapter contract

Set `AGENTCARGO_REGISTRY_INTEGRATION_MODULE` to an absolute path to an ESM module that exports `createEnvironment()`. The factory must return:

```ts
interface LiveRegistryIntegrationEnvironment {
  repository: RegistryReleaseRepository;
  namespaceRepository: RegistryNamespaceRepository;
  reservationRepository: RegistryReleaseReservationRepository;
  storage: DigestArtifactStorage;
  activateRelease(release: RegistryRelease): Promise<void>;
  download(url: string): Promise<Uint8Array>;
  close(): Promise<void>;
}
```

The environment adapter is responsible for:

1. Connecting to PostgreSQL and applying the ordered migrations in `packages/registry-db/migrations/` (including upload/completion migration `0005_registry_release_uploads.sql` and scan-job migration `0006_registry_scan_jobs.sql`).
2. Connecting the `DigestArtifactStorage` to an S3-compatible bucket through a `RegistryObjectStore` implementation.
3. Constructing `PostgresRegistryReleaseRepository`, `PostgresRegistryNamespaceRepository`, and `PostgresRegistryReleaseReservationRepository`.
4. Exercising namespace ownership and idempotent release reservation before inserting the fixture release.
5. Inserting the fixture release into the immutable artifact/release tables in `activateRelease`.
6. Downloading the signed URL in `download` without bypassing the object-store endpoint.
7. Cleaning only the integration fixture and closing connections in `close`.

Run the harness with:

```bash
AGENTCARGO_REGISTRY_INTEGRATION_MODULE=/absolute/path/to/registry-integration-environment.mjs \
  pnpm --filter @agentcargo/registry-integration test
```

Without the environment variable, Vitest reports the live test as skipped. This keeps credentials, database URLs, bucket names, and provider client calls out of normal local test execution.

The repository includes a checked-in CI adapter at `packages/registry-integration/src/ci-environment.ts`. The `Registry integration` workflow provisions PostgreSQL 16 and MinIO, builds the adapter, and runs the live test with an ephemeral bucket. The PostgreSQL driver and AWS SDK dependencies are scoped to `@agentcargo/registry-integration`; they are not used by the registry API or storage boundary packages. Run the same adapter locally only when PostgreSQL and an S3-compatible endpoint are available:

```bash
AGENTCARGO_REGISTRY_INTEGRATION_MODULE="$PWD/packages/registry-integration/dist/ci-environment.js" \
  pnpm --filter @agentcargo/registry-integration test
```

The local adapter defaults to `PG*` environment variables and a MinIO endpoint at `http://127.0.0.1:9000`; override these with `AGENTCARGO_TEST_DATABASE_URL` and the `AGENTCARGO_TEST_S3_*` variables documented by the workflow.

The test verifies that one artifact is digest-checked before storage, activated in PostgreSQL, resolved through the read repository with a fresh signed URL, and downloaded bytes hash to the same immutable SHA-256 digest.

## CLI anonymous reads

The CLI uses `@agentcargo/registry-client` for the implemented read-only commands. Configure the registry with `AGENTCARGO_REGISTRY_URL` or pass `--registry`:

```bash
AGENTCARGO_REGISTRY_URL=https://registry.example.test \
  pnpm dev:cli search "code review" --host codex --scope project

AGENTCARGO_REGISTRY_URL=https://registry.example.test \
  pnpm dev:cli inspect @acme/review@1.2.3
```

Both commands support `--json`. They validate every successful response against the versioned contract and return stable errors for invalid URLs, network failures, non-success responses, and malformed registry data. Public releases can also be installed anonymously with the same registry URL:

```bash
AGENTCARGO_REGISTRY_URL=https://registry.example.test \
  pnpm dev:cli add @acme/review@1.2.3 --agent codex --scope project
```

`agentcargo add` resolves an omitted version to the package's current `latestVersion`, verifies the downloaded bytes against the declared size and SHA-256 digest, checks the archived metadata coordinate, and records `source.type: registry` in the lockfile.
