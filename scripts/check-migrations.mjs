#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_MIGRATIONS_DIR = path.join(REPOSITORY_ROOT, "packages", "registry-db", "migrations");
const MIGRATION_NAME_PATTERN = /^(\d{4})_([a-z0-9]+(?:[-_][a-z0-9]+)*)\.sql$/;

const DESTRUCTIVE_PATTERNS = [
  { code: "MIGRATION_DESTRUCTIVE_SQL", pattern: /\bDROP\s+(?!TRIGGER\b|CONSTRAINT\b)[A-Z_]+/gi, message: "only idempotent DROP TRIGGER or DROP CONSTRAINT statements are allowed" },
  { code: "MIGRATION_DESTRUCTIVE_SQL", pattern: /\bTRUNCATE\b/gi, message: "TRUNCATE statements are not allowed in checked-in migrations" },
  { code: "MIGRATION_DESTRUCTIVE_SQL", pattern: /\bDELETE\s+FROM\b/gi, message: "DELETE FROM statements are not allowed in checked-in migrations" },
  { code: "MIGRATION_UNSAFE_SQL", pattern: /\bALTER\s+SYSTEM\b/gi, message: "ALTER SYSTEM statements are not allowed in checked-in migrations" },
];

export async function inspectMigrations({ rootDir = REPOSITORY_ROOT, migrationsDir = path.join(rootDir, "packages", "registry-db", "migrations") } = {}) {
  const root = path.resolve(rootDir);
  const directory = path.resolve(migrationsDir);
  const errors = [];
  const migrations = [];

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    errors.push(issue("MIGRATIONS_DIRECTORY_UNREADABLE", `Unable to read ${relativePath(root, directory)}: ${safeErrorMessage(error)}`));
    return result({ root, directory, migrations, errors });
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (!entry.isFile()) {
      errors.push(issue("MIGRATION_ENTRY_UNSAFE", `${relativePath(root, entryPath)} is not a regular file`));
      continue;
    }

    const match = MIGRATION_NAME_PATTERN.exec(entry.name);
    if (!match) {
      errors.push(issue("MIGRATION_NAME_INVALID", `${relativePath(root, entryPath)} must match NNNN_lowercase-name.sql`));
      continue;
    }

    const number = Number(match[1]);
    const sql = await readFile(entryPath, "utf8");
    const file = {
      number,
      name: entry.name,
      path: relativePath(root, entryPath),
      bytes: Buffer.byteLength(sql, "utf8"),
      digest: `sha256:${createHash("sha256").update(sql, "utf8").digest("hex")}`,
    };
    migrations.push(file);
    for (const rule of DESTRUCTIVE_PATTERNS) {
      const matchResult = rule.pattern.exec(sql);
      rule.pattern.lastIndex = 0;
      if (matchResult) {
        errors.push(issue(rule.code, `${file.path}: ${rule.message} (near ${matchResult[0]})`));
      }
    }
    if (sql.includes("\0")) errors.push(issue("MIGRATION_UNSAFE_SQL", `${file.path}: NUL bytes are not allowed`));
  }

  migrations.sort((left, right) => left.number - right.number || left.name.localeCompare(right.name));
  if (migrations.length === 0) {
    errors.push(issue("MIGRATIONS_EMPTY", `${relativePath(root, directory)} contains no numbered SQL migrations`));
  } else {
    if (migrations[0].number !== 1) errors.push(issue("MIGRATION_SEQUENCE_START", `Migration sequence must start at 0001; found ${String(migrations[0].number).padStart(4, "0")}`));
    for (let index = 1; index < migrations.length; index += 1) {
      const previous = migrations[index - 1];
      const current = migrations[index];
      if (current.number === previous.number) errors.push(issue("MIGRATION_NUMBER_DUPLICATE", `Migration number ${String(current.number).padStart(4, "0")} is used by ${previous.name} and ${current.name}`));
      else if (current.number !== previous.number + 1) errors.push(issue("MIGRATION_SEQUENCE_GAP", `Migration sequence jumps from ${String(previous.number).padStart(4, "0")} to ${String(current.number).padStart(4, "0")}`));
    }
  }

  return result({ root, directory, migrations, errors });
}

function result({ root, directory, migrations, errors }) {
  return {
    schemaVersion: 1,
    root,
    directory: relativePath(root, directory),
    ok: errors.length === 0,
    databaseState: "not_checked",
    count: migrations.length,
    latest: migrations.length > 0 ? migrations[migrations.length - 1].number : null,
    migrations,
    errors,
  };
}

function issue(code, message) {
  return { code, message };
}

function relativePath(root, target) {
  const value = path.relative(root, target);
  return value.length === 0 ? "." : value.split(path.sep).join("/");
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.replace(/[\r\n\t]/g, " ").slice(0, 200) : "unknown error";
}

export function formatHuman(result) {
  const lines = [
    "AgentCargo migration preflight",
    `Repository migrations: ${result.ok ? "READY" : "NOT READY"} (${result.count} files; latest ${result.latest === null ? "none" : String(result.latest).padStart(4, "0")})`,
    "Database state: NOT CHECKED (repository inventory only)",
  ];
  for (const migration of result.migrations) lines.push(`- ${migration.name} ${migration.digest} (${migration.bytes} bytes)`);
  for (const error of result.errors) lines.push(`- ERROR [${error.code}]: ${error.message}`);
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { json: false, strict: false, migrationsDir: DEFAULT_MIGRATIONS_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") args.json = true;
    else if (argument === "--strict") args.strict = true;
    else if (argument === "--migrations") {
      const value = argv[index + 1];
      if (!value) throw new Error("--migrations requires a path");
      args.migrationsDir = path.resolve(value);
      index += 1;
    } else if (argument === "--help" || argument === "-h") args.help = true;
    else throw new Error(`Unknown argument ${argument}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid arguments");
    return 2;
  }
  if (args.help) {
    console.log("Usage: node scripts/check-migrations.mjs [--strict] [--json] [--migrations <path>]");
    return 0;
  }
  const result = await inspectMigrations({ migrationsDir: args.migrationsDir });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatHuman(result));
  return args.strict && !result.ok ? 1 : 0;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) process.exitCode = await main();
