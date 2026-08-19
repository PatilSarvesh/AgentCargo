import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileRegistryCredentialStore } from "./auth-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("file registry credential store", () => {
  it("round-trips credentials without exposing the token in status", async () => {
    const root = await temporaryDirectory();
    const filePath = path.join(root, "config", "auth.json");
    const store = new FileRegistryCredentialStore({ filePath });

    await store.set("https://registry.example.test///", {
      provider: "github",
      tokenType: "bearer",
      accessToken: "gho_secret_value",
      expiresAt: "2999-01-01T00:00:00.000Z",
    });

    await expect(store.get("https://registry.example.test")).resolves.toMatchObject({
      provider: "github",
      accessToken: "gho_secret_value",
    });
    await expect(store.getStatus("https://registry.example.test")).resolves.toEqual({
      registry: "https://registry.example.test/",
      authenticated: true,
      refreshable: false,
      provider: "github",
      expiresAt: "2999-01-01T00:00:00.000Z",
      expired: false,
    });
    const metadata = await lstat(filePath);
    if (process.platform !== "win32") {
      expect(metadata.mode & 0o777).toBe(0o600);
      expect((await lstat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
    }
    expect(await readFile(filePath, "utf8")).toContain("gho_secret_value");
  });

  it("supports multiple registries, expiry reporting, and selective logout", async () => {
    const root = await temporaryDirectory();
    const store = new FileRegistryCredentialStore({ filePath: path.join(root, "auth.json") });
    const credential = { provider: "github" as const, tokenType: "bearer" as const, accessToken: "expired", expiresAt: "2020-01-01T00:00:00.000Z" };

    await store.set("https://one.example.test", credential);
    await store.set("https://two.example.test", { ...credential, accessToken: "live", expiresAt: "2999-01-01T00:00:00.000Z" });

    await expect(store.getStatus("https://one.example.test")).resolves.toMatchObject({ authenticated: false, expired: true });
    await expect(store.remove("https://one.example.test")).resolves.toBe(true);
    await expect(store.remove("https://one.example.test")).resolves.toBe(false);
    await expect(store.get("https://two.example.test")).resolves.toMatchObject({ accessToken: "live" });
  });

  it.skipIf(process.platform === "win32")("rejects invalid credentials, malformed stores, URLs with credentials, and symlinks", async () => {
    const root = await temporaryDirectory();
    const filePath = path.join(root, "auth.json");
    const store = new FileRegistryCredentialStore({ filePath });

    await expect(store.set("https://registry.example.test", { provider: "github", tokenType: "bearer", accessToken: "bad\nsecret" })).rejects.toMatchObject({ code: "AUTH_CREDENTIAL_INVALID" });
    await expect(store.set("https://user:pass@registry.example.test", { provider: "github", tokenType: "bearer", accessToken: "secret" })).rejects.toMatchObject({ code: "AUTH_REGISTRY_URL_INVALID" });

    await writeFile(filePath, "{not-json", { mode: 0o600 });
    await expect(store.get("https://registry.example.test")).rejects.toMatchObject({ code: "AUTH_STORE_INVALID" });

    const target = path.join(root, "target.json");
    await writeFile(target, JSON.stringify({ version: 1, credentials: {} }), { mode: 0o600 });
    await rm(filePath);
    await symlink(target, filePath);
    await expect(store.get("https://registry.example.test")).rejects.toMatchObject({ code: "AUTH_STORE_NOT_REGULAR_FILE" });
  });

  it.skipIf(process.platform === "win32")("does not silently accept a world-writable existing store", async () => {
    const root = await temporaryDirectory();
    const filePath = path.join(root, "auth.json");
    await writeFile(filePath, JSON.stringify({ version: 1, credentials: {} }), { mode: 0o666 });
    const store = new FileRegistryCredentialStore({ filePath });
    await expect(store.get("https://registry.example.test")).rejects.toMatchObject({ code: "AUTH_STORE_PERMISSIONS_INVALID" });
    await chmod(filePath, 0o600);
    await store.set("https://registry.example.test", { provider: "github", tokenType: "bearer", accessToken: "secret" });
    expect((await lstat(filePath)).mode & 0o777).toBe(0o600);
  });
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agentcargo-auth-store-test-"));
  temporaryDirectories.push(root);
  return root;
}
