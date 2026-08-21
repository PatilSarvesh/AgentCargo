---
name: test-writing
description: Design focused tests that protect behavior and make failures easy to diagnose. Use when adding or improving automated coverage.
---

# Test writing

Create tests that make the intended contract obvious and keep failures useful.

1. Identify the behavior and the boundary that the test must protect.
2. Cover the happy path, meaningful edge cases, and the expected failure shape.
3. Prefer deterministic fixtures and isolated dependencies over broad mocks.
4. Keep each test focused on one observable outcome.
5. Include regression coverage for the reported defect when one exists.
6. Run the narrowest relevant test command, then summarize remaining coverage gaps.
