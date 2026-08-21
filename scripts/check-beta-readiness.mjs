#!/usr/bin/env node

import { access, lstat, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_CHECKLIST = path.join(REPOSITORY_ROOT, "docs", "BETA_READINESS.json");
const ALLOWED_CATEGORIES = new Set(["repository", "deployment", "external"]);
const ALLOWED_STATUSES = new Set(["ready", "operator-action", "external-action"]);

export async function runReadinessCheck({ rootDir = REPOSITORY_ROOT, checklistPath = path.join(rootDir, "docs", "BETA_READINESS.json") } = {}) {
  const root = path.resolve(rootDir);
  const checklistFile = path.resolve(checklistPath);
  const validationErrors = [];
  let checklist;

  try {
    checklist = JSON.parse(await readFile(checklistFile, "utf8"));
  } catch (error) {
    validationErrors.push(`Unable to read checklist: ${safeErrorMessage(error)}`);
    return result({ root, checklistPath: checklistFile, validationErrors, checks: [] });
  }

  if (!isRecord(checklist) || checklist.schemaVersion !== 1 || checklist.project !== "AgentCargo" || !Array.isArray(checklist.gates)) {
    validationErrors.push("Checklist must be an AgentCargo schema version 1 object with a gates array.");
    return result({ root, checklistPath: checklistFile, validationErrors, checks: [] });
  }

  const statusPath = path.join(root, "docs", "STATUS.md");
  let statusText = "";
  try {
    statusText = await readFile(statusPath, "utf8");
  } catch (error) {
    validationErrors.push(`Unable to read docs/STATUS.md: ${safeErrorMessage(error)}`);
  }

  const rootManifest = await readJson(path.join(root, "package.json"), validationErrors, "package.json");
  const seenIds = new Set();
  const checks = [];
  for (const gate of checklist.gates) {
    const gateErrors = [];
    if (!isRecord(gate) || typeof gate.id !== "string" || typeof gate.category !== "string" || typeof gate.title !== "string" || typeof gate.status !== "string") {
      validationErrors.push("Every gate must contain string id, category, title, and status fields.");
      continue;
    }
    if (seenIds.has(gate.id)) gateErrors.push("duplicate gate id");
    seenIds.add(gate.id);
    if (!ALLOWED_CATEGORIES.has(gate.category)) gateErrors.push(`unsupported category ${gate.category}`);
    if (!ALLOWED_STATUSES.has(gate.status)) gateErrors.push(`unsupported status ${gate.status}`);

    const missingPaths = [];
    if (gate.category === "repository") {
      if (!Array.isArray(gate.requiredPaths) || gate.requiredPaths.length === 0) {
        gateErrors.push("repository gates require a non-empty requiredPaths array");
      } else {
        for (const relativePath of gate.requiredPaths) {
          if (typeof relativePath !== "string" || !isSafeRelativePath(relativePath)) {
            gateErrors.push(`unsafe required path ${String(relativePath)}`);
            continue;
          }
          if (!(await exists(path.join(root, relativePath)))) missingPaths.push(relativePath);
        }
      }
      if (Array.isArray(gate.requiredPackageScripts)) {
        const scripts = isRecord(rootManifest?.scripts) ? rootManifest.scripts : {};
        for (const scriptName of gate.requiredPackageScripts) {
          if (typeof scriptName !== "string" || typeof scripts[scriptName] !== "string") gateErrors.push(`missing package script ${String(scriptName)}`);
        }
      }
      if (typeof gate.statusEvidence !== "string" || gate.statusEvidence.length === 0) {
        gateErrors.push("repository gates require statusEvidence");
      } else if (!statusText.includes(gate.statusEvidence)) {
        gateErrors.push(`missing status evidence ${gate.statusEvidence}`);
      }
    } else if (!Array.isArray(gate.requiredActions) || gate.requiredActions.length === 0) {
      gateErrors.push("deployment/external gates require a non-empty requiredActions array");
    }

    const ready = gate.category === "repository" ? gate.status === "ready" && gateErrors.length === 0 && missingPaths.length === 0 : gate.status === "ready";
    checks.push({
      id: gate.id,
      category: gate.category,
      title: gate.title,
      declaredStatus: gate.status,
      ready,
      missingPaths,
      errors: gateErrors,
    });
  }

  if (seenIds.size !== checklist.gates.length) validationErrors.push("Checklist gate IDs must be unique and every gate must be an object.");
  return result({ root, checklistPath: checklistFile, validationErrors, checks });
}

function result({ root, checklistPath, validationErrors, checks }) {
  const repositoryChecks = checks.filter((check) => check.category === "repository");
  const repositoryReady = validationErrors.length === 0 && repositoryChecks.every((check) => check.ready);
  const pending = checks.filter((check) => !check.ready).map((check) => check.id);
  return {
    schemaVersion: 1,
    project: "AgentCargo",
    root,
    checklistPath,
    repositoryReady,
    overallReady: validationErrors.length === 0 && checks.every((check) => check.ready),
    validationErrors,
    checks,
    pending,
  };
}

export function formatHuman(result) {
  const repository = result.checks.filter((check) => check.category === "repository");
  const readyCount = repository.filter((check) => check.ready).length;
  const lines = [
    "AgentCargo public-beta readiness",
    `Repository gates: ${result.repositoryReady ? "READY" : "NOT READY"} (${readyCount}/${repository.length})`,
    `Overall handoff: ${result.overallReady ? "READY" : "PENDING"}`,
  ];
  for (const error of result.validationErrors) lines.push(`- ERROR: ${error}`);
  for (const check of result.checks) {
    lines.push(`- ${check.ready ? "READY" : "PENDING"} [${check.category}] ${check.title}`);
    for (const missing of check.missingPaths) lines.push(`  missing: ${missing}`);
    for (const error of check.errors) lines.push(`  issue: ${error}`);
  }
  return lines.join("\n");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value) {
  return value.length > 0 && !path.isAbsolute(value) && value !== "." && !value.split(/[\\/]+/).includes("..") && !value.includes("\0");
}

async function exists(target) {
  try {
    const info = await lstat(target);
    return info.isFile() || info.isDirectory();
  } catch {
    return false;
  }
}

async function readJson(target, errors, label) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    errors.push(`Unable to read ${label}: ${safeErrorMessage(error)}`);
    return null;
  }
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.replace(/[\r\n\t]/g, " ").slice(0, 200) : "unknown error";
}

function parseArgs(argv) {
  const args = { json: false, strict: false, checklistPath: DEFAULT_CHECKLIST };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") args.json = true;
    else if (argument === "--strict") args.strict = true;
    else if (argument === "--checklist") {
      const value = argv[index + 1];
      if (!value) throw new Error("--checklist requires a path");
      args.checklistPath = path.resolve(value);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument ${argument}`);
    }
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
    console.log("Usage: node scripts/check-beta-readiness.mjs [--strict] [--json] [--checklist <path>]");
    return 0;
  }
  const result = await runReadinessCheck({ checklistPath: args.checklistPath });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatHuman(result));
  return args.strict && !result.repositoryReady ? 1 : 0;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) process.exitCode = await main();
