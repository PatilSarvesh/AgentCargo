## Outcome

Describe the user-visible result and why it belongs in the current milestone.

## Trust and compatibility

Describe changes to untrusted-input handling, filesystem mutations, stable output, package formats, or host behavior. Write `None` when not applicable.

## Verification

- [ ] Tests cover the behavior change and important failure paths.
- [ ] `pnpm verify` passes.
- [ ] `git diff --check` passes.
- [ ] `docs/STATUS.md` is updated after verification, when this is material work.
- [ ] Host documentation provenance and verification date are updated, when applicable.

## Follow-up

List intentional omissions, migrations, or later work.
