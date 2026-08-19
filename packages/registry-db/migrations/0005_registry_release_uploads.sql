-- AgentCargo registry upload/completion state v1.
-- Upload intent and completion metadata remain private until a worker activates
-- a release into the public projections.

BEGIN;

CREATE TABLE IF NOT EXISTS registry_release_uploads (
  release_id text PRIMARY KEY
    REFERENCES registry_release_reservations (release_id),
  digest text NOT NULL
    CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  artifact_key text NOT NULL
    CHECK (
      artifact_key = 'artifacts/sha256/'
        || substr(digest, 8, 2)
        || '/'
        || substr(digest, 8, 64)
        || '.agentcargo'
    ),
  format text NOT NULL CHECK (format = 'agentcargo-ustar-v1'),
  media_type text NOT NULL CHECK (media_type = 'application/vnd.agentcargo.ustar-v1'),
  bytes bigint NOT NULL CHECK (bytes >= 0),
  status text NOT NULL CHECK (status IN ('reserved', 'uploaded', 'scanning', 'rejected')),
  completion_json jsonb CHECK (completion_json IS NULL OR jsonb_typeof(completion_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS registry_release_uploads_status_idx
  ON registry_release_uploads (status, created_at);

COMMIT;
