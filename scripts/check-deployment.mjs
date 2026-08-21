#!/usr/bin/env node

import { createPrivateKey } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { inspectMigrations } from "./check-migrations.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const REQUIRED_URLS = [
  { id: "registry-url", variable: "AGENTCARGO_REGISTRY_URL", title: "Registry URL" },
  { id: "provider-broker-url", variable: "AGENTCARGO_WEB_PROVIDER_BROKER_URL", title: "Provider broker URL" },
];
const REQUIRED_SECRETS = [
  { id: "provider-broker-token", variable: "AGENTCARGO_WEB_PROVIDER_BROKER_TOKEN", title: "Provider broker credential" },
  { id: "cli-release-private-key", variable: "AGENTCARGO_CLI_RELEASE_PRIVATE_KEY", title: "CLI release private key" },
];

/**
 * Validate the deployment settings documented for the hosted beta handoff.
 * This function intentionally performs no network, database, or object-store calls.
 */
export async function inspectDeployment({
  rootDir = REPOSITORY_ROOT,
  env = process.env,
  allowLoopback = false,
} = {}) {
  const root = path.resolve(rootDir);
  const checks = [];
  const errors = [];

  for (const definition of REQUIRED_URLS) {
    const value = readEnvironment(env, definition.variable);
    const check = { id: definition.id, title: definition.title, variable: definition.variable, kind: "url", ok: false, details: { configured: false } };
    if (!value) {
      errors.push(issue("DEPLOYMENT_ENV_MISSING", `${definition.variable} is not configured.`));
    } else {
      const validation = validateUrl(value, allowLoopback);
      if (validation.error) errors.push(issue(validation.error.code, `${definition.variable}: ${validation.error.message}`));
      else {
        check.ok = true;
        check.details = { configured: true, protocol: validation.protocol, host: validation.host, loopback: validation.loopback };
      }
    }
    checks.push(check);
  }

  for (const definition of REQUIRED_SECRETS) {
    const value = readEnvironment(env, definition.variable);
    const check = { id: definition.id, title: definition.title, variable: definition.variable, kind: "secret", ok: false, details: { configured: false, redacted: true } };
    if (!value) {
      errors.push(issue("DEPLOYMENT_ENV_MISSING", `${definition.variable} is not configured.`));
    } else if (value.length > 16384) {
      errors.push(issue("DEPLOYMENT_SECRET_INVALID", `${definition.variable} exceeds the bounded configuration size.`));
    } else if (definition.id === "cli-release-private-key") {
      if (!isEd25519PrivateKey(value)) errors.push(issue("DEPLOYMENT_RELEASE_KEY_INVALID", `${definition.variable} must contain an Ed25519 private key.`));
      else {
        check.ok = true;
        check.details = { configured: true, redacted: true, keyType: "ed25519" };
      }
    } else {
      check.ok = true;
      check.details = { configured: true, redacted: true };
    }
    checks.push(check);
  }

  const migrations = await inspectMigrations({ rootDir });
  const migrationCheck = {
    id: "migration-inventory",
    title: "Checked-in migration inventory",
    kind: "repository",
    ok: migrations.ok,
    details: {
      count: migrations.count,
      latest: migrations.latest,
      databaseState: migrations.databaseState,
      directory: migrations.directory,
    },
  };
  checks.push(migrationCheck);
  if (!migrations.ok) {
    for (const error of migrations.errors) errors.push(issue("DEPLOYMENT_MIGRATIONS_INVALID", error.message, error.code));
  }

  return {
    schemaVersion: 1,
    project: "AgentCargo",
    root,
    ok: errors.length === 0,
    serviceHealth: "not_checked",
    databaseState: migrations.databaseState,
    checks,
    migrations: {
      count: migrations.count,
      latest: migrations.latest,
      ok: migrations.ok,
      databaseState: migrations.databaseState,
      errors: migrations.errors,
    },
    errors,
  };
}

function readEnvironment(env, name) {
  const value = env && typeof env[name] === "string" ? env[name].trim() : "";
  return value.length > 0 ? value : null;
}

function validateUrl(value, allowLoopback) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { error: { code: "DEPLOYMENT_URL_INVALID", message: "must be an absolute URL." } };
  }
  const loopback = isLoopbackHost(parsed.hostname);
  if (parsed.username || parsed.password || parsed.hash) {
    return { error: { code: "DEPLOYMENT_URL_CREDENTIALS", message: "must not contain URL credentials or a fragment." } };
  }
  if (parsed.protocol !== "https:" && !(allowLoopback && loopback && parsed.protocol === "http:")) {
    return { error: { code: "DEPLOYMENT_URL_INSECURE", message: "must use HTTPS; HTTP is allowed only for explicitly enabled loopback checks." } };
  }
  return { protocol: parsed.protocol.slice(0, -1), host: parsed.hostname, loopback };
}

function isLoopbackHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function isEd25519PrivateKey(value) {
  try {
    const key = createPrivateKey(value);
    return key.type === "private" && key.asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}

function issue(code, message, detailCode) {
  return detailCode ? { code, message, detailCode } : { code, message };
}

export function formatHuman(result) {
  const readyCount = result.checks.filter((check) => check.ok).length;
  const lines = [
    "AgentCargo deployment preflight",
    `Configuration: ${result.ok ? "READY" : "NOT READY"} (${readyCount}/${result.checks.length} checks)`,
    "Service health: NOT CHECKED (configuration inventory only)",
    "Database state: NOT CHECKED (migration files only)",
  ];
  for (const check of result.checks) lines.push(`- ${check.ok ? "READY" : "NOT READY"} ${check.title}${check.variable ? ` [${check.variable}]` : ""}`);
  for (const error of result.errors) lines.push(`- ERROR [${error.code}]: ${error.message}`);
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { json: false, strict: false, allowLoopback: false, rootDir: REPOSITORY_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") args.json = true;
    else if (argument === "--strict") args.strict = true;
    else if (argument === "--allow-loopback") args.allowLoopback = true;
    else if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a path");
      args.rootDir = path.resolve(value);
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
    console.log("Usage: node scripts/check-deployment.mjs [--strict] [--json] [--allow-loopback] [--root <path>]");
    return 0;
  }
  const result = await inspectDeployment({ rootDir: args.rootDir, allowLoopback: args.allowLoopback });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatHuman(result));
  return args.strict && !result.ok ? 1 : 0;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) process.exitCode = await main();
