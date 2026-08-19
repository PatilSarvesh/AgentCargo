# Host adapter development

AgentCargo adapters isolate host-specific filesystem and compatibility behavior from the generic package core. A new adapter must prove that a portable skill can be validated, staged, installed, inspected, diagnosed, and removed without adding host paths to `@agentcargo/core` or the generic CLI transaction code.

This guide describes the current first-party adapter boundary. It applies to the built-in Codex and Claude Code adapters and is the template for future third-party adapters.

## Package shape

Use one package per host. The current package names are:

```text
@agentcargo/adapter-codex
@agentcargo/adapter-claude-code
@agentcargo/adapter-<host-id>
```

A package should follow this layout:

```text
packages/adapter-<host-id>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    └── index.test.ts
```

The package should expose its adapter from `src/index.ts`, compile to `dist`, depend on `@agentcargo/adapter-contract`, and keep test-only dependencies such as Vitest in `devDependencies`. Use the Apache-2.0 license for first-party packages unless a later project decision says otherwise.

## Required contract

Implement every member of [`HostAdapter`](../packages/adapter-contract/src/index.ts):

| Member | Required behavior |
| --- | --- |
| `id` | Stable lowercase host identifier used in `agentcargo.yaml`, lockfiles, CLI output, and error codes. Do not rename it after releases exist. |
| `adapterVersion` | Adapter implementation version. Increment it when installation or receipt semantics change. |
| `documentationUrl` | Current first-party host documentation URL supporting the implemented behavior. |
| `documentationLastVerified` | ISO date when the host contract was last checked. |
| `detect` | Read-only filesystem detection. Do not start the host, authenticate, execute skill content, or require a host executable. |
| `supportedScopes` | Return exactly the scopes the adapter implements (`project`, `user`, or both). |
| `resolveDestination` | Resolve a canonical scope root and a host-specific skills root. Reject missing, linked, or non-directory roots and return a portable `relativeDestination`. |
| `validatePackage` | Require explicit host compatibility and selected-scope compatibility. Return stable, explainable findings for host-required files or fields. |
| `planInstall` | Describe destination mutations without performing them. Keep registry-only metadata removal explicit. |
| `prepareStagedPackage` | Verify the staged root before activation, remove only approved registry-only files, and never execute scripts or injected commands. |
| `healthCheck` | Reuse destination validation and report stable findings without mutating the filesystem or claiming that the host loaded a skill. |

The canonical TypeScript types and error class are in [`@agentcargo/adapter-contract`](../packages/adapter-contract/src/index.ts). Generic install, lifecycle, lockfile, and archive code must receive an adapter rather than branching on a host identifier.

## Host contract evidence

Before implementation, create or update a host contract under [`docs/hosts/`](hosts/). Record:

- the host identifier and package name;
- first-party documentation URLs and verification date;
- project and user skill roots, discovery rules, and path containment assumptions;
- required and optional native files;
- compatibility declarations and any host-specific transformations;
- what AgentCargo observes versus what the host enforces;
- detection and health-check boundaries;
- tested host versions or an explicit reason a version cannot be pinned.

Do not treat a publisher declaration such as `allowed-tools` or a compatibility entry as a sandbox or runtime permission enforced by AgentCargo. If the host supports executable interpolation, dynamic context, scripts, or subagents, keep those files unexecuted and describe them as observed behavior.

## Compatibility and staging rules

Host compatibility is opt-in. A package manifest must declare the adapter ID and selected scope before installation:

```yaml
compatibility:
  <host-id>:
    scopes:
      - project
      - user
```

The adapter should return a distinct stable error code when the host declaration is missing and when the selected scope is absent. The adapter must require a root regular `SKILL.md` in both the source validation result and staged package check.

`agentcargo.yaml` is registry metadata. Unless a host contract explicitly requires another transformation, remove only that file from the staged host-ready directory. Preserve `SKILL.md`, references, assets, scripts, and host-native metadata as untrusted files; do not rewrite or execute them.

## Shared contract tests

Reuse [`defineAdapterContractTests`](../packages/adapter-contract/src/test-suite.ts) in the adapter's test file. Supply the adapter factory, expected host skills directory, and the adapter's stable finding codes:

```ts
import { defineAdapterContractTests } from "@agentcargo/adapter-contract/test-suite";
import { MyAdapter } from "./index.js";

defineAdapterContractTests({
  createAdapter: () => new MyAdapter(),
  expectedSkillsDirectory: ".host/skills",
  compatibilityNotDeclaredCode: "MY_HOST_COMPATIBILITY_NOT_DECLARED",
  scopeNotDeclaredCode: "MY_HOST_SCOPE_NOT_DECLARED",
  skillRequiredCode: "MY_HOST_SKILL_MD_REQUIRED",
  stagedSkillInvalidCode: "MY_HOST_STAGED_SKILL_INVALID",
  projectRootInvalidCode: "MY_HOST_PROJECT_ROOT_INVALID",
});
```

Add adapter-specific tests for path edge cases, host transformations, invalid names, missing roots, all claimed scopes, metadata, and documentation provenance. If the adapter is built into the CLI, add a fixture lifecycle test covering add, list, doctor, and remove. An authenticated live-host smoke test is useful evidence but must not become a normal credential requirement for pull requests.

## CLI and release boundary

The current CLI registers the two built-in adapters explicitly. A third-party adapter is not auto-discovered or loaded from an installed skill package. Adding one to the built-in CLI requires a deliberate package dependency, an explicit `resolveAdapter` registration, and lifecycle coverage; dynamic adapter discovery is a separate product and security decision.

Keep adapter versions independent from the core lockfile schema. When installation semantics change, update the adapter version, host contract, tests, and status documentation together. Never silently change a published adapter's destination, ownership meaning, or transformation rules.

## Review checklist

- [ ] First-party host documentation was rechecked and linked.
- [ ] `id`, adapter version, documentation URL, and verification date are present.
- [ ] Every claimed scope has a destination and a test.
- [ ] Scope roots are canonical directories and destination paths remain contained beneath them.
- [ ] Compatibility is explicit and missing declarations have stable error codes.
- [ ] No host path or host process appears in generic core or CLI transaction logic.
- [ ] Staging removes only registry-only metadata and executes no package content.
- [ ] Shared contract tests and adapter-specific negative tests pass.
- [ ] `pnpm verify` and `git diff --check` pass.
- [ ] `docs/STATUS.md` records the implementation and the next concrete task.
