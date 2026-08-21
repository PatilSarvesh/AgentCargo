import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanSkillDirectory } from "./scanner.js";
import { validateSkillDirectory } from "./skill.js";

type StarterCatalog = {
  catalogVersion: number;
  maintainer: string;
  reviewedAt: string;
  installPolicy: string;
  skills: Array<{
    name: string;
    version: string;
    description: string;
    tags: string[];
    hosts: Record<string, string[]>;
  }>;
};

const starterRoot = fileURLToPath(new URL("../../../examples/starter-skills/", import.meta.url));

describe("maintained starter skills", () => {
  it("keeps the curated catalog in sync with valid, clean fixtures", async () => {
    const catalog = JSON.parse(await readFile(path.join(starterRoot, "catalog.json"), "utf8")) as StarterCatalog;
    expect(catalog).toMatchObject({
      catalogVersion: 1,
      maintainer: "AgentCargo Maintainers",
      installPolicy: "explicit-selection",
    });
    expect(catalog.skills.length).toBe(10);

    const directories = (await readdir(starterRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories).toEqual(catalog.skills.map((skill) => skill.name).sort());

    for (const skill of catalog.skills) {
      const root = path.join(starterRoot, skill.name);
      const validation = await validateSkillDirectory(root);
      expect(validation.valid, `${skill.name} validation`).toBe(true);
      expect(validation.findings, `${skill.name} validation findings`).toEqual([]);
      expect(validation.manifest).toMatchObject({ name: skill.name, version: skill.version, description: skill.description });
      expect(validation.manifest?.compatibility).toEqual({
        codex: { scopes: ["project", "user"] },
        "claude-code": { scopes: ["project", "user"] },
      });
      expect(validation.manifest?.capabilities).toMatchObject({
        filesystem: { read: true, write: false },
        shell: false,
        network: false,
        environment: [],
      });

      const scan = await scanSkillDirectory(root, { now: () => new Date("2026-08-20T00:00:00.000Z") });
      expect(scan.valid, `${skill.name} static scan`).toBe(true);
      expect(scan.findings, `${skill.name} static findings`).toEqual([]);
    }
  });
});
