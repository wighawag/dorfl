<!-- agent-runner-sidecar: item=observation:review-nits-rename-slicing-modules-and-symbols-to-tasking-2026-06-23 type=observation slug=review-nits-rename-slicing-modules-and-symbols-to-tasking-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation (the two non-blocking Gate-2 nits on the slicing→tasking rename)?**

> Observation file: work/notes/observations/review-nits-rename-slicing-modules-and-symbols-to-tasking-2026-06-23.md. Two nits surfaced by the Gate-2 review of 'rename-slicing-modules-and-symbols-to-tasking' (approved, not blocking):
>   (a) wire-level enum literals still on slicing vocabulary inside the renamed modules — type: 'slicing', action: 'slice', commitTag/outcome: 'sliced', outcome: 'uncertain-slices', and the loop union member 'uncertain-slices' (src/tasking.ts:103,125,556,593–597,671,675,756,807,821; src/tasking-lock.ts:191; src/tasker-review-loop.ts:143,154,159,232,348). The matching symbol/field renames DID happen (UncertainSlice→UncertainTask, uncertainSlices→uncertainTasks), so the leftover literals are internally inconsistent. The agent deferred them because they cross into lock-ref disk state, sidecar commit tags, and literal assertions in unrelated tests (item-lock.test.ts, gc-reap-stale-locks.test.ts, complete-lock-crash-safe.test.ts, tasking-acquires-unified-lock.test.ts), which breaches the slice's 'pure rename, no behaviour change' fence.
>   (b) the commit/PR body for the rename lacks a `## Decisions` block (git log -1 --format=%B is just the title), so two in-scope decisions are unrecorded: the wire-literal deferral, and the 'keep foreign-slug references verbatim' rule (Decision 5 in the requeue note) applied to slugs like slice-acceptance-gate, slicer-review-edit-loop, auto-slice, slice-output-through-integration, etc.
> Nit (a) is naturally a follow-up TASK ('rename tasking wire-level enum values slice→task' — explicitly suggested in the observation body). Nit (b) is retrospective and largely informational — the commit is already landed; a Decisions block cannot be added without rewriting history, so it is closer to a keep/delete than a task.

_Suggested default: promote-task for nit (a) — open 'rename tasking wire-level enum values slice→task' covering the enum literals, the lock-ref on-disk values, the sidecar commit tags, and the test assertions as ONE coherent behaviour-touching slice (with explicit migration/back-compat thinking for any existing on-disk lock refs). Drop nit (b) as a one-off retrospective note (no actionable carrier in the current repo); optionally fold its lesson — 'agent must include a ## Decisions block when it makes in-scope decisions' — into the work-contract / review checklist if it recurs._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

## Q2

**Ratify the agent's deferral of the wire-level slicing→tasking literal rename (type:'slicing', action:'slice', commitTag/outcome:'sliced', outcome:'uncertain-slices', loop union 'uncertain-slices') and capture it as the named follow-up 'rename tasking wire-level enum values slice→task'?**

> Carried over verbatim from the observation body (bullet 1). The deferral is defensible — touching these values changes on-disk lock-ref content, sidecar commit tags, and literal assertions in item-lock.test.ts / gc-reap-stale-locks.test.ts / complete-lock-crash-safe.test.ts / tasking-acquires-unified-lock.test.ts, which is behaviour-touching and outside a 'pure rename' slice. But it is an in-scope decision the agent made unilaterally and should be ratified by the human plus captured as a named follow-up so it does not get lost.

_Suggested default: Ratify the deferral and open the follow-up task (covered by the promote-task default above)._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Ratify the agent's 'keep foreign-slug references verbatim' rule (Decision 5 in the requeue note) — i.e. that slugs naming OTHER artefacts (slice-acceptance-gate, slicer-review-edit-loop, auto-slice, runner-deterministic-slice-placement-policy-and-precedence, slice-output-through-integration, prd-sliced-folder-step-a, remove-sliced-marker-step-b, slicing-protocol-doc-and-vocabulary-fix, slicing-coherence, autoslice-command/-confidence/-lock, cutover-retire-slicing-advancing-markers-and-trim-folder-sets) were intentionally NOT rewritten in doc-comments of the renamed modules?**

> Carried over verbatim from the observation body (bullet 2, second sub-decision). The rule is correct — slugs are stable identifiers and rewriting them inside doc-comments would break cross-references — but it was applied silently with no Decisions block in the commit body, so a downstream reader has no in-band record of WHY those slug-bearing references look 'stale'.

_Suggested default: Ratify the rule and, since the commit is already landed, record it once in the work-contract / review checklist (or a short ADR-style note) rather than amending history._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
