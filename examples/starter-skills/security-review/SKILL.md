---
name: security-review
description: Inspect a change for trust boundaries, abuse cases, and actionable security findings. Use when a change handles input, identity, files, or sensitive data.
---

# Security review

Review security properties using evidence from the implementation and its tests.

1. Map untrusted inputs, identities, privileges, storage, and external boundaries.
2. Check authentication, authorization, validation, secrets, logging, and error handling.
3. Trace abuse cases such as replay, confused deputy, path escape, injection, and denial of service.
4. Report actionable findings with severity, impact, evidence, and remediation.
5. Distinguish controls that are declared, observed, and actually enforced.
6. Verify the important negative paths without executing untrusted package content.
