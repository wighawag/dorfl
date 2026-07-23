---
title: 'review-gate non-blocking nits for ''dorfl-cmd-config-field'' (Gate 2 approve)'
date: 2026-07-21
status: open
reviewOf: dorfl-cmd-config-field
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'dorfl-cmd-config-field' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The agent chose to treat a JSON null dorflCmd as a fail-loud non-string (tested) rather than unset. Ratify: is null-as-error the intended UX, or should null coerce to unset like empty-string?
  (config.ts validateDorflCmdConfig: typeof null !== string ⇒ throws; test asserts null is in the fail-loud set. Reasonable (null is a malformed value, not an omission) and easily reversed, so non-blocking ratification only.)
- Ratify the env var name DORFL_DORFL_CMD (double DORFL). It follows the mechanical DORFL_<SCREAMING_SNAKE(key)> rule from ADR §13 but reads oddly; confirm it is acceptable rather than a special-cased alias.
  (env-config.ts adds dorflCmd:'string'; the name is derived by the existing uniform rule, so consistency argues for keeping it. Documented in JSDoc + tests. Non-load-bearing.)
