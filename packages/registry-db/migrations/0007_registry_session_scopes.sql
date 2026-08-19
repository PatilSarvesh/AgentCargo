-- AgentCargo registry session scopes v1.
-- Scopes are short-lived authorization claims, not provider OAuth scopes.

BEGIN;

ALTER TABLE registry_auth_sessions
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['publisher:read', 'publisher:write'];

ALTER TABLE registry_auth_sessions
  DROP CONSTRAINT IF EXISTS registry_auth_sessions_scopes_check;

ALTER TABLE registry_auth_sessions
  ADD CONSTRAINT registry_auth_sessions_scopes_check
  CHECK (
    cardinality(scopes) BETWEEN 1 AND 2
    AND scopes <@ ARRAY['publisher:read', 'publisher:write']::text[]
    AND (
      cardinality(scopes) = 1
      OR (scopes @> ARRAY['publisher:read']::text[] AND scopes @> ARRAY['publisher:write']::text[])
    )
  );

COMMIT;
