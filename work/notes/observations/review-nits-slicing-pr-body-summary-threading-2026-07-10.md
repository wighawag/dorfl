---
title: review-gate non-blocking nits for 'slicing-pr-body-summary-threading' (Gate 2 approve)
date: 2026-07-10
status: open
reviewOf: slicing-pr-body-summary-threading
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'slicing-pr-body-summary-threading' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: empty-set (zero emitted tasks) returns undefined so gh degrades to --fill. Intentional and matches build-path absent-body behaviour, but it means a genuinely-empty tasking run still hits the very fallback this task exists to escape.
  (tasking.ts composeTaskingProposeBody early-return + doc comment; task doc says 'the --fill degradation stays as the absent-body fallback' — call it out for ratification.)
- Ratify: 'keystone' is defined here as any set-member whose blockedBy names no OTHER set member (external blockers on done/ tasks are ignored). Reasonable set-relative reading; flag so this becomes the canonical definition rather than an implicit one.
  (tasking.ts: `keystones = tasks.filter(t => t.blockedBy.every(b => !setSlugs.has(b)))`.)
- Ratify: covers/title are re-parsed from the raw frontmatter block via ad-hoc regex (readCoversField/readTitleField) rather than extended on parseFrontmatter's typed shape. Fine as a local scan, but duplicates frontmatter-parsing responsibility.
  (tasking.ts readTitleField/readCoversField vs parseFrontmatter usage in parseTaskSummary.)
- Task doc points at `packages/dorfl/src/slicing.ts` but the file is `tasking.ts` (pre-existing slicing→tasking rename). Not this task's defect, but worth a doc scrub so future readers do not chase the wrong file.
  (task file 'Pointers' section references slicing.ts; repo has only tasking.ts.)
