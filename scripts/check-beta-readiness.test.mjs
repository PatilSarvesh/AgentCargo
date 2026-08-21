import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runReadinessCheck } from "./check-beta-readiness.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("repository readiness passes while deployment and external gates remain pending", async () => {
  const result = await runReadinessCheck({ rootDir: repositoryRoot });
  assert.equal(result.repositoryReady, true);
  assert.equal(result.overallReady, false);
  assert.deepEqual(result.validationErrors, []);
  assert.deepEqual(result.pending, ["deployment-services", "status-alerts", "release-key-custody", "hosted-policy-identity", "external-creators", "external-install-learning"]);
});

test("strict repository checks report missing evidence and paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentcargo-beta-readiness-"));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "STATUS.md"), "evidence absent\n", "utf8");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: {} }), "utf8");
  await writeFile(path.join(root, "docs", "BETA_READINESS.json"), JSON.stringify({
    schemaVersion: 1,
    project: "AgentCargo",
    gates: [{
      id: "broken",
      category: "repository",
      title: "Broken gate",
      status: "ready",
      requiredPaths: ["missing.txt"],
      statusEvidence: "evidence PASS",
    }],
  }), "utf8");

  const result = await runReadinessCheck({ rootDir: root });
  assert.equal(result.repositoryReady, false);
  assert.deepEqual(result.pending, ["broken"]);
  assert.deepEqual(result.checks[0].missingPaths, ["missing.txt"]);
  assert.match(result.checks[0].errors.join(" "), /missing status evidence/);
});
