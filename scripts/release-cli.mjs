#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildCliRelease, verifyCliRelease } from "../packages/cli/dist/release-artifacts.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.error(`Usage:
  pnpm release:cli -- --private-key <ed25519-pem> --out-dir <directory> [--source-commit <commit>] [--key-id <id>]
  node scripts/release-cli.mjs verify --archive <file> --manifest <file> --signature <file> --public-key <ed25519-pem>`);
}

function flags(argumentsList) {
  const result = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const value = argumentsList[index];
    if (!value?.startsWith("--")) throw new Error(`Unexpected argument: ${value ?? ""}`);
    const key = value.slice(2);
    const next = argumentsList[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    result.set(key, next);
    index += 1;
  }
  return result;
}

async function build(argumentsList) {
  const options = flags(argumentsList);
  const privateKeyPath = options.get("private-key");
  const outputDirectory = options.get("out-dir");
  if (!privateKeyPath || !outputDirectory) throw new Error("--private-key and --out-dir are required.");
  const result = await buildCliRelease({
    workspaceRoot,
    outputDirectory: path.resolve(outputDirectory),
    privateKey: await readFile(path.resolve(privateKeyPath), "utf8"),
    ...(options.get("key-id") ? { keyId: options.get("key-id") } : {}),
    ...(options.get("source-commit") ? { sourceCommit: options.get("source-commit") } : {}),
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

async function verifyRelease(argumentsList) {
  const options = flags(argumentsList);
  const archive = options.get("archive");
  const manifest = options.get("manifest");
  const signature = options.get("signature");
  const publicKey = options.get("public-key");
  if (!archive || !manifest || !signature || !publicKey) throw new Error("--archive, --manifest, --signature, and --public-key are required.");
  const result = await verifyCliRelease({
    archivePath: path.resolve(archive),
    manifestPath: path.resolve(manifest),
    signaturePath: path.resolve(signature),
    publicKey: await readFile(path.resolve(publicKey), "utf8"),
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

try {
  const argumentsList = process.argv.slice(2);
  const command = argumentsList[0] === "verify" ? "verify" : "build";
  await (command === "verify" ? verifyRelease(argumentsList.slice(1)) : build(argumentsList));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exitCode = 1;
}
