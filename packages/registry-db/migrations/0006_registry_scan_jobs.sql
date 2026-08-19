-- AgentCargo durable release-scan queue v1.
-- Jobs are separate from upload state so a worker can lease, retry, and
-- inspect a completed release without making public projections visible.

BEGIN;

ALTER TABLE registry_release_uploads
  ADD COLUMN IF NOT EXISTS rejection_json jsonb
    CHECK (rejection_json IS NULL OR jsonb_typeof(rejection_json) = 'object');

CREATE TABLE IF NOT EXISTS registry_scan_jobs (
  job_id text PRIMARY KEY CHECK (length(job_id) BETWEEN 1 AND 128),
  release_id text NOT NULL UNIQUE REFERENCES registry_release_uploads (release_id),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  scan_json jsonb CHECK (scan_json IS NULL OR jsonb_typeof(scan_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'running' OR lease_until IS NOT NULL),
  CHECK (status <> 'succeeded' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS registry_scan_jobs_claim_idx
  ON registry_scan_jobs (status, available_at, created_at);

COMMIT;
