# WORD scan keeps `prd:` prose exempt as PROVENANCE (not a live alias) after the hard cutover

Date: 2026-07-10
Task: `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb` (Part C)

## Decision

When removing the "live CODE back-compat alias" rationale for the `prd:` field/verb from the two leak scans, I split the two scans rather than removing the `prd:` colon exemption from BOTH:

- **SRC-prose scan** (`prd-src-prose-leak-scan.test.ts`, walks `packages/dorfl/src` only): the `prd:` field/verb exemption is REMOVED. Live code must not say `prd:` now, so this scan FAILS on a stray live `prd:` field-key or `do prd:` verb. This is the real hard-cutover gate. It caught ~7 real residual leaks in live src prose (`close-job.ts`, `do.ts`, `cli.ts`, `integration-core.ts`, `item-lock.ts`, `intake.ts`), all fixed to `spec`.
- **WORD scan** (`prd-word-cutover-leak-scan.test.ts`, walks the human-readable TREES incl. all of `work/**` terminal history + `docs/` + `skills/`): the `prd:` colon exemption is KEPT, but RE-DOCUMENTED as a PROVENANCE exemption, not a live-alias one.

## Why

Removing `after === ':'` from the WORD scan too unmasked ~25 `prd:` prose hits across `work/tasks/done/` bodies + titles, observation/finding notes, ADRs, and `skills/` — nearly all of which RECORD the `do prd:` verb / `prd:` field AS IT WAS at build time (e.g. done-task titles like `Route do prd:<slug> slice output ...`). Those are immutable terminal-history provenance; rewriting them would falsify the record. The task's D "ripple" scope enumerated ONLY the three coupled TEST files (`close-job`/`prompt`/`spec-complete`) that break from the KEY-read removal, NOT a terminal-history prose sweep. So sweeping `work/**` history was out of this task's intended surface.

## Alternatives considered

- **Remove the colon exemption from the WORD scan too, then sweep all ~25 files** → falsifies terminal history and is well outside the task's declared surface. Rejected.
- **Narrow the WORD colon exemption to slug-covered lines only** → still left ~25 leaks (the history titles/bodies are not covered by an enumerated PRESERVE slug on the line), so it would still force the out-of-scope sweep. Rejected.
- **Enumerate ~20 done-history basenames into `PROVENANCE_FILE_BASENAMES`** → a large, brittle list that would swallow real re-drift in those files. Rejected in favour of the blanket provenance rationale.

## What it touches

Only the two leak-scan test files. It sets the policy that the WORD gate does NOT enforce the `spec` word over terminal-history `prd:` references (they are provenance); the SRC scan is the authoritative hard-cutover gate on live code. If a future maintainer DOES want live maintained docs (ADRs/skills) swept of prose `prd:`, that is a separate, deliberately-scoped follow-up (a handful of live-doc lines: `docs/adr/methodology-and-skills.md`, `skills/orchestrate/SKILL.md`, `docs/adr/land-primitive-rebase-reverify-advance.md`).
