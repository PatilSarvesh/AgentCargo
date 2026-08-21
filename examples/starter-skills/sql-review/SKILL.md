---
name: sql-review
description: Review SQL and database changes for correctness, migration safety, query behavior, and data integrity. Use when a schema, query, or persistence boundary changes.
---

# SQL review

Review database changes as a maintainer responsible for correctness and safe evolution.

1. Check schema constraints, nullability, defaults, indexes, and data-integrity assumptions.
2. Trace migration order, compatibility with existing records, and rollback or recovery assumptions.
3. Inspect query predicates, joins, ordering, pagination, and expected empty or duplicate results.
4. Check transactions, locking, retries, idempotency, and behavior under concurrent requests.
5. Consider privacy and retention boundaries; ensure diagnostics do not expose stored records.
6. Report concrete findings with evidence, impact, remediation, and tests that would prove the fix.
