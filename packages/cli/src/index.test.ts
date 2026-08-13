import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { program } from "./index.js";

const exampleSkill = fileURLToPath(new URL("../../../examples/hello-skill", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("agentcargo pack", () => {
  it("returns a stable JSON error when the output already exists", async () => {
    const root = await createTemporaryDirectory();
    const output = path.join(root, "existing.agentcargo");
    await writeFile(output, "existing", "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await program.parseAsync([
      "node",
      "agentcargo",
      "pack",
      exampleSkill,
      "--output",
      output,
      "--json",
    ]);

    expect(process.exitCode).toBe(1);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_ALREADY_EXISTS" },
    });
  });
});

describe("agentcargo add", () => {
  it("installs a local skill into an isolated Codex project", async () => {
    const root = await createTemporaryDirectory();
    const projectRoot = path.join(root, "project");
    await mkdir(projectRoot);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await program.parseAsync([
      "node",
      "agentcargo",
      "add",
      exampleSkill,
      "--agent",
      "codex",
      "--scope",
      "project",
      "--project-root",
      projectRoot,
      "--json",
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      package: "hello-skill",
      agent: "codex",
      scope: "project",
    });
    expect(
      await readFile(path.join(projectRoot, ".agents", "skills", "hello-skill", "SKILL.md"), "utf8"),
    ).toContain("name: hello-skill");
    expect(await readFile(path.join(projectRoot, "agentcargo.lock"), "utf8")).toContain(
      "lockfile_version: 1",
    );
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agentcargo-cli-test-"));
  temporaryDirectories.push(root);
  return root;
}
