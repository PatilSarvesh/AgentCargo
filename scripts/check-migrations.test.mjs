import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { formatHuman, inspectMigrations } from "./check-migrations.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("repository migrations are contiguous, safely named, and non-destructive", async () => {
  const result = await inspectMigrations({ rootDir: repositoryRoot });
  assert.equal(result.ok, true);
  assert.equal(result.databaseState, "not_checked");
  assert.equal(result.count, 10);
  assert.equal(result.latest, 10);
  assert.deepEqual(result.errors, []);
  assert.equal(result.migrations[0].name, "0001_registry_read_path.sql");
  assert.equal(result.migrations.at(-1).name, "0010_digest_denylist.sql");
  assert.match(formatHuman(result), /Database state: NOT CHECKED/);
});

test("preflight reports sequence, naming, and destructive SQL errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentcargo-migrations-"));
  const migrationsDir = path.join(root, "migrations");
  await mkdir(migrationsDir, { recursive: true });
  await writeFile(path.join(migrationsDir, "0001_initial.sql"), "CREATE TABLE example (id integer);\n", "utf8");
  await writeFile(path.join(migrationsDir, "0003_gap.sql"), "DROP TABLE example;\n", "utf8");
  await writeFile(path.join(migrationsDir, "0003_duplicate.sql"), "CREATE INDEX example_idx ON example (id);\n", "utf8");
  await writeFile(path.join(migrationsDir, "bad-name.sql"), "CREATE TABLE ignored (id integer);\n", "utf8");

  const result = await inspectMigrations({ rootDir: root, migrationsDir });
  assert.equal(result.ok, false);
  assert.deepEqual(new Set(result.errors.map((error) => error.code)), new Set([
    "MIGRATION_NAME_INVALID",
    "MIGRATION_DESTRUCTIVE_SQL",
    "MIGRATION_NUMBER_DUPLICATE",
    "MIGRATION_SEQUENCE_GAP",
  ]));
});

test("preflight reports an unreadable migration directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentcargo-migrations-missing-"));
  const result = await inspectMigrations({ rootDir: root, migrationsDir: path.join(root, "missing") });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0]?.code, "MIGRATIONS_DIRECTORY_UNREADABLE");
});
