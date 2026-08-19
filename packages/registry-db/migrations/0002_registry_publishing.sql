-- AgentCargo registry publishing schema v1.
-- Publisher identity and namespace ownership are separate from public release
-- projections so a reserved version can exist before an artifact is uploaded.

BEGIN;

CREATE TABLE IF NOT EXISTS registry_publishers (
  provider text NOT NULL CHECK (provider = 'github'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 256),
  login text CHECK (login IS NULL OR length(login) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE TABLE IF NOT EXISTS registry_namespaces (
  namespace text PRIMARY KEY
    CHECK (namespace ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  owner_provider text NOT NULL,
  owner_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_provider, owner_subject)
    REFERENCES registry_publishers (provider, subject),
  UNIQUE (namespace, owner_provider, owner_subject)
);

CREATE TABLE IF NOT EXISTS registry_release_reservations (
  release_id text PRIMARY KEY CHECK (length(release_id) BETWEEN 1 AND 128),
  namespace text NOT NULL,
  name text NOT NULL
    CHECK (name ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  version text NOT NULL
    CHECK (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'),
  publisher_provider text NOT NULL,
  publisher_subject text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  FOREIGN KEY (namespace, publisher_provider, publisher_subject)
    REFERENCES registry_namespaces (namespace, owner_provider, owner_subject),
  FOREIGN KEY (publisher_provider, publisher_subject)
    REFERENCES registry_publishers (provider, subject),
  UNIQUE (namespace, name, version),
  UNIQUE (publisher_provider, publisher_subject, idempotency_key)
);

CREATE INDEX IF NOT EXISTS registry_release_reservations_namespace_idx
  ON registry_release_reservations (namespace, name);

CREATE INDEX IF NOT EXISTS registry_release_reservations_expiry_idx
  ON registry_release_reservations (expires_at);

COMMIT;
