---
name: code-review
description: Review code changes for correctness, maintainability, and delivery risk. Use when a change needs a structured engineering review.
---

# Code review

Review the requested change as an engineer responsible for its behavior in production.

1. Read the surrounding implementation and identify the intended behavior.
2. Trace normal, boundary, and failure paths before forming conclusions.
3. Report concrete findings first, ordered by severity, with file and line references.
4. Explain why each finding matters and suggest the smallest safe remediation.
5. Call out missing tests, compatibility concerns, and assumptions that need confirmation.
6. End with a short verification summary and distinguish observations from guesses.
