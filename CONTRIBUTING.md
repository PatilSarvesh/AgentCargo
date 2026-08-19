# Contributing to AgentCargo

AgentCargo welcomes focused contributions to its public CLI, package contracts, adapters, validation and scanning rules, documentation, and examples. The project is still pre-release, so compatibility and trust-boundary changes need especially careful review.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not the public issue tracker.

## Before you start

1. Read [AGENTS.md](AGENTS.md), [docs/STATUS.md](docs/STATUS.md), and the relevant product or architecture section.
2. Search existing issues before opening a new one.
3. For a large feature, new dependency, wire-format change, trust claim, or host adapter, open a proposal before implementation.
4. Keep changes inside the documented MVP unless maintainers have accepted a scope change.

Good first contributions include documentation fixes, malicious-input test cases, portable path tests, stable error-message improvements, and updates to host-contract evidence.

## Development setup

AgentCargo requires Node.js 22 or newer and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Useful commands:

```bash
pnpm check
pnpm test
pnpm build
pnpm dev:cli validate ./examples/hello-skill
```

Dependency build scripts are deny-by-default. Do not add a package to `onlyBuiltDependencies` without reviewing and documenting why its install-time code is necessary.

## Change requirements

- Keep generic core and CLI code free of host-specific paths.
- Treat archives, manifests, Markdown, lockfiles, adapter output, and installed trees as untrusted input.
- Never execute package scripts during validation, scanning, or publication.
- Preserve stable machine-readable output and error codes.
- Add or update tests for behavior changes, including negative cases.
- Update `docs/STATUS.md` only after proportionate verification passes.
- Add an architecture decision record for material or difficult-to-reverse decisions.
- Do not mix unrelated refactors into a focused change.

Run `pnpm verify` and `git diff --check` before requesting review. If a platform-specific test cannot be run locally, state that clearly in the pull request.

## Pull requests

Describe the user-visible outcome, trust-boundary impact, verification performed, and any follow-up work. Keep commits reviewable; maintainers may squash them when merging.

Adapter changes must follow the [host adapter development guide](docs/ADAPTERS.md), cite current first-party host documentation, record the verification date, cover every claimed scope, and avoid describing publisher declarations as host-enforced restrictions.

## Licensing contributions

AgentCargo is licensed under [Apache License 2.0](LICENSE). Unless you explicitly state otherwise, intentionally submitted contributions are provided under the same license, as described by Section 5 of Apache-2.0. No contributor license agreement is required at this stage.

Third-party code, fixtures, or assets must have a compatible license and clear provenance. Do not copy content merely because it is publicly visible.
