import { describe, expect, it } from "vitest";
import { defineAdapterContractTests } from "@agentcargo/adapter-contract/test-suite";
import {
  CLAUDE_CODE_ADAPTER_VERSION,
  CLAUDE_CODE_DOCUMENTATION_LAST_VERIFIED,
  CLAUDE_CODE_SKILLS_DOCUMENTATION_URL,
  ClaudeCodeAdapter,
} from "./index.js";

defineAdapterContractTests({
  createAdapter: () => new ClaudeCodeAdapter(),
  expectedSkillsDirectory: ".claude/skills",
  compatibilityNotDeclaredCode: "CLAUDE_CODE_COMPATIBILITY_NOT_DECLARED",
  scopeNotDeclaredCode: "CLAUDE_CODE_SCOPE_NOT_DECLARED",
  skillRequiredCode: "CLAUDE_CODE_SKILL_MD_REQUIRED",
  stagedSkillInvalidCode: "CLAUDE_CODE_STAGED_SKILL_INVALID",
  projectRootInvalidCode: "CLAUDE_CODE_PROJECT_ROOT_INVALID",
});

describe("ClaudeCodeAdapter metadata", () => {
  it("records the selected adapter provenance", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.id).toBe("claude-code");
    expect(adapter.adapterVersion).toBe(CLAUDE_CODE_ADAPTER_VERSION);
    expect(adapter.documentationUrl).toBe(CLAUDE_CODE_SKILLS_DOCUMENTATION_URL);
    expect(adapter.documentationLastVerified).toBe(CLAUDE_CODE_DOCUMENTATION_LAST_VERIFIED);
  });
});
