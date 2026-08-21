# AgentCargo content policy

_Public-beta implementation policy; reviewed 2026-08-20._

AgentCargo distributes instructions for AI agents. A package is not endorsed
merely because it passed validation or static scanning. Publishers are
responsible for content they submit, the licenses they declare, and the effects
of using a skill in a host environment.

## Allowed content

Skills should be focused, accurately described, and useful for an identified
workflow. They may contain instructions, references, assets, and optional
scripts when the package contract and selected host support them. A publisher
must have the right to distribute every included file and must disclose
compatibility, capabilities, and bounded runtime requirements in
`agentcargo.yaml`.

## Prohibited content

Do not publish packages that:

- steal credentials, tokens, personal data, or private files;
- enable malware, unauthorized access, persistence, destructive actions, or
  evasion of security controls;
- instruct an agent to exfiltrate data, conceal material behavior, or bypass
  the user's explicit authorization;
- impersonate AgentCargo, a host, a publisher, or another person or service;
- contain spam, phishing, unlawful exploitation, or content that violates the
  rights of others;
- include secrets, private keys, or personal/confidential data; or
- deliberately misrepresent capabilities, compatibility, scanner observations,
  licensing, or required dependencies.

This list is a baseline, not a guarantee that every harmful use is detected.
Legitimate security research should be narrowly scoped, clearly identified,
and must not provide unauthorized access instructions for real targets.

## Trust evidence

Catalog pages separate:

- **Declared**: publisher-provided compatibility, capabilities, and
  dependencies.
- **Observed**: files, patterns, scripts, and versioned scanner findings.
- **Enforced**: restrictions demonstrably applied by the selected host.

AgentCargo does not publish a composite safety score and does not describe a
clean scan as a safety guarantee. Registry workers never execute community
scripts during validation, scanning, or activation.

## Reporting and enforcement

Anyone may report a package or release through the bounded reports boundary
(`POST /v1/reports` in the registry API) with a category and evidence. Include
the exact package/release coordinate, relevant digest, and reproducible facts;
do not include passwords or live tokens. Maintainers review reports under the
deployment's access policy and preserve an attributable append-only audit
record.

Depending on severity, maintainers may:

1. request clarification or correction;
2. deprecate a publisher-owned release;
3. quarantine a release so public search, package, and exact-release reads no
   longer expose it;
4. add its SHA-256 digest to the emergency denylist so activation and public
   artifact resolution fail closed; or
5. restore a quarantine when the evidence is resolved and the prior public
   state is documented.

Actions preserve release identity and audit evidence. They do not silently
rewrite an immutable artifact. Operators should follow
[INCIDENT_RUNBOOK.md](INCIDENT_RUNBOOK.md) for urgent containment and
[SECURITY.md](../SECURITY.md) for private vulnerability reports.

## Appeals and corrections

Publishers may provide a correction or appeal through the hosted deployment's
support channel, referencing the package, version, digest, and audit event when
available. A maintainer should record the decision and reason. The deployment
must publish response targets and maintainer roles before public beta; this
repository does not assume a particular staffing or legal process.
