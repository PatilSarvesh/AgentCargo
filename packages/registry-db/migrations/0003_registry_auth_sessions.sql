-- AgentCargo registry session storage schema v1.
-- Only a digest of each opaque bearer session is persisted. Provider identity
-- remains normalized in registry_publishers and session rows are revocable.

BEGIN;

CREATE TABLE IF NOT EXISTS registry_auth_sessions (
  token_digest text PRIMARY KEY
    CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  provider text NOT NULL CHECK (provider = 'github'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 256),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  revoked_at timestamptz,
  FOREIGN KEY (provider, subject)
    REFERENCES registry_publishers (provider, subject)
);

CREATE INDEX IF NOT EXISTS registry_auth_sessions_expiry_idx
  ON registry_auth_sessions (expires_at)
  WHERE revoked_at IS NULL;

COMMIT;
