# Controlled beta feedback and measurement template

This template supports the PRD's public-beta learning targets without turning
feedback into a surveillance system. It is a collection aid, not an analytics
backend. Keep responses aggregate or pseudonymous, obtain participant consent,
and never collect provider tokens, AgentCargo sessions, signed URLs, raw IP
addresses, package contents, or private skill instructions.

The metric definitions and targets live in
[`BETA_METRICS.json`](BETA_METRICS.json). Use a random participant ID and keep
the response form version with each record. Apply the deployment's published
[privacy](PRIVACY.md) and [retention](RETENTION.md) policy.

## Participant intake

Record one row per participant:

| Field | Allowed value or guidance |
| --- | --- |
| feedback ID | Random opaque ID, not an email address |
| role | `creator`, `user`, `maintainer`, or `adapter-contributor` |
| cohort | Invitation batch or test round, not a personal identifier |
| consent | `yes` before storing responses |
| host | `codex`, `claude-code`, or `other` (describe only if relevant) |
| operating system | `macos`, `linux`, `windows`, or `other` |
| scope | `project`, `user`, or `not-applicable` |
| CLI/runtime | Major Node.js line and AgentCargo release, never credentials |
| session date | UTC date only unless finer timing is needed for an incident |

## Creator interview

Ask the creator to answer in their own words, then code the response into the
bounded fields below:

1. Could you find the right package shape and understand `SKILL.md` plus
   `agentcargo.yaml` without maintainer help?
2. How long from checkout to the first successful `validate`/`scan`?
3. Did findings explain what to change and why? Record finding categories, not
   the skill's private text.
4. Did `publish` complete without intervention? If not, record the stable error
   code, stage (`validate`, `pack`, `reserve`, `upload`, `complete`, or `scan`),
   and whether a retry recovered.
5. Which documentation step or compatibility declaration was unclear?
6. Would you maintain another release or recommend the workflow? Why?

Suggested coded fields:

```text
publish_completed: yes | no
maintainer_intervention: none | guidance | manual_mutation
time_to_first_publish_minutes: integer or null
first_blocking_stage: validate | scan | reserve | upload | complete | none
documentation_clarity: 1..5
trust_evidence_clarity: 1..5
would_publish_again: yes | no | unsure
```

## User interview

1. Could you discover a relevant skill and understand the declared versus
   observed evidence?
2. Did the install command and host/scope choice match your expectation?
3. Did installation, update preview, removal, or rollback complete safely?
4. If something failed, what stable CLI code and host/scope/OS segment appeared?
5. What would make you trust an independently published skill enough to try it?

Suggested coded fields:

```text
search_completed: yes | no
detail_opened: yes | no
install_attempted: yes | no
install_succeeded: yes | no
update_preview_used: yes | no
rollback_used: yes | no
failure_stage: search | inspect | download | verify | install | update | remove | none
time_to_first_install_minutes: integer or null
trust_evidence_clarity: 1..5
would_install_again: yes | no | unsure
```

## Contributor and maintainer feedback

For an adapter or validation-rule contribution, record:

- the contribution type and contract/version reviewed;
- whether the shared test suite passed on macOS, Linux, and Windows where
  applicable;
- review findings and remediation time without copying private package data;
- whether the contribution can be maintained independently; and
- the final accepted/rejected decision and stable reason.

## Weekly aggregate review

Create one aggregate record per metric and segment using the
[`BETA_METRICS.json`](BETA_METRICS.json) `recordTemplate`. Review:

- activation funnel conversion and time-to-first-success;
- installation success by supported host/scope/OS;
- checksum verification and metadata latency;
- open critical security issues and incident count;
- seed-skill, external-publisher, external-install, and independent-contribution
  progress toward PRD targets; and
- the top three coded reasons for creator/user friction.

Do not publish small cohorts or free-text responses that could identify a
participant. Preserve only the minimum aggregate evidence needed for the next
product decision and follow the deployment retention schedule.
