import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCliRelease, verifyCliRelease } from "./release-artifacts.js";

const workspaceRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("signed CLI release artifacts", () => {
  it("builds a deterministic bundle and verifies its Ed25519 manifest signature", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentcargo-release-test-"));
    temporaryDirectories.push(root);
    const firstOutput = path.join(root, "first");
    const secondOutput = path.join(root, "second");
    const keyPair = generateKeyPairSync("ed25519");
    const privateKey = String(keyPair.privateKey.export({ type: "pkcs8", format: "pem" }));
    const publicKey = String(keyPair.publicKey.export({ type: "spki", format: "pem" }));
    const first = await buildCliRelease({ workspaceRoot, outputDirectory: firstOutput, privateKey, sourceCommit: "deadbeef" });
    const second = await buildCliRelease({ workspaceRoot, outputDirectory: secondOutput, privateKey, sourceCommit: "deadbeef" });

    expect(await readFile(first.archivePath)).toEqual(await readFile(second.archivePath));
    expect(await readFile(first.manifestPath, "utf8")).toBe(await readFile(second.manifestPath, "utf8"));
    expect(await readFile(first.signaturePath, "utf8")).toBe(await readFile(second.signaturePath, "utf8"));

    const verified = await verifyCliRelease({
      archivePath: first.archivePath,
      manifestPath: first.manifestPath,
      signaturePath: first.signaturePath,
      publicKey,
    });
    expect(verified).toMatchObject({ version: "0.1.0", archiveDigest: first.archiveDigest, bytes: first.bytes });
    const manifest = JSON.parse(await readFile(first.manifestPath, "utf8")) as { packages: Array<{ name: string }>; format: string };
    expect(manifest.format).toBe("agentcargo-cli-ustar-v1");
    expect(manifest.packages.map((item) => item.name)).toEqual([
      "@agentcargo/adapter-claude-code",
      "@agentcargo/adapter-codex",
      "@agentcargo/adapter-contract",
      "@agentcargo/cli",
      "@agentcargo/core",
      "@agentcargo/registry-client",
      "@agentcargo/registry-contract",
    ]);
  });

  it("rejects an archive changed after signing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentcargo-release-test-"));
    temporaryDirectories.push(root);
    const keyPair = generateKeyPairSync("ed25519");
    const privateKey = String(keyPair.privateKey.export({ type: "pkcs8", format: "pem" }));
    const publicKey = String(keyPair.publicKey.export({ type: "spki", format: "pem" }));
    const result = await buildCliRelease({ workspaceRoot, outputDirectory: root, privateKey });
    await writeFile(result.archivePath, Buffer.concat([await readFile(result.archivePath), Buffer.from("tampered")]), { flag: "w" });

    await expect(verifyCliRelease({
      archivePath: result.archivePath,
      manifestPath: result.manifestPath,
      signaturePath: result.signaturePath,
      publicKey,
    })).rejects.toThrow("archive digest or byte count");
  });
});
