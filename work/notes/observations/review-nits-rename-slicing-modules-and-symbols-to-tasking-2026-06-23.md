---
title: review-gate non-blocking nits for 'rename-slicing-modules-and-symbols-to-tasking' (Gate 2 approve)
date: 2026-06-23
status: open
reviewOf: rename-slicing-modules-and-symbols-to-tasking
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'rename-slicing-modules-and-symbols-to-tasking' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the wire-level enum literals inside the renamed modules were left on slicing vocabulary even though their containing symbols/fields were renamed — concretely `type: 'slicing'` (lock type, tasking.ts:671), `action: 'slice'` (tasking-lock.ts:191), `commitTag: 'sliced'` + `outcome: 'sliced'` (tasking.ts:675/756/821), and `outcome: 'uncertain-slices'` plus the `loop?: 'converged' | 'uncertain-slices'` union (tasking.ts:103/125/556/593–597/807, tasker-review-loop.ts:143/154/159/232/348). The `UncertainSlice → UncertainTask` and `uncertainSlices → uncertainTasks` symbol/field renames DID happen, so the matching outcome literal still saying `'uncertain-slices'` is internally inconsistent. The deferral is defensible — these values cross into lock-ref disk state, sidecar commit tags, and assertions in unrelated tests (item-lock.test.ts, gc-reap-stale-locks.test.ts, complete-lock-crash-safe.test.ts, tasking-acquires-unified-lock.test.ts) and that crosses the slice's 'pure rename, no behaviour change' fence — but it is an in-scope decision the agent made on its own and should be ratified (and ideally captured as a named follow-up task: 'rename tasking wire-level enum values slice→task').
  (src/tasking.ts:103,125,556,593–597,671,675,756,807,821; src/tasking-lock.ts:191; src/tasker-review-loop.ts:143,154,159,232,348; tests assert these values literally.)
- Ratify: the agent's commit/PR body has no `## Decisions` block at all, so the in-scope decisions made while finishing this rename are unrecorded. The two that need surfacing are (a) the wire-level-literals deferral above, and (b) the 'keep foreign-slug references verbatim' rule the requeue note calls 'Decision 5' (applied to e.g. `slice-acceptance-gate`, `slicer-review-edit-loop`, `auto-slice`, `runner-deterministic-slice-placement-policy-and-precedence`, `slice-output-through-integration`, `prd-sliced-folder-step-a`, `remove-sliced-marker-step-b`, `slicing-protocol-doc-and-vocabulary-fix`, `slicing-coherence`, `autoslice-command/-confidence/-lock`, `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`). Both are correct calls but should be recorded for downstream readers.
  (git log cefe897 -1 --format=%B yields only the title line; no Decisions block. Many slug-bearing doc-comment refs remain in the renamed modules (intentionally).)
