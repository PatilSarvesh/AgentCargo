import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { createSkillTemplate, normalizeSkillName, validateSkillDirectory } from "./skill.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("normalizeSkillName", () => {
  it("normalizes a human title into an Agent Skills name", () => {
    expect(normalizeSkillName(" React  Code Reviewer ")).toBe("react-code-reviewer");
  });
});

describe("createSkillTemplate", () => {
  it("creates matching native and AgentCargo metadata", () => {
    const template = createSkillTemplate(
      "React Reviewer",
      "Reviews React changes: use when a request includes #react.",
    );

    expect(template.name).toBe("react-reviewer");
    expect(template.skillMarkdown).toContain("name: react-reviewer");
    expect(template.skillMarkdown).toContain(
      'description: "Reviews React changes: use when a request includes #react."',
    );
    expect(template.manifestYaml).toContain("version: 0.1.0");
  });
});

describe("validateSkillDirectory", () => {
  it("accepts a valid instruction-only skill", async () => {
    const skillDirectory = await createFixture("hello-skill");
    const template = createSkillTemplate(
      "hello-skill",
      "Greets users: use when a request includes #welcome.",
    );
    await writeFile(path.join(skillDirectory, "SKILL.md"), template.skillMarkdown);
    await writeFile(path.join(skillDirectory, "agentcargo.yaml"), template.manifestYaml);

    const result = await validateSkillDirectory(skillDirectory);

    expect(result.valid).toBe(true);
    expect(result.skillName).toBe("hello-skill");
    expect(result.manifest?.version).toBe("0.1.0");
    expect(result.findings).toEqual([]);
  });

  it("allows a native skill without AgentCargo metadata but warns that it cannot be published", async () => {
    const skillDirectory = await createFixture("native-skill");
    const template = createSkillTemplate("native-skill", "Demonstrates a native skill.");
    await writeFile(path.join(skillDirectory, "SKILL.md"), template.skillMarkdown);

    const result = await validateSkillDirectory(skillDirectory);

    expect(result.valid).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "AGENTCARGO_MANIFEST_MISSING",
        severity: "warning",
      }),
    );
  });

  it("rejects a skill whose name does not match its directory", async () => {
    const skillDirectory = await createFixture("actual-directory");
    const template = createSkillTemplate("different-name", "Has a mismatched name.");
    await writeFile(path.join(skillDirectory, "SKILL.md"), template.skillMarkdown);
    await writeFile(path.join(skillDirectory, "agentcargo.yaml"), template.manifestYaml);

    const result = await validateSkillDirectory(skillDirectory);

    expect(result.valid).toBe(false);
    expect(result.findings.map((item) => item.code)).toContain("SKILL_DIRECTORY_NAME_MISMATCH");
  });

  it("reports a missing SKILL.md", async () => {
    const skillDirectory = await createFixture("empty-skill");

    const result = await validateSkillDirectory(skillDirectory);

    expect(result.valid).toBe(false);
    expect(result.findings.map((item) => item.code)).toContain("SKILL_MD_MISSING");
  });
});

async function createFixture(name: string): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), "agentcargo-test-"));
  temporaryDirectories.push(parent);
  const skillDirectory = path.join(parent, name);
  await mkdir(skillDirectory);
  return skillDirectory;
}
