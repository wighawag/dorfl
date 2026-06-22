<!-- agent-runner-sidecar: item=observation:review-nits-f3b-promote-takes-per-item-advancing-lock-2026-06-22 type=observation slug=review-nits-f3b-promote-takes-per-item-advancing-lock-2026-06-22 allAnswered=false -->

## Q1

**Nit 1 — Decision-recording location: F3b's slice acceptance criterion required the 'reuse `advance` action value vs introduce `'promote'`' decision be recorded as an ADR or as a `## Decisions` note in the done record, but the done record `work/tasks/done/f3b-promote-takes-per-item-advancing-lock.md` has no `## Decisions` section — the decision lives only in code comments in `packages/agent-runner/src/needs-attention.ts` (around `promoteFromPreBacklog` / `promoteFromPrePrd`) and in the test file's preamble. The design choice itself is sound (matches PRD q2/q4: one ref per item, three transitions must serialise on it). What becomes of this nit — promote a tiny task to retro-add a `## Decisions` note to the done record (so future readers find the decision via the template's canonical slot), or accept the code-comment recording as sufficient and keep/drop the observation?**

> Observation body bullet 1: '…the recording lives only in a code comment, NOT in a `## Decisions` block of the done record (slice acceptance criterion explicitly required one of: ADR or `## Decisions` note in the done record).' Slice criterion quoted verbatim in the observation. The done record exists at `work/tasks/done/f3b-promote-takes-per-item-advancing-lock.md` and has no `## Decisions` section; the explanation is in two long block comments in `packages/agent-runner/src/needs-attention.ts` and the test file preamble.

_Suggested default: promote-task — a one-paragraph retro-edit to add `## Decisions` to the done record is cheap and restores the template invariant; the decision content already exists verbatim in the code comments and can be lifted._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

## Q2

**Nit 2 — User-visible `pre-backlog`/`pre-prd` prose drift after F1 renamed the pool to `tasks/todo`: the promote path in `needs-attention.ts` still emits `pre-backlog` / `work/backlog/` / `pre-prd` / `work/prd/` in `note()` messages, the `reasonNotMoved` early-exit text, and the git commit subject (`chore(<slug>): promote work/pre-backlog/ -> work/backlog/`). This is PRE-EXISTING (F3b only wrapped these in a try/finally, didn't touch the strings) and arguably out of F3b's scope. What becomes of this nit — promote a small follow-up slice to align the user-facing language with the new `todo` noun, or keep/drop (e.g. defer until a broader F-series naming sweep)?**

> Observation body bullet 2 cites: packages/agent-runner/src/needs-attention.ts:818-825 (the 'is not staged in work/pre-backlog/ on …' string and the commit subject `chore(${slug}): promote work/pre-backlog/ -> work/backlog/`), line 863 (`Promoted '${slug}' from pre-backlog to backlog`), line 869 (`item left in pre-backlog`), and the symmetric brief block (lines 1034-1050). F1 already renamed the pool to `tasks/todo` so these strings are user-visible drift.

_Suggested default: promote-task — strings are user-visible (notes + commit subjects appear in logs and git history) and the rename target is unambiguous; a small follow-up slice to sweep `pre-backlog`/`pre-prd` strings in `needs-attention.ts` (and check for siblings elsewhere) is the natural home._

<!-- q2 fields: id=q2 disposition=promote-task -->

**Your answer** (write below this line):
