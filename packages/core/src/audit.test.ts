import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAdapter } from "@agentcargo/adapter-codex";
import { auditInstallations } from "./audit.js";
import { installLocalSkill } from "./install.js";
import { createSkillTemplate } from "./skill.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("auditInstallations", () => {
  it("verifies a clean receipt, reports the retained artifact digest, and scans host-ready files", async () => {
    const fixture = await createFixture("clean-audit");

    const result = await auditInstallations(fixture.lifecycle, {
      now: () => new Date("2026-08-19T04:00:00.000Z"),
    });

    expect(result).toMatchObject({
      auditedAt: "2026-08-19T04:00:00.000Z",
      passed: true,
      summary: { installations: 1, clean: 1, drifted: 0, errors: 0 },
      installations: [{
        package: "clean-audit",
        state: "clean",
        artifactIntegrity: { status: "recorded", digest: fixture.install.digest },
        receiptIntegrity: { status: "verified", expectedDigest: fixture.install.filesDigest },
        scanner: {
          status: "completed",
          scannerVersion: "rules-1",
          findings: [{ ruleId: "AGENTCARGO-SCRIPT-FILE", path: "scripts/check.sh" }],
        },
      }],
    });
    expect(result.installations[0]?.scanner.findings.map((finding) => finding.ruleId)).not.toContain(
      "AGENTCARGO-PACKAGE-INVALID",
    );
    await expect(readFile(path.join(fixture.install.destination, "agentcargo.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports modified, missing, and untracked paths with remediation", async () => {
    const fixture = await createFixture("drift-audit");
    await writeFile(path.join(fixture.install.destination, "SKILL.md"), "changed locally\n");
    await unlink(path.join(fixture.install.destination, "references", "guide.md"));
    await writeFile(path.join(fixture.install.destination, "local.txt"), "untracked\n");

    const result = await auditInstallations(fixture.lifecycle);
    const audit = result.installations[0]!;

    expect(result.passed).toBe(false);
    expect(result.summary).toMatchObject({ clean: 0, drifted: 1 });
    expect(audit.state).toBe("modified");
    expect(audit.receiptIntegrity.status).toBe("mismatch");
    expect(audit.scanner.status).toBe("completed");
    expect(audit.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "AUDIT_FILE_MODIFIED",
      "AUDIT_FILE_MISSING",
      "AUDIT_PATH_UNTRACKED",
      "AUDIT_RECEIPT_DIGEST_MISMATCH",
    ]));
    expect(audit.findings.every((finding) => finding.remediation.length > 0)).toBe(true);
  });

  it("reports a missing destination and skips static scanning", async () => {
    const fixture = await createFixture("missing-audit");
    await rm(fixture.install.destination, { recursive: true });

    const result = await auditInstallations(fixture.lifecycle);

    expect(result.passed).toBe(false);
    expect(result.installations[0]).toMatchObject({
      state: "missing",
      receiptIntegrity: { status: "unavailable" },
      scanner: { status: "skipped" },
    });
    expect(result.installations[0]?.findings.map((finding) => finding.code)).toContain("AUDIT_FILE_MISSING");
  });

  it.skipIf(process.platform === "win32")(
    "reports invalid linked paths without scanning their targets",
    async () => {
      const fixture = await createFixture("invalid-audit");
      const outside = path.join(fixture.root, "outside.txt");
      await writeFile(outside, "curl https://outside.example.test/secret\n");
      await symlink(outside, path.join(fixture.install.destination, "outside-link"), "file");

      const result = await auditInstallations(fixture.lifecycle);
      const audit = result.installations[0]!;

      expect(result.passed).toBe(false);
      expect(audit.state).toBe("invalid");
      expect(audit.scanner).toMatchObject({ status: "skipped", findings: [] });
      expect(audit.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "AUDIT_PATH_INVALID", path: "outside-link" }),
      ]));
      expect(audit.findings.map((finding) => finding.code)).not.toContain("AGENTCARGO-NETWORK-REFERENCE");
    },
  );

  it("reports orphaned operation paths as recovery findings", async () => {
    const fixture = await createFixture("recovery-audit");
    await mkdir(path.join(path.dirname(fixture.install.destination), ".agentcargo-update-orphan"));

    const result = await auditInstallations(fixture.lifecycle);

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "AUDIT_ABANDONED_UPDATE",
        category: "recovery",
        severity: "warning",
      }),
    ]));
    expect(result.findings[0]?.remediation).toContain("Inspect");
  });
});

async function createFixture(name: string) {
  const root = await mkdtemp(path.join(tmpdir(), "agentcargo-audit-test-"));
  temporaryDirectories.push(root);
  const projectRoot = path.join(root, "project");
  const userHome = path.join(root, "home");
  const skillRoot = path.join(root, "source", name);
  await Promise.all([mkdir(projectRoot), mkdir(userHome), mkdir(skillRoot, { recursive: true })]);
  const template = createSkillTemplate(name, "Audit fixture.");
  await writeFile(path.join(skillRoot, "SKILL.md"), template.skillMarkdown);
  await writeFile(path.join(skillRoot, "agentcargo.yaml"), template.manifestYaml);
  await mkdir(path.join(skillRoot, "references"));
  await writeFile(path.join(skillRoot, "references", "guide.md"), "# Guide\n");
  await mkdir(path.join(skillRoot, "scripts"));
  await writeFile(path.join(skillRoot, "scripts", "check.sh"), "#!/bin/sh\necho checked\n", { mode: 0o755 });
  const lifecycle = {
    adapter: new CodexAdapter(),
    scope: "project" as const,
    context: { projectRoot, userHome },
  };
  const install = await installLocalSkill({ ...lifecycle, sourcePath: skillRoot });
  return { root, lifecycle, install };
}
