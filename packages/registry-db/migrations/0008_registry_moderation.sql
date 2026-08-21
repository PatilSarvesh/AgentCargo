-- AgentCargo moderation reports and append-only audit events v1.
-- Reports are mutable workflow records; audit events are immutable evidence.

BEGIN;

CREATE TABLE IF NOT EXISTS registry_reports (
  report_id text PRIMARY KEY CHECK (length(report_id) BETWEEN 1 AND 128),
  namespace text NOT NULL CHECK (namespace ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (name ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  release_version text CHECK (
    release_version IS NULL OR release_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
  ),
  category text NOT NULL CHECK (category IN ('malware', 'impersonation', 'spam', 'copyright', 'policy', 'other')),
  status text NOT NULL CHECK (status IN ('open', 'triaged', 'resolved', 'dismissed')),
  evidence text NOT NULL CHECK (length(evidence) BETWEEN 1 AND 4096),
  reporter_provider text NOT NULL,
  reporter_subject text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (reporter_provider, reporter_subject)
    REFERENCES registry_publishers (provider, subject),
  UNIQUE (reporter_provider, reporter_subject, idempotency_key)
);

CREATE INDEX IF NOT EXISTS registry_reports_status_idx
  ON registry_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS registry_reports_target_idx
  ON registry_reports (namespace, name, release_version, created_at DESC);

CREATE TABLE IF NOT EXISTS registry_moderation_audit_events (
  event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 128),
  action text NOT NULL CHECK (action IN (
    'report_created', 'report_triaged', 'report_resolved', 'report_dismissed',
    'release_deprecated', 'release_quarantined', 'release_unquarantined',
    'digest_denylisted', 'digest_denylist_removed'
  )),
  actor_kind text NOT NULL CHECK (actor_kind IN ('publisher', 'maintainer', 'system')),
  actor_provider text,
  actor_subject text,
  target_type text NOT NULL CHECK (target_type IN ('report', 'package', 'release', 'artifact')),
  target_report_id text,
  target_namespace text,
  target_name text,
  target_version text,
  target_digest text,
  occurred_at timestamptz NOT NULL,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json) = 'object'),
  CHECK (
    (actor_kind = 'system' AND actor_provider IS NULL AND actor_subject IS NULL)
    OR (actor_kind IN ('publisher', 'maintainer') AND actor_provider = 'github' AND actor_subject IS NOT NULL AND length(actor_subject) BETWEEN 1 AND 256)
  ),
  CHECK (
    (target_type = 'report' AND target_report_id IS NOT NULL AND target_namespace IS NULL AND target_name IS NULL AND target_version IS NULL AND target_digest IS NULL)
    OR (target_type = 'package' AND target_report_id IS NULL AND target_namespace IS NOT NULL AND target_name IS NOT NULL AND target_version IS NULL AND target_digest IS NULL)
    OR (target_type = 'release' AND target_report_id IS NULL AND target_namespace IS NOT NULL AND target_name IS NOT NULL AND target_version IS NOT NULL AND target_digest IS NULL)
    OR (target_type = 'artifact' AND target_report_id IS NULL AND target_namespace IS NULL AND target_name IS NULL AND target_version IS NULL AND target_digest ~ '^sha256:[a-f0-9]{64}$')
  )
);

CREATE INDEX IF NOT EXISTS registry_moderation_audit_events_occurred_idx
  ON registry_moderation_audit_events (occurred_at DESC, event_id DESC);

CREATE OR REPLACE FUNCTION registry_prevent_moderation_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'moderation audit events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS registry_moderation_audit_events_immutable ON registry_moderation_audit_events;
CREATE TRIGGER registry_moderation_audit_events_immutable
BEFORE UPDATE OR DELETE ON registry_moderation_audit_events
FOR EACH ROW EXECUTE FUNCTION registry_prevent_moderation_audit_mutation();

COMMIT;
