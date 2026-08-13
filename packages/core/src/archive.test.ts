import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENTCARGO_ARTIFACT_FORMAT,
  AgentCargoArtifactError,
  extractArtifact,
  hashArtifact,
  normalizeArtifactPath,
  packSkillDirectory,
} from "./archive.js";
import { createSkillTemplate } from "./skill.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("packSkillDirectory", () => {
  it("matches the cross-platform digest vector for the checked-in example", async () => {
    const parent = await createTemporaryDirectory();
    const examplePath = fileURLToPath(
      new URL("../../../examples/hello-skill/", import.meta.url),
    );
    const result = await packSkillDirectory(examplePath, path.join(parent, "hello.agentcargo"));

    expect(result.digest).toBe(
      "sha256:f1b850b32edf57eeaa8eb07ec807e0a2f63b51805d87994e176c1c43ea08d523",
    );
  });

  it("produces identical canonical bytes despite creation order, timestamps, and modes", async () => {
    const parent = await createTemporaryDirectory();
    const firstSkill = await createSkillFixture(path.join(parent, "first", "repro-skill"), false);
    const secondSkill = await createSkillFixture(path.join(parent, "second", "repro-skill"), true);

    await utimes(path.join(firstSkill, "SKILL.md"), new Date(1_000), new Date(2_000));
    await utimes(path.join(secondSkill, "SKILL.md"), new Date(3_000), new Date(4_000));
    await chmod(path.join(firstSkill, "SKILL.md"), 0o600);
    await chmod(path.join(secondSkill, "SKILL.md"), 0o644);
    await chmod(path.join(firstSkill, "scripts", "run.sh"), 0o600);
    await chmod(path.join(secondSkill, "scripts", "run.sh"), 0o755);

    const first = await packSkillDirectory(firstSkill, path.join(parent, "first.agentcargo"));
    const second = await packSkillDirectory(secondSkill, path.join(parent, "second.agentcargo"));

    expect(first.format).toBe(AGENTCARGO_ARTIFACT_FORMAT);
    expect(first.digest).toBe(second.digest);
    expect(await readFile(first.artifactPath)).toEqual(await readFile(second.artifactPath));
    expect(first.files).toEqual([
      "SKILL.md",
      "agentcargo.yaml",
      "references/guide.md",
      "scripts/run.sh",
    ]);
    expect(first.artifactBytes % 512).toBe(0);
    expect(await hashArtifact(first.artifactPath)).toBe(first.digest);
  });

  it("requires AgentCargo metadata", async () => {
    const parent = await createTemporaryDirectory();
    const skill = path.join(parent, "native-skill");
    await mkdir(skill);
    const template = createSkillTemplate("native-skill", "A native skill without registry metadata.");
    await writeFile(path.join(skill, "SKILL.md"), template.skillMarkdown);

    await expect(packSkillDirectory(skill, path.join(parent, "native.agentcargo"))).rejects.toMatchObject({
      code: "AGENTCARGO_MANIFEST_REQUIRED",
    });
  });

  it("does not overwrite an existing artifact", async () => {
    const parent = await createTemporaryDirectory();
    const skill = await createSkillFixture(path.join(parent, "overwrite-skill"));
    const output = path.join(parent, "existing.agentcargo");
    await writeFile(output, "keep me");

    await expect(packSkillDirectory(skill, output)).rejects.toMatchObject({
      code: "ARTIFACT_ALREADY_EXISTS",
    });
    expect(await readFile(output, "utf8")).toBe("keep me");
  });

  it("rejects an output inside the skill directory", async () => {
    const parent = await createTemporaryDirectory();
    const skill = await createSkillFixture(path.join(parent, "inside-skill"));

    await expect(
      packSkillDirectory(skill, path.join(skill, "inside-skill.agentcargo")),
    ).rejects.toMatchObject({ code: "ARTIFACT_OUTPUT_INSIDE_SKILL" });
  });

  it.skipIf(process.platform === "win32")(
    "rejects an output whose parent link resolves inside the skill directory",
    async () => {
      const parent = await createTemporaryDirectory();
      const skill = await createSkillFixture(path.join(parent, "linked-output-skill"));
      const linkedParent = path.join(parent, "linked-parent");
      await symlink(skill, linkedParent, "dir");

      await expect(
        packSkillDirectory(skill, path.join(linkedParent, "output.agentcargo")),
      ).rejects.toMatchObject({ code: "ARTIFACT_OUTPUT_INSIDE_SKILL" });
    },
  );
});

describe("extractArtifact", () => {
  it("verifies the digest and round-trips package contents", async () => {
    const parent = await createTemporaryDirectory();
    const skill = await createSkillFixture(path.join(parent, "roundtrip-skill"));
    const packed = await packSkillDirectory(skill, path.join(parent, "roundtrip.agentcargo"));
    const destination = path.join(parent, "extracted");

    const extracted = await extractArtifact(packed.artifactPath, destination, {
      expectedDigest: packed.digest,
    });

    expect(extracted.digest).toBe(packed.digest);
    expect(extracted.files).toEqual(packed.files);
    for (const relativePath of packed.files) {
      expect(await readFile(path.join(destination, relativePath))).toEqual(
        await readFile(path.join(skill, relativePath)),
      );
    }

    if (process.platform !== "win32") {
      expect((await stat(path.join(destination, "SKILL.md"))).mode & 0o777).toBe(0o644);
      expect((await stat(path.join(destination, "scripts", "run.sh"))).mode & 0o777).toBe(0o755);
    }
  });

  it("checks an expected digest before creating the destination", async () => {
    const parent = await createTemporaryDirectory();
    const skill = await createSkillFixture(path.join(parent, "digest-skill"));
    const packed = await packSkillDirectory(skill, path.join(parent, "digest.agentcargo"));
    const destination = path.join(parent, "not-created");

    await expect(
      extractArtifact(packed.artifactPath, destination, { expectedDigest: `sha256:${"0".repeat(64)}` }),
    ).rejects.toMatchObject({ code: "ARTIFACT_DIGEST_MISMATCH" });
    await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects traversal paths without writing outside the destination", async () => {
    const parent = await createTemporaryDirectory();
    const artifact = path.join(parent, "traversal.agentcargo");
    await writeFile(artifact, createRawTar([{ path: "../escaped.txt", content: "no" }]));
    const destination = path.join(parent, "destination");

    await expect(extractArtifact(artifact, destination)).rejects.toMatchObject({
      code: "ARTIFACT_PATH_TRAVERSAL",
    });
    await expect(stat(path.join(parent, "escaped.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsupported link entries", async () => {
    const parent = await createTemporaryDirectory();
    const artifact = path.join(parent, "link.agentcargo");
    await writeFile(artifact, createRawTar([{ path: "link", content: "", type: "2" }]));

    await expect(extractArtifact(artifact, path.join(parent, "destination"))).rejects.toMatchObject({
      code: "ARTIFACT_ENTRY_TYPE_UNSUPPORTED",
    });
  });

  it("rejects a mode that does not match the entry path", async () => {
    const parent = await createTemporaryDirectory();
    const artifact = path.join(parent, "mode.agentcargo");
    await writeFile(
      artifact,
      createRawTar([{ path: "SKILL.md", content: "skill", mode: 0o755 }]),
    );

    await expect(extractArtifact(artifact, path.join(parent, "destination"))).rejects.toMatchObject({
      code: "ARTIFACT_MODE_INVALID",
    });
  });

  it("rejects case-insensitive collisions", async () => {
    const parent = await createTemporaryDirectory();
    const artifact = path.join(parent, "collision.agentcargo");
    await writeFile(
      artifact,
      createRawTar([
        { path: "A.txt", content: "first" },
        { path: "SKILL.md", content: "skill" },
        { path: "a.txt", content: "second" },
        { path: "agentcargo.yaml", content: "manifest" },
      ]),
    );

    await expect(extractArtifact(artifact, path.join(parent, "destination"))).rejects.toMatchObject({
      code: "ARTIFACT_PATH_COLLISION",
    });
  });

  it("cleans files created before a truncated artifact fails", async () => {
    const parent = await createTemporaryDirectory();
    const skill = await createSkillFixture(path.join(parent, "truncated-skill"));
    const packed = await packSkillDirectory(skill, path.join(parent, "complete.agentcargo"));
    const complete = await readFile(packed.artifactPath);
    const artifact = path.join(parent, "truncated.agentcargo");
    await writeFile(artifact, complete.subarray(0, complete.length - 600));
    const destination = path.join(parent, "destination");

    await expect(extractArtifact(artifact, destination)).rejects.toBeInstanceOf(AgentCargoArtifactError);
    expect(await readdir(destination)).toEqual([]);
  });
});

describe("normalizeArtifactPath", () => {
  it.each([
    ["../escape", "ARTIFACT_PATH_TRAVERSAL"],
    ["/absolute", "ARTIFACT_PATH_ABSOLUTE"],
    ["C:/windows", "ARTIFACT_PATH_ABSOLUTE"],
    ["dir\\file", "ARTIFACT_PATH_SEPARATOR_INVALID"],
    ["folder//file", "ARTIFACT_PATH_TRAVERSAL"],
    ["folder/CON.txt", "ARTIFACT_PATH_NOT_PORTABLE"],
    ["folder/file?.txt", "ARTIFACT_PATH_NOT_PORTABLE"],
  ])("rejects unsafe path %s", (candidate, code) => {
    expect(() => normalizeArtifactPath(candidate)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("accepts a normalized portable relative path", () => {
    expect(normalizeArtifactPath("references/example-guide.md")).toBe(
      "references/example-guide.md",
    );
  });

  it("rejects generated traversal variants", () => {
    for (let depth = 1; depth <= 200; depth += 1) {
      const candidate = `${Array.from({ length: depth }, () => "safe").join("/")}/../escape`;
      expect(() => normalizeArtifactPath(candidate)).toThrowError(
        expect.objectContaining({ code: "ARTIFACT_PATH_TRAVERSAL" }),
      );
    }
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "agentcargo-archive-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createSkillFixture(skillPath: string, reverse = false): Promise<string> {
  await mkdir(skillPath, { recursive: true });
  const template = createSkillTemplate(
    path.basename(skillPath),
    "Packages a deterministic skill for archive tests.",
  );
  const files: Array<[string, string]> = [
    ["SKILL.md", template.skillMarkdown],
    ["agentcargo.yaml", template.manifestYaml],
    ["references/guide.md", "# Guide\n\nUse the guide when more detail is needed.\n"],
    ["scripts/run.sh", "#!/bin/sh\nprintf 'agentcargo test\\n'\n"],
  ];
  if (reverse) files.reverse();

  for (const [relativePath, content] of files) {
    const absolutePath = path.join(skillPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return skillPath;
}

interface RawTarEntry {
  path: string;
  content: string;
  type?: "0" | "2";
  mode?: number;
}

function createRawTar(entries: RawTarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  const sorted = [...entries].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
  );

  for (const entry of sorted) {
    const content = Buffer.from(entry.content);
    const header = Buffer.alloc(512);
    writeRawString(header, entry.path, 0, 100);
    writeRawOctal(header, entry.mode ?? (entry.path.startsWith("scripts/") ? 0o755 : 0o644), 100, 8);
    writeRawOctal(header, 0, 108, 8);
    writeRawOctal(header, 0, 116, 8);
    writeRawOctal(header, content.length, 124, 12);
    writeRawOctal(header, 0, 136, 12);
    header.fill(0x20, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    writeRawString(header, "ustar\0", 257, 6);
    writeRawString(header, "00", 263, 2);
    writeRawOctal(header, 0, 329, 8);
    writeRawOctal(header, 0, 337, 8);
    const checksum = header.reduce((total, byte) => total + byte, 0);
    writeRawString(header, `${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
    blocks.push(header, content);

    const padding = (512 - (content.length % 512)) % 512;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }

  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function writeRawString(buffer: Buffer, value: string, offset: number, width: number): void {
  const encoded = Buffer.from(value);
  if (encoded.length > width) throw new Error("Raw TAR test value is too long.");
  encoded.copy(buffer, offset);
}

function writeRawOctal(buffer: Buffer, value: number, offset: number, width: number): void {
  writeRawString(buffer, `${value.toString(8).padStart(width - 1, "0")}\0`, offset, width);
}
