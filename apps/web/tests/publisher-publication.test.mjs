import assert from "node:assert/strict";
import test from "node:test";
import { handlePublisherPublicationIntent } from "../app/publisher-publication.ts";
import { isSameOriginMutation } from "../app/mutation-security.ts";

const user = {
  userId: "user-42",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  fullName: "Ada Lovelace",
};

function workspace(namespaces = [{ namespace: "acme", packages: [] }]) {
  return { apiVersion: "v1", namespaces };
}

function deps(overrides = {}) {
  return {
    readBridge: {
      resolveProviderCredential: async () => "github-provider-token",
      exchange: async () => ({
        accessToken: "acs_read_session",
        tokenType: "bearer",
        expiresAt: "2099-01-01T00:00:00.000Z",
        scopes: ["publisher:read"],
      }),
    },
    resolveWorkspace: async () => workspace(),
    writeSessionExchange: async () => ({
      accessToken: "acs_write_session",
      tokenType: "bearer",
      expiresAt: "2099-01-01T00:00:00.000Z",
      scopes: ["publisher:write"],
    }),
    reserve: async (_token, input) => ({
      status: 201,
      body: {
        apiVersion: "v1",
        releaseId: "release-1",
        coordinate: { namespace: input.namespace, name: input.name, version: input.version },
        status: "reserved",
        createdAt: "2026-08-20T00:00:00.000Z",
        expiresAt: "2026-08-20T00:30:00.000Z",
      },
    }),
    ...overrides,
  };
}

function request(body) {
  return new Request("https://web.example.test/api/publisher-publication", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("rejects explicit cross-origin publication mutations", () => {
  assert.equal(isSameOriginMutation(new Request("https://web.example.test/api/publisher-publication", {
    method: "POST",
    headers: { origin: "https://attacker.example.test" },
  })), false);
  assert.equal(isSameOriginMutation(new Request("https://web.example.test/api/publisher-publication", {
    method: "POST",
    headers: { origin: "https://web.example.test", "sec-fetch-site": "same-origin" },
  })), true);
});

test("derives an owned namespace and reserves with a one-shot write session", async () => {
  let reservation;
  let writeScopes;
  const result = await handlePublisherPublicationIntent(request({ name: "review", version: "1.0.0", idempotencyKey: "intent-1" }), user, deps({
    resolveWorkspace: async () => workspace([{ namespace: "acme", packages: [{ package: { namespace: "acme", name: "review" }, releases: [] }] }]),
    writeSessionExchange: async (_token, options) => {
      writeScopes = options.scopes;
      return {
        accessToken: "acs_write_session",
        tokenType: "bearer",
        expiresAt: "2099-01-01T00:00:00.000Z",
        scopes: ["publisher:write"],
      };
    },
    reserve: async (token, input) => {
      reservation = { token, input };
      return deps().reserve(token, input);
    },
  }));

  assert.equal(result.status, 201);
  assert.equal(result.body.coordinate.namespace, "acme");
  assert.equal(result.body.coordinate.name, "review");
  assert.equal(result.body.releaseId, "release-1");
  assert.deepEqual(writeScopes, ["publisher:write"]);
  assert.deepEqual(reservation.input, { namespace: "acme", name: "review", version: "1.0.0", idempotencyKey: "intent-1" });
  assert.equal(reservation.token, "acs_write_session");
  assert.doesNotMatch(JSON.stringify(result.body), /acs_|provider|accessToken/i);
});

test("rejects namespace selectors, package files, and malformed intents before session exchange", async () => {
  let exchanged = false;
  const result = await handlePublisherPublicationIntent(request({
    namespace: "attacker-choice",
    name: "review",
    version: "1.0.0",
    idempotencyKey: "intent-2",
    files: [{ path: "SKILL.md", content: "must-not-be-accepted" }],
  }), user, deps({
    readBridge: {
      resolveProviderCredential: async () => "github-provider-token",
      exchange: async () => {
        exchanged = true;
        return null;
      },
    },
  }));
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "REGISTRY_REQUEST_INVALID");
  assert.equal(exchanged, false);
  assert.doesNotMatch(JSON.stringify(result.body), /attacker-choice|must-not-be-accepted/i);
});

test("refuses ambiguous ownership without asking the browser to choose a namespace", async () => {
  let writeCalled = false;
  const result = await handlePublisherPublicationIntent(request({ name: "new-skill", version: "1.0.0", idempotencyKey: "intent-3" }), user, deps({
    resolveWorkspace: async () => workspace([{ namespace: "acme", packages: [] }, { namespace: "labs", packages: [] }]),
    writeSessionExchange: async () => {
      writeCalled = true;
      return null;
    },
  }));
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "REGISTRY_NAMESPACE_SELECTION_REQUIRED");
  assert.equal(writeCalled, false);
});

test("maps missing or over-scoped server boundaries to fail-closed responses", async () => {
  const noBridge = await handlePublisherPublicationIntent(request({ name: "review", version: "1.0.0", idempotencyKey: "intent-4" }), user, deps({ readBridge: null }));
  assert.equal(noBridge.status, 501);
  assert.equal(noBridge.body.error.code, "REGISTRY_AUTH_NOT_CONFIGURED");

  const writeRejected = await handlePublisherPublicationIntent(request({ name: "review", version: "1.0.0", idempotencyKey: "intent-5" }), user, deps({
    writeSessionExchange: async () => ({
      accessToken: "acs_write_session",
      tokenType: "bearer",
      expiresAt: "2099-01-01T00:00:00.000Z",
      scopes: ["publisher:read"],
    }),
  }));
  assert.equal(writeRejected.status, 503);
  assert.equal(writeRejected.body.error.code, "REGISTRY_AUTH_UNAVAILABLE");
});
