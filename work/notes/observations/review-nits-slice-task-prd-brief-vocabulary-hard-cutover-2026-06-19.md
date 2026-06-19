---
title: review-gate non-blocking nits for 'slice-task-prd-brief-vocabulary-hard-cutover' (Gate 2 approve)
date: 2026-06-19
status: open
reviewOf: slice-task-prd-brief-vocabulary-hard-cutover
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'slice-task-prd-brief-vocabulary-hard-cutover' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Stale JSDoc in two type definitions claims the namespace 'Defaults to slice' while the code now defaults to 'task'. Ratify cleaning these up (they are doc-only, code is correct).
  (workspace.ts:158-160 (CreateJobOptions.type) and isolation.ts:114-119 (PrepareInput.type) both still say the TYPE is "'slice' (build) or 'prd' (slicing)" and "Defaults to 'slice'", but the field is typed as the renamed SlugNamespace and the code defaults to 'task' (workspace.ts:248 `options.type ?? 'task'`, isolation.ts:176/252 `type ?? 'task'`). The doc and the code disagree; a future reader could believe the default is still 'slice'. Behaviourally inert.)
- intake.ts switchToWorkBranch JSDoc still narrates the old branch spellings and 'passes slice/prd' while both call sites now correctly pass 'task'/'brief'. Ratify cleaning the comment.
  (intake.ts:1708-1717 says "work/intake-slice-<slug> / work/intake-prd-<slug>", "the firing intake x do slice: collision", and "The slice-emit path passes 'slice', the PRD-emit path 'prd'." The actual callers (lines 1141, 1278) pass 'task' and 'brief', and workBranchRef would now reject a 'slice'/'prd' type, so the code is correct; only the comment is stale. Note also scan.ts:260, start.ts:585, do.ts (many 'do prd:' JSDoc lines), and cli.ts option descriptions still use 'do prd:'/'slice/PRD' prose for the slicing path — a broader stale-comment sweep is warranted but is doc-only.)
- Ratify the in-scope decision to rename only the USER-FACING vocabulary while keeping internal symbol/helper names on the old words. Was this the intended scope boundary?
  (The cutover deliberately kept internal identifiers un-renamed: sliceExists()/prdExists() helpers in slug-namespace.ts, resolveSliceOnlyArg() (still 'Slice' in the name though it now resolves tasks), heldSliceSlugs() in item-lock.ts, ScannedItem and its slice-pool prose in scan.ts. This is a defensible scope choice (flip the vocabulary humans see; leave internal names for a later non-breaking cleanup), and it is consistent with the slice naming heldSliceSlugs explicitly in its acceptance criteria, but it was not recorded as a decision. Non-load-bearing and trivially reversible.)
- The PR/commit body carries NO '## Decisions' block. The slice prompt asked to RECORD any non-obvious in-scope decision (e.g. the exact pre-rename rejection behaviour) per ADR-FORMAT.md. Confirm the rejection-behaviour decision is acceptable as-is.
  (The commit body is a bare title with no Decisions block. The one genuinely in-scope decision — the exact clean-break behaviour for a pre-rename ref (slice:foo/prd:foo now parse as bare LITERAL slugs that resolve to the TASK namespace, rather than erroring) — is implemented and tested (slug-namespace.test.ts "HARD CUTOVER" cases) and matches the slice's stated stance, but it was not surfaced for ratification in a Decisions block. Flagging so the human ratifies that 'slice:foo' silently becoming a literal task slug (rather than a hard error) is the intended UX.)
