-- AgentCargo hosted OAuth callback state schema v1.
-- State digests are one-time records. The verifier is transient callback
-- material and must be protected by the database's normal encryption/access
-- controls; provider access and refresh tokens are never stored here.

BEGIN;

CREATE TABLE IF NOT EXISTS registry_oauth_state (
  state_digest text PRIMARY KEY
    CHECK (state_digest ~ '^[a-f0-9]{64}$'),
  code_verifier text NOT NULL
    CHECK (length(code_verifier) BETWEEN 16 AND 512),
  redirect_uri text NOT NULL
    CHECK (length(redirect_uri) BETWEEN 1 AND 2048),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS registry_oauth_state_expiry_idx
  ON registry_oauth_state (expires_at);

COMMIT;
