---
title: review-gate non-blocking nits for 'work-layout-module-centralises-all-work-paths' (Gate 2 approve)
date: 2026-06-19
status: open
reviewOf: work-layout-module-centralises-all-work-paths
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'work-layout-module-centralises-all-work-paths' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the deliberate scope boundary: ~90 residual `work/<folder>` string literals remain in `src/` outside `work-layout` (error/log/note prose, CLI --help text, embedded workflow-template YAML like `push: work/questions/**`, and agent-prompt example JSON). Path-CONSTRUCTION was fully centralised; these prose/doc/template strings were intentionally left. Is that the right cut line?
  (The slice scoped itself to `join(cwd,'work',...)`, raw path literals used as paths, prefix-slices, and unions - all of which ARE routed. The leftovers are human-readable text, not path construction, so leaving them is defensible. But this is a non-obvious in-scope decision the agent made on its own and did NOT record in a `## Decisions` block (the prompt asked for one). It also directly bears on the next finding.)
- CROSS-SLICE INTERACTION: the sibling slice `guard-test-no-raw-work-literal-outside-work-layout` (blockedBy this one) asserts 'no .ts outside work-layout contains a raw work/<folder> literal'. Because ~90 prose/template literals remain (previous finding), a NAIVE text-regex guard will FAIL on legitimate code. The guard author must scope the rule to PATH-CONSTRUCTION contexts (or otherwise allow prose), not a blanket source scan.
  (This slice's own acceptance criterion #2 says 'this slice must leave that guard passable.' It does leave it passable IN PRINCIPLE - but only if the guard is written context-aware. This is the single most important thing to hand the guard slice. Not a block here: the guard is a separate, not-yet-built slice that can (and per its own prompt should) define 'raw literal' precisely; this slice cannot pre-satisfy a regex that does not exist yet.)
- Ratify the `stripWorkFolderPrefix` API decision: it returns `string | undefined` (undefined when the path is not under the folder) rather than throwing or returning ''. Callers that previously `startsWith`-guarded now branch on `undefined`. Is this the intended replacement contract for the hand-written `.slice(prefix.length)` sites?
  (A non-obvious API-shape choice with a cross-cutting effect (the slicer-review-loop edit-guard now keys its 'skip edit outside pre-backlog' branch off `undefined`). The behaviour is equivalent to the old code and arguably safer (a non-matching path can no longer be wrong-length-sliced), and it is unit-tested. Worth a one-line ratification; not recorded in a `## Decisions` block.)
- Slice-vs-reality drift, handled correctly (FYI only): the slice text and prompt name `WORK_FOLDERS` in `ledger-write.ts` as a scattered array to consolidate, but no such symbol existed at this slice's baseline (`ledger-write.ts` is unchanged in the diff). The agent did not fabricate it. Confirm nothing was missed.
  (The slice is a launch snapshot the prompt explicitly flags as possibly drifted. `WORK_FOLDERS` had evidently already been removed by an earlier landed slice. The agent correctly built against current reality rather than the stale snapshot. I confirmed no other named union (`SliceFolder`, `PRD_FOLDERS`, `LEDGER_STATUS_FOLDERS`, `SLICE_FOLDERS`) was left un-consolidated.)
