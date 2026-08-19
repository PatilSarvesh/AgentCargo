# ADR 0005: Claude Code as the Second Host

- Status: Accepted
- Date: 2026-08-13
- Decision owners: AgentCargo maintainers

## Context

AgentCargo's MVP must prove that one source skill can be installed into Codex and a second host without leaking vendor paths into core logic. The second host should have meaningful user demand, a current and stable filesystem contract, first-party documentation, and a practical automated test strategy.

Candidates were evaluated using first-party evidence available on 2026-08-13. Download counts and vendor-wide usage are imperfect proxies for Agent Skills demand, so the comparison is directional rather than a numerical market ranking.

| Candidate | Demand evidence | Skill-contract stability | Automated testability | Main concern |
| --- | --- | --- | --- | --- |
| Claude Code | Anthropic reported rapid paid, weekly-active, and enterprise growth in 2026. | First-party docs state that skills follow the Agent Skills standard and document dedicated project and user paths. | Filesystem contract tests are deterministic; the Agent SDK exposes skill discovery for an optional authenticated smoke test. | Host-specific frontmatter and dynamic command injection require careful trust messaging. |
| GitHub Copilot | Copilot spans GitHub, CLI, code review, VS Code, and JetBrains; GitHub reported more than 60 million Copilot code reviews. | First-party docs support the standard and multiple project/user locations. | Strong CLI and filesystem test options. | `gh skill` is still public preview, and its `.agents/skills` alias exercises little new adapter behavior beyond Codex. |
| Gemini CLI | Google reported more than one million developers within three months of launch. | First-party docs now define workspace/user skills and `.agents/skills` aliases. | Open-source CLI and non-interactive management make strong tests feasible. | The documented Agent Skills surface is newer than Claude Code's contract. |
| Cursor | First-party docs define project/user skills, native directories, aliases, and headless CLI support. | The documented contract is broad and current. | Filesystem tests are straightforward; full product smoke tests are less portable. | Public, comparable demand evidence is limited and native aliases again overlap Codex's paths. |

Sources:

- [Claude Code skill documentation](https://code.claude.com/docs/en/slash-commands)
- [Claude Code adoption evidence](https://www.anthropic.com/news/anthropic-raises-30-billion-series-g-funding-380-billion-post-money-valuation)
- [GitHub Copilot Agent Skills documentation](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [GitHub Copilot code-review adoption evidence](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [Gemini CLI Agent Skills documentation](https://geminicli.com/docs/cli/using-agent-skills/)
- [Gemini CLI adoption evidence](https://blog.google/technology/developers/gemini-cli-extensions/)
- [Cursor Agent Skills documentation](https://cursor.com/docs/skills)

## Decision

Claude Code is the second MVP host. The adapter identifier will be `claude-code` and the first-party package will be `@agentcargo/adapter-claude-code`.

The verified host contract is recorded in [the Claude Code host contract](../hosts/claude-code.md). Its initial adapter will support both project and user scopes through Claude Code's dedicated `.claude/skills` roots.

Selection does not imply that AgentCargo will generate or depend on Claude-specific extensions. Portable standard fields and package files pass through unchanged. Host extensions already present in a publisher's `SKILL.md` remain untrusted source content and are not described as portable or AgentCargo-enforced behavior.

## Consequences

Benefits:

- The second adapter exercises a genuinely different destination hierarchy from Codex.
- Both selected hosts accept the same core `SKILL.md` package structure.
- Clear first-party project and user paths support deterministic contract tests.
- Strong current adoption makes the adapter relevant to the target audience.

Tradeoffs:

- A fully authenticated live-host test needs Claude credentials and cannot gate ordinary pull requests.
- Claude Code extends the open standard; AgentCargo must distinguish portable fields from vendor behavior.
- Gemini CLI, GitHub Copilot, and Cursor remain unsupported until later adapters are implemented.

The decision must be rechecked if Claude Code changes its discovery paths, removes standard compatibility, or becomes impractical to test. Host documentation provenance and the last verified date belong in adapter metadata and tests.
