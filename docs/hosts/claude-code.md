# Claude Code Host Contract

- Host identifier: `claude-code`
- Adapter package: `@agentcargo/adapter-claude-code` version `0.1.0`
- Contract status: implemented and covered by the shared adapter contract suite
- Documentation last verified: 2026-08-13
- First-party documentation: [Extend Claude with skills](https://code.claude.com/docs/en/slash-commands)
- Supplemental test surface: [Agent Skills in the Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/skills)

## Supported source contract

Claude Code states that its skills follow the Agent Skills open standard. Each skill is a directory with a `SKILL.md` entry point and may include referenced files, scripts, templates, examples, or other resources.

AgentCargo's stricter portable package validation remains the publication baseline:

- A root `SKILL.md` is required.
- `name` and `description` are required and follow the open standard limits.
- The name matches the containing skill directory.
- Links and special files are rejected from AgentCargo artifacts.
- `agentcargo.yaml` is registry metadata and is not installed into the host-ready skill.

Claude Code accepts additional vendor fields and behavior, including invocation controls, subagent execution, argument substitution, and dynamic context injection. AgentCargo may preserve publisher-authored fields, but their presence is not proof that another host supports them.

## Destination contract

| AgentCargo scope | Claude Code location | Adapter scope root | Portable lockfile destination |
| --- | --- | --- | --- |
| `project` | `<project-root>/.claude/skills/<name>/SKILL.md` | Canonical project root | `.claude/skills/<name>` |
| `user` | `<user-home>/.claude/skills/<name>/SKILL.md` | Canonical user home | `.claude/skills/<name>` |

Claude Code can also discover project skills from parent and nested directories. AgentCargo v0.1 deliberately installs only at the explicit selected project root. It does not infer nested package roots, write to parent repositories, use Claude Code's plugin hierarchy, or install legacy `.claude/commands` files.

The adapter will vendor a real skill directory, not a link or central-cache pointer. It will reuse core's safe extraction, staging, atomic activation, receipt, drift, and removal transactions.

## Compatibility and transformation

The adapter will require an explicit manifest declaration:

```yaml
compatibility:
  claude-code:
    scopes:
      - project
      - user
```

The planned host transformation is limited to removing the registry-only root `agentcargo.yaml`. The adapter will not rewrite `SKILL.md`, generate Claude-specific metadata, or execute scripts and injected commands during installation.

## Trust interpretation

- `allowed-tools` is host-specific pre-approval behavior, not a portable deny policy and not a sandbox enforced by AgentCargo.
- Claude Code documents dynamic context syntax that can run commands when a skill is activated. AgentCargo never runs this syntax during validation, packing, scanning, or installation; future static rules should present it as observed executable behavior.
- Claude Code workspace trust and permission settings belong to the host. They must not be presented as AgentCargo enforcement.
- The skill directory remains readable by the invoking user and by host tools with filesystem access.

## Detection and health checks

Filesystem installation does not require starting Claude Code. Initial detection should therefore:

- Resolve and validate the requested project root or user home without following linked destination components.
- Report the applicable `.claude/skills` root.
- Treat an available `claude` executable or existing `.claude` directory as informational evidence, not a prerequisite for installation.
- Keep detection read-only.

Health checks should validate scope-root availability and destination containment. They should not authenticate, call a model, alter Claude settings, or claim that Claude has loaded the skill.

## Verification evidence

The adapter implementation is covered by:

1. Unit tests cover both scope destinations, missing roots, invalid names, compatibility declarations, and transformation of staged packages.
2. The shared adapter contract suite exercises installation destinations, detection, staging, and diagnostics for Codex and Claude Code.
3. CLI integration tests install, list, diagnose, and remove the checked-in fixture through Claude Code.
4. Tests prove that no Claude path exists in generic core installation logic.
5. The documentation URL and verification date are recorded in adapter metadata.

An authenticated Claude Code or Agent SDK discovery smoke test remains optional because it requires credentials and is not a normal CI requirement.
