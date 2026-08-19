import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("registry read-path migration", () => {
  it("creates digest-addressed artifacts and immutable release projections", async () => {
    const migration = await readFile(new URL("../migrations/0001_registry_read_path.sql", import.meta.url), "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS registry_artifacts");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS registry_public_packages");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS registry_public_releases");
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(migration).toContain("search_document text NOT NULL");
    expect(migration).toContain("gin_trgm_ops");
    expect(migration).toContain("registry_artifacts_immutable");
    expect(migration).toContain("registry_public_releases_immutable");
    expect(migration).toContain("status IN ('active', 'deprecated')");
    expect(migration).toContain("artifacts/sha256/");
    expect(migration).not.toMatch(/DROP TABLE/i);
  });

  it("adds publisher, namespace-owner, and pre-upload reservation tables", async () => {
    const migration = await readFile(new URL("../migrations/0002_registry_publishing.sql", import.meta.url), "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS registry_publishers");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS registry_namespaces");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS registry_release_reservations");
    expect(migration).toContain("UNIQUE (namespace, name, version)");
    expect(migration).toContain("UNIQUE (publisher_provider, publisher_subject, idempotency_key)");
    expect(migration).toContain("REFERENCES registry_namespaces (namespace, owner_provider, owner_subject)");
    expect(migration).toContain("expires_at > created_at");
    expect(migration).not.toMatch(/DROP TABLE/i);
  });

  it("adds revocable hash-only session storage", async () => {
    const migration = await readFile(new URL("../migrations/0003_registry_auth_sessions.sql", import.meta.url), "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS registry_auth_sessions");
    expect(migration).toContain("token_digest text PRIMARY KEY");
    expect(migration).toContain("REFERENCES registry_publishers (provider, subject)");
    expect(migration).toContain("revoked_at");
    expect(migration).toContain("expires_at > issued_at");
    expect(migration).not.toMatch(/access_token|refresh_token/i);
    expect(migration).not.toMatch(/DROP TABLE/i);
  });

  it("adds one-time hosted OAuth callback state storage", async () => {
    const migration = await readFile(new URL("../migrations/0004_registry_oauth_state.sql", import.meta.url), "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS registry_oauth_state");
    expect(migration).toContain("state_digest text PRIMARY KEY");
    expect(migration).toContain("code_verifier text NOT NULL");
    expect(migration).toContain("redirect_uri text NOT NULL");
    expect(migration).toContain("registry_oauth_state_expiry_idx");
    expect(migration).not.toMatch(/access_token|refresh_token/i);
    expect(migration).not.toMatch(/DROP TABLE/i);
  });

  it("adds private upload-intent and completion state", async () => {
    const migration = await readFile(new URL("../migrations/0005_registry_release_uploads.sql", import.meta.url), "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS registry_release_uploads");
    expect(migration).toContain("REFERENCES registry_release_reservations");
    expect(migration).toContain("completion_json jsonb");
    expect(migration).toContain("status IN ('reserved', 'uploaded', 'scanning', 'rejected')");
    expect(migration).not.toMatch(/DROP TABLE/i);
  });

  it("adds a leased PostgreSQL scan queue and bounded rejection evidence", async () => {
    const migration = await readFile(new URL("../migrations/0006_registry_scan_jobs.sql", import.meta.url), "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS registry_scan_jobs");
    expect(migration).toContain("status IN ('queued', 'running', 'succeeded', 'failed')");
    expect(migration).toContain("rejection_json jsonb");
    expect(migration).not.toMatch(/DROP TABLE/i);
  });

  it("adds bounded registry scopes to short-lived sessions", async () => {
    const migration = await readFile(new URL("../migrations/0007_registry_session_scopes.sql", import.meta.url), "utf8");

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS scopes text[]");
    expect(migration).toContain("publisher:read");
    expect(migration).toContain("publisher:write");
    expect(migration).toContain("registry_auth_sessions_scopes_check");
    expect(migration).not.toMatch(/DROP TABLE/i);
  });
});
