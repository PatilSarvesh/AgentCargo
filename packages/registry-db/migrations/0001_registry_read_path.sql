-- AgentCargo registry read-path schema v1.
-- Release coordinates and artifact digests are immutable after activation;
-- status is the only release field allowed to change in-place.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS registry_artifacts (
  digest text PRIMARY KEY
    CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  artifact_key text NOT NULL UNIQUE
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
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION registry_prevent_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.digest IS DISTINCT FROM OLD.digest
     OR NEW.artifact_key IS DISTINCT FROM OLD.artifact_key
     OR NEW.format IS DISTINCT FROM OLD.format
     OR NEW.media_type IS DISTINCT FROM OLD.media_type
     OR NEW.bytes IS DISTINCT FROM OLD.bytes
  THEN
    RAISE EXCEPTION 'registry artifact identity and metadata are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS registry_artifacts_immutable ON registry_artifacts;
CREATE TRIGGER registry_artifacts_immutable
BEFORE UPDATE ON registry_artifacts
FOR EACH ROW EXECUTE FUNCTION registry_prevent_artifact_mutation();

CREATE TABLE IF NOT EXISTS registry_public_packages (
  namespace text NOT NULL
    CHECK (namespace ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL
    CHECK (name ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text NOT NULL CHECK (status IN ('active', 'deprecated')),
  package_json jsonb NOT NULL CHECK (jsonb_typeof(package_json) = 'object'),
  compatibility jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(compatibility) = 'object'),
  search_document text NOT NULL DEFAULT '',
  search_text tsvector NOT NULL,
  search_rank real NOT NULL DEFAULT 0 CHECK (search_rank >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, name)
);

CREATE INDEX IF NOT EXISTS registry_public_packages_search_idx
  ON registry_public_packages USING gin (search_text);

ALTER TABLE registry_public_packages
  ADD COLUMN IF NOT EXISTS search_document text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS registry_public_packages_search_document_trgm_idx
  ON registry_public_packages USING gin (search_document gin_trgm_ops);

CREATE TABLE IF NOT EXISTS registry_public_releases (
  namespace text NOT NULL
    CHECK (namespace ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL
    CHECK (name ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  version text NOT NULL
    CHECK (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'),
  status text NOT NULL CHECK (status IN ('reserved', 'uploaded', 'scanning', 'active', 'deprecated', 'quarantined', 'rejected')),
  artifact_digest text NOT NULL REFERENCES registry_artifacts (digest),
  artifact_key text NOT NULL
    CHECK (
      artifact_key = 'artifacts/sha256/'
        || substr(artifact_digest, 8, 2)
        || '/'
        || substr(artifact_digest, 8, 64)
        || '.agentcargo'
    ),
  release_json jsonb NOT NULL CHECK (jsonb_typeof(release_json) = 'object'),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, name, version)
);

CREATE INDEX IF NOT EXISTS registry_public_releases_status_idx
  ON registry_public_releases (namespace, name, status);

CREATE OR REPLACE FUNCTION registry_prevent_release_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.namespace IS DISTINCT FROM OLD.namespace
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.artifact_digest IS DISTINCT FROM OLD.artifact_digest
     OR NEW.artifact_key IS DISTINCT FROM OLD.artifact_key
     OR NEW.release_json IS DISTINCT FROM OLD.release_json
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
  THEN
    RAISE EXCEPTION 'registry release identity and metadata are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS registry_public_releases_immutable ON registry_public_releases;
CREATE TRIGGER registry_public_releases_immutable
BEFORE UPDATE ON registry_public_releases
FOR EACH ROW EXECUTE FUNCTION registry_prevent_release_identity_mutation();

COMMIT;
