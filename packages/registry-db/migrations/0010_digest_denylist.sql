-- AgentCargo emergency SHA-256 digest denylist.
-- Current state is small and queryable; the append-only moderation audit table
-- retains the complete add/remove history and actor attribution.

BEGIN;

CREATE TABLE IF NOT EXISTS registry_digest_denylist (
  digest text PRIMARY KEY
    CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  reason text NOT NULL
    CHECK (length(reason) BETWEEN 1 AND 512),
  active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= added_at)
);

CREATE INDEX IF NOT EXISTS registry_digest_denylist_active_idx
  ON registry_digest_denylist (digest)
  WHERE active = true;

COMMIT;
