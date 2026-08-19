import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GitHubOAuthClient,
  GitHubOAuthError,
  GitHubHostedOAuthFlow,
  GitHubPublisherTokenVerifier,
  InMemoryGitHubOAuthStateStore,
} from "./github-oauth.js";

describe("GitHub OAuth client", () => {
  it("builds a stateful PKCE authorization request", () => {
    const client = new GitHubOAuthClient({ clientId: "Iv1.client" });
    const request = client.createAuthorizationRequest({
      redirectUri: "https://registry.example.test/auth/github/callback",
      scopes: ["read:user"],
      allowSignup: false,
    });
    const url = new URL(request.authorizationUrl);
    const expectedChallenge = createHash("sha256").update(request.codeVerifier).digest("base64url");

    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://registry.example.test/auth/github/callback");
    expect(url.searchParams.get("state")).toBe(request.state);
    expect(url.searchParams.get("code_challenge")).toBe(expectedChallenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("read:user");
    expect(url.searchParams.get("allow_signup")).toBe("false");
    expect(request.state).toHaveLength(43);
    expect(request.codeVerifier).toHaveLength(43);
  });

  it("exchanges an authorization code for a validated credential", async () => {
    let requestBody = "";
    const client = new GitHubOAuthClient({
      clientId: "Iv1.client",
      clientSecret: "secret-value",
      now: () => Date.parse("2026-08-15T00:00:00.000Z"),
      fetch: async (_input, init) => {
        requestBody = String(init?.body);
        return new Response(JSON.stringify({
          access_token: "ghu_access",
          token_type: "bearer",
          scope: "read:user",
          expires_in: 28800,
          refresh_token: "ghr_refresh",
          refresh_token_expires_in: 15897600,
        }), { status: 200 });
      },
    });

    await expect(client.exchangeCode({
      code: "temporary-code",
      redirectUri: "https://registry.example.test/auth/github/callback",
      codeVerifier: "verifier",
    })).resolves.toMatchObject({
      provider: "github",
      tokenType: "bearer",
      accessToken: "ghu_access",
      refreshToken: "ghr_refresh",
      scopes: ["read:user"],
      expiresAt: "2026-08-15T08:00:00.000Z",
      refreshTokenExpiresAt: "2027-02-15T00:00:00.000Z",
    });
    const form = new URLSearchParams(requestBody);
    expect(form.get("client_id")).toBe("Iv1.client");
    expect(form.get("client_secret")).toBe("secret-value");
    expect(form.get("code")).toBe("temporary-code");
    expect(form.get("code_verifier")).toBe("verifier");
  });

  it("runs the device flow while honoring pending and slow-down responses", async () => {
    const sleeps: number[] = [];
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_code: "device-code",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        verification_uri_complete: "https://github.com/login/device?user_code=ABCD-1234",
        expires_in: 900,
        interval: 1,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "slow_down" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "ghu_device",
        token_type: "bearer",
        scope: "",
      }), { status: 200 }));
    const client = new GitHubOAuthClient({
      clientId: "Iv1.client",
      fetch,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      now: () => Date.parse("2026-08-15T00:00:00.000Z"),
    });

    const device = await client.requestDeviceCode({});
    await expect(client.pollDeviceToken(device)).resolves.toMatchObject({ accessToken: "ghu_device", tokenType: "bearer" });
    expect(sleeps).toEqual([1000, 1000, 6000]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("rotates refresh credentials without exposing token values in errors", async () => {
    let requestBody = "";
    const client = new GitHubOAuthClient({
      clientId: "Iv1.client",
      now: () => Date.parse("2026-08-15T00:00:00.000Z"),
      fetch: async (_input, init) => {
        requestBody = String(init?.body);
        return new Response(JSON.stringify({
          access_token: "ghu_new",
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "ghr_new",
          refresh_token_expires_in: 7200,
        }), { status: 200 });
      },
    });

    await expect(client.refreshAccessToken({
      provider: "github",
      tokenType: "bearer",
      accessToken: "ghu_old",
      refreshToken: "ghr_old",
    })).resolves.toMatchObject({ accessToken: "ghu_new", refreshToken: "ghr_new" });
    expect(new URLSearchParams(requestBody).get("refresh_token")).toBe("ghr_old");

    const rejected = new GitHubOAuthClient({
      clientId: "Iv1.client",
      fetch: async () => new Response(JSON.stringify({ error: "bad_verification_code", error_description: "ghr_old" }), { status: 400 }),
    });
    await expect(rejected.refreshAccessToken({
      provider: "github",
      tokenType: "bearer",
      accessToken: "ghu_old",
      refreshToken: "ghr_old",
    })).rejects.toMatchObject({ code: "GITHUB_OAUTH_TOKEN_REJECTED" });
    try {
      await rejected.refreshAccessToken({ provider: "github", tokenType: "bearer", accessToken: "ghu_old" });
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubOAuthError);
      expect(String(error)).not.toContain("ghu_old");
    }
  });

  it("revalidates the GitHub identity after token acquisition", async () => {
    const fetch = vi.fn(async (_input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ghu_identity");
      expect(new Headers(init?.headers).get("accept")).toBe("application/vnd.github+json");
      return new Response(JSON.stringify({ id: 12345, login: "agentcargo" }), { status: 200 });
    });
    const client = new GitHubOAuthClient({ clientId: "Iv1.client", fetch });
    await expect(client.getAuthenticatedIdentity("ghu_identity")).resolves.toEqual({
      provider: "github",
      subject: "12345",
      login: "agentcargo",
    });
  });

  it("protects hosted callbacks with one-time, redirect-bound state", async () => {
    let now = Date.parse("2026-08-15T00:00:00.000Z");
    const client = new GitHubOAuthClient({ clientId: "Iv1.client" });
    const request = client.createAuthorizationRequest({ redirectUri: "https://registry.example.test/auth/github/callback" });
    const store = new InMemoryGitHubOAuthStateStore({ now: () => now, ttlSeconds: 60 });

    await expect(store.remember(request, "https://registry.example.test/auth/github/callback")).resolves.toEqual({
      expiresAt: "2026-08-15T00:01:00.000Z",
    });
    await expect(store.consume(request.state, "https://registry.example.test/auth/github/callback")).resolves.toEqual({
      codeVerifier: request.codeVerifier,
    });
    await expect(store.consume(request.state, "https://registry.example.test/auth/github/callback")).resolves.toBeNull();

    const second = client.createAuthorizationRequest({ redirectUri: "https://registry.example.test/auth/github/callback" });
    await store.remember(second, "https://registry.example.test/auth/github/callback");
    await expect(store.consume(second.state, "https://other.example.test/auth/github/callback")).resolves.toBeNull();
    await expect(store.consume(second.state, "https://registry.example.test/auth/github/callback")).resolves.toBeNull();

    const expired = client.createAuthorizationRequest({ redirectUri: "https://registry.example.test/auth/github/callback" });
    await store.remember(expired, "https://registry.example.test/auth/github/callback");
    now += 60_000;
    await expect(store.consume(expired.state, "https://registry.example.test/auth/github/callback")).resolves.toBeNull();
  });

  it("adapts GitHub identity verification for the registry and distinguishes invalid tokens", async () => {
    const valid = new GitHubOAuthClient({
      clientId: "Iv1.client",
      fetch: async () => new Response(JSON.stringify({ id: 7, login: "agentcargo" }), { status: 200 }),
    });
    await expect(new GitHubPublisherTokenVerifier(valid).verify("ghu_valid")).resolves.toEqual({
      provider: "github",
      subject: "7",
      login: "agentcargo",
    });

    const invalid = new GitHubOAuthClient({
      clientId: "Iv1.client",
      fetch: async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }),
    });
    await expect(new GitHubPublisherTokenVerifier(invalid).verify("ghu_invalid")).resolves.toBeNull();

    const unavailable = new GitHubOAuthClient({
      clientId: "Iv1.client",
      fetch: async () => new Response(JSON.stringify({ message: "try later" }), { status: 503 }),
    });
    await expect(new GitHubPublisherTokenVerifier(unavailable).verify("ghu_unavailable")).rejects.toMatchObject({
      code: "GITHUB_OAUTH_HTTP_ERROR",
      status: 503,
    });
  });

  it("wires hosted PKCE begin/complete through one-time callback state", async () => {
    let requestBody = "";
    const client = new GitHubOAuthClient({
      clientId: "Iv1.client",
      clientSecret: "secret-value",
      now: () => Date.parse("2026-08-15T00:00:00.000Z"),
      fetch: async (_input, init) => {
        requestBody = String(init?.body);
        return new Response(JSON.stringify({ access_token: "ghu_callback", token_type: "bearer" }), { status: 200 });
      },
    });
    const flow = new GitHubHostedOAuthFlow(client, new InMemoryGitHubOAuthStateStore({
      now: () => Date.parse("2026-08-15T00:00:00.000Z"),
      ttlSeconds: 60,
    }));
    const started = await flow.begin({
      redirectUri: "https://registry.example.test/auth/github/callback",
      scopes: ["read:user"],
    });
    expect(started.authorizationUrl).toContain("code_challenge=");
    await expect(flow.complete({
      code: "temporary-code",
      state: started.state,
      redirectUri: "https://registry.example.test/auth/github/callback",
    })).resolves.toMatchObject({ accessToken: "ghu_callback" });
    expect(new URLSearchParams(requestBody).get("code_verifier")).toBeTruthy();
    await expect(flow.complete({
      code: "temporary-code",
      state: started.state,
      redirectUri: "https://registry.example.test/auth/github/callback",
    })).rejects.toMatchObject({ code: "GITHUB_OAUTH_STATE_INVALID" });
  });
});
