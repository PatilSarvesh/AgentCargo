-- AgentCargo guarded release deprecation and quarantine transitions.
-- Release identity and published metadata remain immutable; only moderation
-- status and the prior public status used for restoration may change.

BEGIN;

ALTER TABLE registry_public_releases
  ADD COLUMN IF NOT EXISTS quarantine_previous_status text
    CHECK (quarantine_previous_status IN ('active', 'deprecated'));

ALTER TABLE registry_moderation_audit_events
  ADD COLUMN IF NOT EXISTS idempotency_key text
    CHECK (idempotency_key IS NULL OR (length(idempotency_key) BETWEEN 1 AND 128));

CREATE UNIQUE INDEX IF NOT EXISTS registry_moderation_release_mutation_idx
  ON registry_moderation_audit_events (
    actor_kind,
    actor_provider,
    actor_subject,
    action,
    target_type,
    target_namespace,
    target_name,
    target_version,
    idempotency_key
  )
  WHERE target_type = 'release' AND idempotency_key IS NOT NULL;

COMMIT;
