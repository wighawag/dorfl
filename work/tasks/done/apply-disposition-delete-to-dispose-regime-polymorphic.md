---
title: 'Rename the apply disposition `delete`→`dispose` and make it regime-polymorphic'
slug: apply-disposition-delete-to-dispose-regime-polymorphic
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: []
covers: [2, 9]
---

## What to build

Rename the apply-rung disposition OUTCOME token `delete` (and its verdict channel `deleteReason`) to `dispose` (`disposeReason`), and make the dispose behaviour REGIME-POLYMORPHIC on the source item's type:

- **observation** → `git rm` the source (+ its sidecar) in one revertible commit (notes leave by deletion — unchanged from today's `delete`).
- **task** → `git mv` the source into the task regime's won't-proceed terminal `tasks/cancelled/` (RETAINED, with the reason recorded in the item body as `reason:`), NOT a `git rm`.
- **spec** → `git mv` the source into the spec regime's terminal `specs/dropped/` (RETAINED).

The point (the spec's resolved decision #5): a TASK can no longer be hard-deleted by the apply rung — it can only be DISPOSED to its regime terminal. Making the token polymorphic (rather than adding a second `cancel` token beside a literal `delete`) makes "a task cannot be deleted, only disposed to its terminal" true BY CONSTRUCTION.

This is a thin vertical: the decision-outcome union + verdict channel, the apply-persist behaviour that acts on the outcome, and the tests. The FOLDER words (`cancelled` for tasks, `dropped` for specs) are unchanged — only the disposition TOKEN + channel are renamed. It is a bounded rename (~20 sites) plus the new task/spec `git mv` branches in the disposal path.

## Acceptance criteria

- [ ] The apply-decision outcome union no longer has `delete`; it has `dispose`. The verdict channel `deleteReason` is renamed `disposeReason`. Every producer/consumer/parse-site is updated (the outcome union, the verdict shape + its parser, the apply-rung dispatch, and the disposal executor).
- [ ] Disposing an OBSERVATION `git rm`s the source (+ sidecar), reason in the commit message (today's behaviour, preserved).
- [ ] Disposing a TASK `git mv`s it to `tasks/cancelled/` (file retained), with the reason written into the item body (`reason:`), NOT a `git rm`.
- [ ] Disposing a SPEC `git mv`s it to `specs/dropped/` (file retained).
- [ ] No caller can reach a code path that `git rm`s a TASK via the dispose outcome.
- [ ] Tests cover all three regime branches of `dispose` (observation→rm, task→cancelled/, spec→dropped/), mirroring the existing apply/decision test style; the renamed token is asserted end-to-end (verdict → dispatch → on-disk effect).
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: rename the apply-rung disposition outcome `delete`→`dispose` (channel `deleteReason`→`disposeReason`) and make the dispose action polymorphic on the source item's regime, per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (resolved decision #5).
>
> FIRST, check this task against current reality (launch snapshot — may have DRIFTED): confirm the apply decision outcome union is still `{task | spec | adr | delete | resolve | ask}` and that the disposal executor still `git rm`s the source. If the token set or the disposal path changed, route to needs-attention with the discrepancy rather than building on a stale premise.
>
> Domain vocabulary: the apply rung runs a shared `decide(input, allowedOutcomes)` engine returning a `DecisionVerdict` (a discriminated union — each outcome fills its own optional channels). The disposition token today is `delete`, whose channel is `deleteReason`, and whose effect is discharge-by-deletion (`git rm`). The `work/` layout has PER-REGIME won't-proceed terminals: `tasks/cancelled/` for tasks, `specs/dropped/` for specs (deliberately different words so a task and spec sharing a slug cannot collide on one terminal path — do NOT rename the folders). Observations have no terminal folder: "notes leave by deletion".
>
> Where to look (by concept, not brittle paths): the decision-outcome union + verdict shape and its frontmatter/verdict parser; the apply-rung dispatch that switches on the outcome; the disposal executor that performs the `git rm` today (the discharge-by-deletion path shared with the direct `drop` verb); the work-layout module that owns the `tasks/cancelled/` and `specs/dropped/` folder keys and the `git mv` helper. Seams to test at: inject a canned verdict with `outcome: dispose` for each of an observation / task / spec source and assert the on-disk effect (rm vs mv-to-terminal) plus that a task is never `git rm`-ed.
>
> Note the STANDALONE `drop <slug>` CLI verb is OUT OF SCOPE here (it is captured separately in `work/notes/observations/drop-and-delete-git-rm-tasks-instead-of-moving-to-cancelled-terminal-2026-07-13.md`); this task changes only the APPLY-rung disposition. Do not change the folder words, and do not add a second `cancel` token — the rename-to-polymorphic-`dispose` IS the decision.
>
> Done = the outcome/channel renamed everywhere, the three regime branches implemented + tested, no task-hard-delete path reachable, and the full acceptance gate green. RECORD any non-obvious in-scope decision (e.g. how the task `reason:` is threaded into the moved body) durably and linked from the done record.
