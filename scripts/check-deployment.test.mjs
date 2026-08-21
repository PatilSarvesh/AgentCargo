import { generateKeyPairSync } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatHuman, inspectDeployment } from "./check-deployment.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function releaseKey() {
  const pair = generateKeyPairSync("ed25519");
  return String(pair.privateKey.export({ type: "pkcs8", format: "pem" }));
}

function validEnvironment() {
  return {
    AGENTCARGO_REGISTRY_URL: "https://registry.example.test",
    AGENTCARGO_WEB_PROVIDER_BROKER_URL: "https://host.example.test/internal/github-credential",
    AGENTCARGO_WEB_PROVIDER_BROKER_TOKEN: "broker-secret-value",
    AGENTCARGO_CLI_RELEASE_PRIVATE_KEY: releaseKey(),
  };
}

test("deployment preflight accepts documented configuration without checking live services", async () => {
  const result = await inspectDeployment({ rootDir: repositoryRoot, env: validEnvironment() });
  assert.equal(result.ok, true);
  assert.equal(result.serviceHealth, "not_checked");
  assert.equal(result.databaseState, "not_checked");
  assert.equal(result.migrations.count, 10);
  assert.equal(result.migrations.latest, 10);
  assert.deepEqual(result.errors, []);
  assert.match(formatHuman(result), /Service health: NOT CHECKED/);
});

test("deployment preflight reports missing settings without exposing secret values", async () => {
  const secret = "broker-secret-value";
  const result = await inspectDeployment({ rootDir: repositoryRoot, env: { AGENTCARGO_WEB_PROVIDER_BROKER_TOKEN: secret } });
  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((error) => error.code === "DEPLOYMENT_ENV_MISSING").length, 3);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.doesNotMatch(formatHuman(result), new RegExp(secret));
});

test("deployment preflight rejects insecure URLs and non-Ed25519 release keys", async () => {
  const result = await inspectDeployment({
    rootDir: repositoryRoot,
    env: {
      AGENTCARGO_REGISTRY_URL: "http://registry.example.test",
      AGENTCARGO_WEB_PROVIDER_BROKER_URL: "https://host.example.test/broker#fragment",
      AGENTCARGO_WEB_PROVIDER_BROKER_TOKEN: "broker-secret-value",
      AGENTCARGO_CLI_RELEASE_PRIVATE_KEY: "not-a-private-key",
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(new Set(result.errors.map((error) => error.code)), new Set([
    "DEPLOYMENT_URL_INSECURE",
    "DEPLOYMENT_URL_CREDENTIALS",
    "DEPLOYMENT_RELEASE_KEY_INVALID",
  ]));
});

test("deployment preflight allows explicitly enabled loopback URLs", async () => {
  const result = await inspectDeployment({
    rootDir: repositoryRoot,
    env: {
      ...validEnvironment(),
      AGENTCARGO_REGISTRY_URL: "http://127.0.0.1:8080",
      AGENTCARGO_WEB_PROVIDER_BROKER_URL: "http://localhost:9001/broker",
    },
    allowLoopback: true,
  });
  assert.equal(result.ok, true);
});
