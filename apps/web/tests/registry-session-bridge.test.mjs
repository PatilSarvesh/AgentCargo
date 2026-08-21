import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectBrowserReadSession,
  issueBrowserReadSession,
  readBrowserRegistrySessionCookie,
  serializeBrowserRegistrySessionCookie,
} from "../app/registry-session.ts";
import {
  createRegistryPublisherWorkspaceResolverFromEnvironment,
  createRegistrySessionBridgeFromEnvironment,
} from "../app/registry-session-config.ts";
import { loadPublisherWorkspace } from "../app/publisher-workspace.ts";

const user = {
  userId: "user-42",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  fullName: "Ada Lovelace",
};

test("does not issue a session without an explicit server bridge", async () => {
  const result = await issueBrowserReadSession(new Request("http://localhost"), user, null);
  assert.deepEqual(result, { state: "unconfigured" });
});

test("resolves a provider credential server-side and requests read scope only", async () => {
  let resolverInput;
  let exchangeInput;
  const request = new Request("http://localhost/api/registry-session");
  const result = await issueBrowserReadSession(request, user, {
    resolveProviderCredential: async (input) => {
      resolverInput = input;
      return "github-provider-token";
    },
    exchange: async (providerToken, options) => {
      exchangeInput = { providerToken, options };
      return {
        accessToken: "acs_read_session",
        tokenType: "bearer",
        expiresAt: "2099-01-01T00:00:00.000Z",
        scopes: options.scopes,
      };
    },
  });

  assert.equal(result.state, "issued");
  assert.equal(resolverInput.workspaceIdentity, user);
  assert.equal(resolverInput.request, request);
  assert.deepEqual(exchangeInput, {
    providerToken: "github-provider-token",
    options: { scopes: ["publisher:read"] },
  });
  assert.deepEqual(result.session.scopes, ["publisher:read"]);
});

test("fails closed when the resolver has no provider credential or returns write access", async () => {
  const missing = await issueBrowserReadSession(new Request("http://localhost"), user, {
    resolveProviderCredential: async () => null,
    exchange: async () => null,
  });
  assert.deepEqual(missing, { state: "missing-provider-credential" });

  const writeSession = await issueBrowserReadSession(new Request("http://localhost"), user, {
    resolveProviderCredential: async () => "github-provider-token",
    exchange: async () => ({
      accessToken: "acs_write_session",
      tokenType: "bearer",
      expiresAt: "2099-01-01T00:00:00.000Z",
      scopes: ["publisher:write"],
    }),
  });
  assert.deepEqual(writeSession, { state: "exchange-failed" });
});

test("serializes only the opaque read-session token into a bounded HttpOnly cookie", () => {
  const cookie = serializeBrowserRegistrySessionCookie({
    accessToken: "acs_read_session",
    expiresAt: "2099-01-01T00:00:00.000Z",
  }, {
    now: () => Date.parse("2098-12-31T23:59:00.000Z"),
    secure: true,
  });

  assert.match(cookie, /^agentcargo_session=acs_read_session;/);
  assert.match(cookie, /Max-Age=60/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /github|provider/);
});

test("parses exactly one bounded opaque session cookie", () => {
  const request = new Request("http://localhost", {
    headers: { cookie: "theme=dark; agentcargo_session=acs_read_session%3D1" },
  });
  assert.equal(readBrowserRegistrySessionCookie(request), "acs_read_session=1");
  assert.equal(readBrowserRegistrySessionCookie(new Request("http://localhost")), null);
  assert.equal(readBrowserRegistrySessionCookie(new Request("http://localhost", {
    headers: { cookie: "agentcargo_session=bad%ZZ" },
  })), null);
  assert.equal(readBrowserRegistrySessionCookie(new Request("http://localhost", {
    headers: { cookie: "agentcargo_session=one; agentcargo_session=two" },
  })), null);
});

test("inspects a cookie through a server resolver and exposes read metadata only", async () => {
  let resolverInput;
  const request = new Request("http://localhost/api/registry-session", {
    headers: { cookie: "agentcargo_session=acs_read_session" },
  });
  const active = await inspectBrowserReadSession(request, {
    resolveProviderCredential: async () => null,
    exchange: async () => null,
    resolveSession: async (input) => {
      resolverInput = input;
      return { expiresAt: "2099-01-01T00:00:00.000Z", scopes: ["publisher:read"] };
    },
  });
  assert.deepEqual(active, {
    state: "active",
    expiresAt: "2099-01-01T00:00:00.000Z",
    scopes: ["publisher:read"],
  });
  assert.equal(resolverInput.request, request);
  assert.equal(resolverInput.accessToken, "acs_read_session");
});

test("fails closed for unconfigured, unavailable, expired, and over-scoped cookies", async () => {
  const request = new Request("http://localhost", {
    headers: { cookie: "agentcargo_session=acs_read_session" },
  });
  assert.deepEqual(await inspectBrowserReadSession(request, null), { state: "unconfigured" });
  assert.deepEqual(await inspectBrowserReadSession(request, {
    resolveProviderCredential: async () => null,
    exchange: async () => null,
    resolveSession: async () => { throw new Error("store unavailable"); },
  }), { state: "unavailable" });
  assert.deepEqual(await inspectBrowserReadSession(request, {
    resolveProviderCredential: async () => null,
    exchange: async () => null,
    resolveSession: async () => ({ expiresAt: "2000-01-01T00:00:00.000Z", scopes: ["publisher:read"] }),
  }), { state: "invalid" });
  assert.deepEqual(await inspectBrowserReadSession(request, {
    resolveProviderCredential: async () => null,
    exchange: async () => null,
    resolveSession: async () => ({ expiresAt: "2099-01-01T00:00:00.000Z", scopes: ["publisher:write"] }),
  }), { state: "invalid" });
});

test("composes a server-only provider broker, read-scope exchange, and token-free inspection", async () => {
  const calls = [];
  const bridge = createRegistrySessionBridgeFromEnvironment({
    AGENTCARGO_REGISTRY_URL: "https://registry.example.test/api",
    AGENTCARGO_WEB_PROVIDER_BROKER_URL: "https://broker.example.test/github-credential",
    AGENTCARGO_WEB_PROVIDER_BROKER_TOKEN: "broker-service-secret",
  }, async (input, init) => {
    const call = { url: String(input), init };
    calls.push(call);
    if (call.url === "https://broker.example.test/github-credential") {
      return new Response(JSON.stringify({ provider: "github", accessToken: "github-provider-token" }));
    }
    if (call.url === "https://registry.example.test/api/v1/auth/github/session") {
      return new Response(JSON.stringify({
        apiVersion: "v1",
        session: {
          accessToken: "acs_read_session",
          tokenType: "bearer",
          expiresAt: "2099-01-01T00:00:00.000Z",
          identity: { provider: "github", subject: "github-42", login: "ada" },
          scopes: ["publisher:read"],
        },
      }), { status: 201 });
    }
    if (call.url === "https://registry.example.test/api/v1/auth/session") {
      return new Response(JSON.stringify({
        apiVersion: "v1",
        session: { expiresAt: "2099-01-01T00:00:00.000Z", scopes: ["publisher:read"] },
      }));
    }
    return new Response(null, { status: 404 });
  });
  assert.ok(bridge);

  const browserRequest = new Request("https://web.example.test/api/registry-session", {
    headers: {
      cookie: "browser-cookie=must-not-be-forwarded",
      "x-browser-provider-token": "must-not-be-forwarded",
    },
  });
  const issued = await issueBrowserReadSession(browserRequest, user, bridge);
  assert.equal(issued.state, "issued");
  assert.deepEqual(issued.session.scopes, ["publisher:read"]);

  const inspected = await inspectBrowserReadSession(new Request(browserRequest.url, {
    headers: { cookie: "agentcargo_session=acs_read_session" },
  }), bridge);
  assert.deepEqual(inspected, {
    state: "active",
    expiresAt: "2099-01-01T00:00:00.000Z",
    scopes: ["publisher:read"],
  });

  assert.deepEqual(calls.map((call) => call.url), [
    "https://broker.example.test/github-credential",
    "https://registry.example.test/api/v1/auth/github/session",
    "https://registry.example.test/api/v1/auth/session",
  ]);
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer broker-service-secret");
  assert.deepEqual(JSON.parse(calls[0].init.body), { provider: "github", workspaceUserId: "user-42" });
  assert.doesNotMatch(JSON.stringify(calls[0].init), /must-not-be-forwarded|ada@example/);
  assert.equal(new Headers(calls[1].init.headers).get("authorization"), "Bearer github-provider-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), { scopes: ["publisher:read"] });
  assert.equal(new Headers(calls[2].init.headers).get("authorization"), "Bearer acs_read_session");
});

test("keeps the deployment bridge disabled for missing, unsafe, or partial server settings", () => {
  const fetchImplementation = async () => new Response("{}");
  assert.equal(createRegistrySessionBridgeFromEnvironment({}, fetchImplementation), null);
  assert.equal(createRegistrySessionBridgeFromEnvironment({
    AGENTCARGO_REGISTRY_URL: "https://registry.example.test",
    AGENTCARGO_WEB_PROVIDER_BROKER_URL: "https://broker.example.test/credential",
  }, fetchImplementation), null);
  assert.equal(createRegistrySessionBridgeFromEnvironment({
    AGENTCARGO_REGISTRY_URL: "http://registry.example.test",
    AGENTCARGO_WEB_PROVIDER_BROKER_URL: "https://broker.example.test/credential",
    AGENTCARGO_WEB_PROVIDER_BROKER_TOKEN: "broker-service-secret",
  }, fetchImplementation), null);
  assert.ok(createRegistrySessionBridgeFromEnvironment({
    AGENTCARGO_REGISTRY_URL: "http://localhost:8787",
    AGENTCARGO_WEB_PROVIDER_BROKER_URL: "http://127.0.0.1:8788/credential",
    AGENTCARGO_WEB_PROVIDER_BROKER_TOKEN: "broker-service-secret",
  }, fetchImplementation));
});

test("loads authenticated publisher histories with the opaque read session only", async () => {
  let request;
  const workspace = {
    apiVersion: "v1",
    namespaces: [{ namespace: "acme", packages: [{
      package: { namespace: "acme", name: "review" },
      latestVersion: "1.0.0",
      releases: [{
        releaseId: "release-1",
        version: "1.0.0",
        status: "active",
        createdAt: "2026-08-15T00:00:00.000Z",
        expiresAt: "2026-08-15T00:30:00.000Z",
      }],
    }] }],
  };
  const resolver = createRegistryPublisherWorkspaceResolverFromEnvironment({
    AGENTCARGO_REGISTRY_URL: "https://registry.example.test/api",
  }, async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify(workspace));
  });
  assert.ok(resolver);

  const result = await loadPublisherWorkspace(new Request("https://web.example.test/publisher", {
    headers: { cookie: "agentcargo_session=acs_read_session; theme=dark" },
  }), resolver);

  assert.deepEqual(result, { state: "active", workspace });
  assert.equal(request.url, "https://registry.example.test/api/v1/publisher/workspace");
  assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer acs_read_session");
});

test("keeps publisher histories fail-closed for absent, rejected, unavailable, or overexposed data", async () => {
  assert.deepEqual(await loadPublisherWorkspace(new Request("https://web.example.test/publisher"), null), { state: "absent" });
  const withCookie = new Request("https://web.example.test/publisher", {
    headers: { cookie: "agentcargo_session=acs_read_session" },
  });
  assert.deepEqual(await loadPublisherWorkspace(withCookie, null), { state: "unconfigured" });
  assert.deepEqual(await loadPublisherWorkspace(withCookie, async () => null), { state: "invalid" });
  assert.deepEqual(await loadPublisherWorkspace(withCookie, async () => { throw new Error("offline"); }), { state: "unavailable" });
  assert.deepEqual(await loadPublisherWorkspace(withCookie, async () => ({
    apiVersion: "v1",
    namespaces: [],
    accessToken: "must-not-be-accepted",
  })), { state: "invalid" });
});
