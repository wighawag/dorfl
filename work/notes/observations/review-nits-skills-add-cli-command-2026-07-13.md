---
title: review-gate non-blocking nits for 'skills-add-cli-command' (Gate 2 approve)
date: 2026-07-13
status: open
reviewOf: skills-add-cli-command
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'skills-add-cli-command' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: only `add` is exposed now; `list`/`remove` are deferred (rationale: vendored `install()` is idempotent so `add` covers upgrade+drift-repair). Documented in the group JSDoc; task's spec explicitly left this to the builder.
  (packages/dorfl/src/cli.ts skills-group JSDoc)
- Ratify: flag spelled `--local` (mirrors `remote add --local`; task allowed 'or equivalent'). Rationale recorded in `SkillsAddFlags.local` JSDoc.
  (packages/dorfl/src/cli.ts SkillsAddFlags)
- Ratify report shape: human-readable only, one source line + sorted canonical paths + sorted per-harness `agent: mode -> path`, empty-source and no-non-universal-harness messages; no JSON mode. Documented on `formatSkillsAddReport`.
  (packages/dorfl/src/cli.ts formatSkillsAddReport JSDoc)
- The 'global default' test only asserts option shape, not action behaviour, to avoid writing to real HOME. Coverage of the `flags.local !== true` → `global: true` mapping is inferred, not exercised. Acceptable given the shared-write isolation rule, but a stub/spy on `installSkills` could tighten this without touching HOME.
  (test/skills-add-cli.test.ts final describe block)
