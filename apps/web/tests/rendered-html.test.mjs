import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/", requestHeaders = {}, requestInit = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      ...requestInit,
      headers: { accept: "text/html", ...requestHeaders, ...(requestInit.headers ?? {}) },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the AgentCargo catalog", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AgentCargo · Skills you can inspect<\/title>/i);
  assert.match(html, /Find the right skill for the work/);
  assert.match(html, /Skills worth knowing/);
  assert.match(html, /patch-review/);
  assert.match(html, /code-review/);
  assert.match(html, /sql-review/);
  assert.match(html, /AgentCargo Maintainers/);
  assert.match(html, /Version history/);
  assert.match(html, /1\.3\.0/);
  assert.match(html, /Immutable artifact/);
  assert.match(html, /Install with AgentCargo/);
  assert.match(html, /href="\/publish"/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|react-loading-skeleton/i);
});

test("server-renders the public status boundary", async () => {
  const response = await render("/status");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Public operational status/);
  assert.match(html, /Current status/);
  assert.match(html, /Status exposes bounded counters/);
  assert.doesNotMatch(html, /password|access_token|refresh_token|Bearer /i);
});

test("server-renders the local skill builder without a hosted publish dependency", async () => {
  const response = await render("/publish");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Draft an instruction-only skill/);
  assert.match(html, /Generate skill files/);
  assert.match(html, /Nothing is uploaded from this browser page/);
  assert.match(html, /Generated files/);
  assert.doesNotMatch(html, /v1\/auth\/github\/start/);
});

test("gates the publisher workspace without identity headers", async () => {
  const response = await render("/publisher");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Publisher workspace/);
  assert.match(html, /Sign in to manage releases/);
  assert.match(html, /Sign in with ChatGPT/);
  assert.match(html, /identity alone never grants namespace access/);
  assert.match(html, /Publisher read session/);
  assert.match(html, /Sign in before requesting a read-scoped registry session/);
  assert.match(html, /publisher:read/);
  assert.match(html, /Version history/);
  assert.doesNotMatch(html, /access_token|refresh_token|Bearer /i);
});

test("renders a read-only publisher summary from workspace identity headers", async () => {
  const response = await render("/publisher", {
    "oai-authenticated-user-id": "user-42",
    "oai-authenticated-user-email": "ada@example.test",
    "oai-authenticated-user-full-name": "Ada%20Lovelace",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Welcome, <em>Ada Lovelace/);
  assert.match(html, /Signed-in identity/);
  assert.match(html, /Identity verified by workspace headers/);
  assert.match(html, /Request a read-scoped AgentCargo session/);
  assert.match(html, /Connect registry/);
  assert.match(html, /No demo publisher data is shown here/);
  assert.doesNotMatch(html, /@studio\/patch-review|Local workspace records/);
  assert.match(html, /Sign out/);
});

test("exposes a fail-closed server-side registry session boundary", async () => {
  const anonymous = await render("/api/registry-session");
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.headers.get("cache-control"), "no-store");
  assert.deepEqual(await anonymous.json(), {
    apiVersion: "local",
    state: "anonymous",
    workspaceIdentity: false,
    registrySession: "absent",
    registrySessionExpiresAt: null,
    plannedScopes: ["publisher:read"],
    writesAvailable: false,
  });

  const anonymousPost = await render("/api/registry-session", {}, { method: "POST" });
  assert.equal(anonymousPost.status, 401);
  assert.equal((await anonymousPost.json()).error.code, "REGISTRY_AUTH_REQUIRED");

  const identity = await render("/api/registry-session", {
    "oai-authenticated-user-id": "user-42",
    "oai-authenticated-user-email": "ada@example.test",
  });
  assert.equal(identity.status, 200);
  assert.deepEqual(await identity.json(), {
    apiVersion: "local",
    state: "identity-only",
    workspaceIdentity: true,
    registrySession: "absent",
    registrySessionExpiresAt: null,
    plannedScopes: ["publisher:read"],
    writesAvailable: false,
  });

  const configured = await render("/api/registry-session", {
    "oai-authenticated-user-id": "user-42",
    "oai-authenticated-user-email": "ada@example.test",
  }, { method: "POST" });
  assert.equal(configured.status, 501);
  assert.equal((await configured.json()).error.code, "REGISTRY_AUTH_NOT_CONFIGURED");

  const browserCredential = await render("/api/registry-session", {
    "oai-authenticated-user-id": "user-42",
    "oai-authenticated-user-email": "ada@example.test",
    "content-type": "application/json",
  }, { method: "POST", body: JSON.stringify({ accessToken: "should-not-be-accepted" }) });
  assert.equal(browserCredential.status, 400);
  const browserCredentialBody = await browserCredential.json();
  assert.equal(browserCredentialBody.error.code, "REGISTRY_REQUEST_INVALID");
  assert.doesNotMatch(JSON.stringify(browserCredentialBody), /should-not-be-accepted|access_token|refresh_token|Bearer /i);

  const signedOut = await render("/api/registry-session", {}, { method: "DELETE" });
  assert.equal(signedOut.status, 200);
  assert.deepEqual(await signedOut.json(), { apiVersion: "local", state: "signed-out", registrySession: "absent", writesAvailable: false });
  assert.match(signedOut.headers.get("set-cookie") ?? "", /agentcargo_session=;.*Max-Age=0.*HttpOnly/);
});
