import { describe, expect, it } from "vitest";
import { AgentCargoUpdatePreviewError, createUpdatePreview } from "./update-preview.js";
import type { UpdatePackageSnapshot } from "./update-preview.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

describe("createUpdatePreview", () => {
  it("reports version, file, script, capability, dependency, manifest, and finding changes", () => {
    const current: UpdatePackageSnapshot = {
      package: "@acme/review",
      version: "1.0.0",
      digest: digest("a"),
      files: [
        { path: "SKILL.md", digest: digest("1"), bytes: 100, mode: 0o644 },
        { path: "references/old.md", digest: digest("2"), bytes: 20, mode: 0o644 },
        { path: "scripts/check.sh", digest: digest("3"), bytes: 30, mode: 0o755 },
      ],
      declared: {
        description: "Review changes.",
        tags: ["review"],
        compatibility: { codex: { scopes: ["project"] } },
        capabilities: { filesystem: { read: true, write: false }, network: false },
        dependencies: ["git>=2.40", "node>=20"],
      },
      findings: [finding("AGENTCARGO-NETWORK-REFERENCE", "warning", "SKILL.md")],
    };
    const target: UpdatePackageSnapshot = {
      package: "@acme/review",
      version: "2.0.0",
      digest: digest("b"),
      files: [
        { path: "SKILL.md", digest: digest("4"), bytes: 120, mode: 0o644 },
        { path: "references/new.md", digest: digest("5"), bytes: 25, mode: 0o644 },
        { path: "scripts/check.sh", digest: digest("6"), bytes: 35, mode: 0o755 },
        { path: "scripts/new.py", digest: digest("7"), bytes: 12, mode: 0o644 },
      ],
      declared: {
        description: "Review and explain changes.",
        tags: ["review", "explain"],
        compatibility: { codex: { scopes: ["project", "user"] } },
        capabilities: { filesystem: { read: true, write: true }, network: false },
        dependencies: ["git>=2.40", "python>=3.12"],
      },
      findings: [
        finding("AGENTCARGO-NETWORK-REFERENCE", "error", "SKILL.md"),
        finding("AGENTCARGO-SCRIPT-FILE", "info", "scripts/new.py"),
      ],
    };

    const preview = createUpdatePreview(current, target);

    expect(preview).toMatchObject({
      package: "@acme/review",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      changed: true,
      versionChanged: true,
      digestChanged: true,
      files: {
        added: [{ path: "references/new.md" }, { path: "scripts/new.py" }],
        removed: [{ path: "references/old.md" }],
        modified: [
          { path: "SKILL.md", contentChanged: true, sizeChanged: true, modeChanged: false },
          { path: "scripts/check.sh", contentChanged: true, sizeChanged: true, modeChanged: false },
        ],
      },
      scripts: {
        added: ["scripts/new.py"],
        removed: [],
        modified: ["scripts/check.sh"],
      },
      capabilities: [{ path: "filesystem.write", before: false, after: true }],
      dependencies: { added: ["python>=3.12"], removed: ["node>=20"] },
      manifest: [
        { field: "description", before: "Review changes.", after: "Review and explain changes." },
        { field: "tags", before: ["review"], after: ["review", "explain"] },
        { field: "compatibility" },
      ],
      findings: {
        added: [{ ruleId: "AGENTCARGO-SCRIPT-FILE", path: "scripts/new.py" }],
        resolved: [],
        changed: [{ ruleId: "AGENTCARGO-NETWORK-REFERENCE", path: "SKILL.md" }],
      },
    });
  });

  it("reports resolved findings, removed scripts, and permission-only file changes", () => {
    const preview = createUpdatePreview({
      package: "review",
      version: "1.0.0",
      digest: digest("a"),
      files: [{ path: "tools/run", digest: digest("1"), bytes: 10, mode: 0o755 }],
      findings: [finding("AGENTCARGO-SCRIPT-FILE", "info", "tools/run")],
    }, {
      package: "review",
      version: "1.0.1",
      digest: digest("b"),
      files: [{ path: "tools/run", digest: digest("1"), bytes: 10, mode: 0o644 }],
      findings: [],
    });

    expect(preview.files.modified).toEqual([
      expect.objectContaining({ path: "tools/run", contentChanged: false, sizeChanged: false, modeChanged: true }),
    ]);
    expect(preview.scripts).toEqual({ added: [], removed: ["tools/run"], modified: ["tools/run"] });
    expect(preview.findings.resolved).toEqual([
      expect.objectContaining({ ruleId: "AGENTCARGO-SCRIPT-FILE", path: "tools/run" }),
    ]);
  });

  it("returns a stable no-change preview", () => {
    const snapshot: UpdatePackageSnapshot = {
      package: "review",
      version: "1.0.0",
      digest: digest("a"),
      files: [{ path: "SKILL.md", digest: digest("1"), bytes: 100, mode: 0o644 }],
      declared: { capabilities: {}, dependencies: [] },
      findings: [],
    };

    expect(createUpdatePreview(snapshot, structuredClone(snapshot))).toMatchObject({
      changed: false,
      versionChanged: false,
      digestChanged: false,
      files: { added: [], removed: [], modified: [] },
      scripts: { added: [], removed: [], modified: [] },
      capabilities: [],
      dependencies: { added: [], removed: [] },
      manifest: [],
      findings: { added: [], resolved: [], changed: [] },
    });
  });

  it("rejects mismatched packages and ambiguous file snapshots", () => {
    const base: UpdatePackageSnapshot = {
      package: "review",
      version: "1.0.0",
      digest: digest("a"),
      files: [{ path: "SKILL.md", digest: digest("1"), bytes: 100, mode: 0o644 }],
    };
    expect(() => createUpdatePreview(base, { ...base, package: "other" })).toThrowError(
      expect.objectContaining<Partial<AgentCargoUpdatePreviewError>>({ code: "UPDATE_PREVIEW_PACKAGE_MISMATCH" }),
    );
    expect(() => createUpdatePreview(base, {
      ...base,
      files: [base.files[0]!, { ...base.files[0]!, path: "skill.md" }],
    })).toThrowError(
      expect.objectContaining<Partial<AgentCargoUpdatePreviewError>>({ code: "UPDATE_PREVIEW_FILE_CASE_COLLISION" }),
    );
  });
});

function finding(
  ruleId: string,
  severity: "info" | "warning" | "error",
  findingPath: string,
) {
  return {
    ruleId,
    ruleVersion: "1",
    severity,
    path: findingPath,
    message: `${ruleId} message`,
    explanation: `${ruleId} explanation`,
    remediation: `${ruleId} remediation`,
  };
}
