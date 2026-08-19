# ADR 0002: TypeScript pnpm Monorepo

- Status: Accepted
- Date: 2026-08-13
- Decision owners: AgentCargo maintainers

## Context

AgentCargo needs a CLI, package validation and archive logic, versioned host adapters, and later a web application, API, worker, scanner, and typed API client. The same package and trust-boundary rules must behave consistently in the local CLI and hosted registry. Splitting these surfaces across repositories or languages before the contracts stabilize would make validation drift and cross-package changes harder to review.

The local package core already uses TypeScript and Node.js. The implementation must remain testable across macOS, Linux, and Windows without relying on platform shell behavior.

## Decision

AgentCargo uses a TypeScript monorepo managed with pnpm workspaces.

- Node.js 22 is the minimum runtime; CI also tests the next supported current line.
- Packages use strict TypeScript configuration and ECMAScript modules.
- `packages/core` owns host-neutral validation, artifact, installation, lifecycle, and lockfile behavior.
- `packages/adapter-contract` owns the versioned host interface and types.
- Each host implementation lives in its own adapter package.
- `packages/cli` contains command parsing and presentation; reusable use cases remain callable without a subprocess.
- Future hosted applications live under `apps/` and depend on shared packages rather than duplicating package rules.
- Workspace dependencies use `workspace:*` until publication policy is defined.
- pnpm dependency build scripts remain deny-by-default and require explicit review.
- The root `pnpm verify` command is the documented clean-checkout validation entry point.

Package dependencies should point toward contracts and reusable core modules. Generic packages must not import a host adapter in production code; adapter imports used only by test fixtures belong in development dependencies.

Turborepo may be added when measured build times justify it. It is not part of the repository contract today.

## Consequences

Benefits:

- CLI and hosted surfaces can share exact parsing, digest, and validation behavior.
- Cross-package API changes are visible and testable in one pull request.
- A single lockfile and toolchain simplify reproducible contributor setup.
- Host-specific behavior remains separately versioned and reviewable.

Tradeoffs:

- Repository-wide CI can grow as hosted applications are added.
- TypeScript and Node.js become ecosystem constraints for first-party packages.
- Package boundaries must be enforced by review and tests because the filesystem alone does not prevent accidental coupling.
