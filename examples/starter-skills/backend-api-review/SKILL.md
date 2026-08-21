---
name: backend-api-review
description: Review backend API changes for contracts, validation, authorization, and compatibility. Use when an API or service boundary changes.
---

# Backend API review

Review an API as a contract shared by clients, operators, and future versions.

1. Check request and response schemas, status codes, versioning, and error stability.
2. Trace authentication, authorization, tenant or namespace ownership, and replay behavior.
3. Check validation limits, pagination, idempotency, concurrency, and retry semantics.
4. Verify logs and metrics do not expose credentials or unbounded user-controlled data.
5. Review migrations and compatibility with existing clients and stored records.
6. Report findings with evidence, impact, remediation, and tests that would prove the fix.
