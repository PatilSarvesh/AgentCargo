---
name: dependency-review
description: Review dependency changes for compatibility, maintenance risk, license obligations, and supply-chain exposure. Use when package or lockfile dependencies change.
---

# Dependency review

Review dependency changes as a maintainer responsible for the project’s long-term trust and compatibility.

1. Compare direct and transitive changes, version ranges, lockfile entries, and platform support.
2. Check release provenance, maintenance signals, license obligations, and known compatibility constraints.
3. Identify newly reachable capabilities or behavior that changes the project’s trust boundaries.
4. Review upgrade and downgrade paths, reproducibility, and the evidence needed to investigate a mismatch.
5. Run or request focused tests for affected behavior, build targets, and package installation.
6. Report findings with evidence, impact, remediation, and an explicit accept-or-reject recommendation.
