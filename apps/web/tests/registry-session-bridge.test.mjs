import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectBrowserReadSession,
  issueBrowserReadSession,
  readBrowserRegistrySessionCookie,
  serializeBrowserRegistrySessionCookie,
} from "../app/registry-session.ts";

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
