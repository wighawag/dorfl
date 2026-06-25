<!-- dorfl-sidecar: item=observation:review-nits-f3b-promote-takes-per-item-advancing-lock-2026-06-22 type=observation slug=review-nits-f3b-promote-takes-per-item-advancing-lock-2026-06-22 allAnswered=false -->

## Q1

**Ratify the in-scope design decision for f3b (promote, for both task and brief, reuses the existing `action: advance` lock value rather than introducing a distinct `'promote'` action, so all three transitions of one item serialise on the same per-item ref) AND ratify that this decision is recorded only in code comments rather than in a `## Decisions` block of the done record as the slice's acceptance criterion required. What becomes of this nit: ratify-as-is (existing record is the durable home), require a `## Decisions` entry be added, or defer to the standing enforce-vs-relax decision?**

> Verified against current reality: the design choice is sound and matches what the slice Prompt already recommended (PRD q2/q4: keep one lock ref per item; three transitions of one item must serialise on it). The decision IS durably explained in two block comments in packages/dorfl/src/needs-attention.ts (around `promoteFromPreBacklog`/`promoteFromPrePrd`, see lines ~683-728 and ~881+) and in the test preamble. Only the RECORDING LOCATION deviates: work/tasks/done/f3b-promote-takes-per-item-advancing-lock.md has no `## Decisions` section, yet its acceptance criterion (still unchecked, line 29) reads "Any decision (reuse `advance` action value vs introduce `'promote'`) is RECORDED per the task template — as an ADR if it meets the ADR gate, otherwise a `## Decisions` note in the done record." This is one of FIVE identical instances tracked by the meta-observation `decisions-block-convention-repeatedly-skipped-enforce-or-relax-2026-06-22` (also needsAnswers: true), which frames the standing ENFORCE-vs-RELAX choice. Adjudicating this nit in isolation risks contradicting that pending meta-decision.

_Suggested default: Ratify-as-is and defer the location convention to the standing `decisions-block-convention-repeatedly-skipped-enforce-or-relax-2026-06-22` decision (the design choice itself is sound and durably recorded in code comments); do not reopen f3b for a `## Decisions` entry pending that meta-resolution._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**What becomes of the user-visible prose-drift finding: the promote path still emits `pre-backlog`/`work/backlog/`/`pre-prd`/`work/prd/` nouns in `note()` messages, the `reasonNotMoved` text, and the commit subject, even though the pool vocabulary has been moving toward the new `todo` noun? Mint a small follow-up slice to align the user-facing language, keep it as a tracked nit, or drop it?**

> Verified still present in packages/dorfl/src/needs-attention.ts: line 818-819 ('… is not staged in work/pre-backlog/ … and not already in work/backlog/'), line 825 (commit subject `chore(${slug}): promote work/pre-backlog/ -> work/backlog/`), line 863 (`Promoted '${slug}' from pre-backlog to backlog`), line 869 (`item left in pre-backlog`), plus the symmetric brief block (~1034-1050) and pre-prd references at 683/881/1063/1087. This drift is PRE-EXISTING — F3b did not author these strings, it wrapped them in a try/finally — so it is arguably out of F3b's scope; the diff is simply where it was noticed. NOTE the vocabulary state is genuinely in flux and worth the human's eye: the new `todo` noun appears in done layout-rename tasks, but the LIVE `work/tasks/` tree currently still has `backlog`/`ready` folders (no `todo`), so the exact target noun for these user-facing strings is not settled. A sibling nit `review-nits-f1-pool-noun-todo-in-surface-and-apply-readers-2026-06-22` covers adjacent reader-side noun alignment.

_Suggested default: Mint a small follow-up slice to align the promote-path user-facing strings (and confirm the canonical target noun against the live `work/tasks/` layout first), rather than fixing it inside f3b's scope or dropping it._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
