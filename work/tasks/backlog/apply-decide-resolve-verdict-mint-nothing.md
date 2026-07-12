---
title: Add a `resolve` verdict to the apply decision agent (answered, mint nothing)
slug: apply-decide-resolve-verdict-mint-nothing
covers: []
blockedBy: []
---

## What to build

The apply-rung decision agent (`apply-decide`) currently offers exactly five verdicts: `{task, spec, adr, delete, ask}` (mint-task | mint-spec | mint-adr | delete-source | ask-follow-up). It has no verdict for the honest case "the human answered, the answers are recorded, and the correct move is to RESOLVE the item without minting a task/spec/adr and without deleting the note." Faced with that case (typically an evidence/watch-item observation whose answer is "keep this on record, no artifact"), the agent has nothing valid to pick, so it loops on `ask` and re-surfaces the same already-answered question every tick. This has already recurred three times across two observations (`recovery-complete-propose-push-reds-ci-on-reaped-work-ref-2026-06-26`, `work-layout-guard-test-flaky-under-parallel-load-2026-06-22`).

The PERSISTER already does exactly the right thing for this case: `applyAnsweredQuestions`'s "resolve fully" path (the default, non-discharge, non-repause branch) harvests the verbatim answers into the item body as a `## Applied answers` block, strips the stale open-questions block, clears `needsAnswers`, and deletes the sidecar in one commit. This is invariant-clean (the `needsAnswers` <=> active-sidecar invariant holds because the sidecar is deleted, so `needsAnswers:false` is legal, not a lie). The note survives with its conclusion baked into the body.

So this is NOT new persistence behaviour and NOT a new lifecycle state or frontmatter axis. The whole slice is: add ONE verdict (`resolve`) to the decision agent's vocabulary and prompt, wire it to route to the ALREADY-EXISTING resolve-fully path, and validate it in the shared verdict parser. `resolve` is a sibling of `delete` (both end the question-loop, mint nothing) but preserves the note instead of deleting it.

Naming note: use `resolve` (not `keep`) as the verdict string — "keep" wrongly connotes "leave it open / do nothing," whereas the semantics are "the questions ARE answered and the loop is resolved; we just mint nothing."

## Acceptance criteria

- [ ] `apply-decide` accepts a new `resolve` verdict (e.g. `{"outcome":"resolve","resolveReason":"…"}`), documented in the decision prompt alongside the existing five, with prompt guidance that `resolve` is the right choice when the answers settle the item and no task/spec/adr should be minted and the note should be RETAINED (not deleted).
- [ ] The shared verdict parser (`parseDecisionVerdict`) validates `resolve` and rejects it if the required field(s) are malformed, mirroring how `delete`/`task`/etc. are validated.
- [ ] A `resolve` verdict routes the apply rung to the EXISTING resolve-fully path of `applyAnsweredQuestions` (answers harvested into `## Applied answers`, open-questions block stripped, `needsAnswers` cleared, sidecar deleted) — NO new persistence path is added, and the note file is retained (not `git rm`-ed).
- [ ] The invariant is preserved: after a `resolve` apply, the item has `needsAnswers:false` and NO sidecar (so `ledger-lint` / the classifier's `needsAnswers` <=> active-sidecar check stays clean).
- [ ] Tests cover: (1) the parser accepts a well-formed `resolve` verdict and rejects a malformed one; (2) an end-to-end apply over a fully-answered observation sidecar with a canned `resolve` verdict lands the note in the resolve-fully end-state (answers in body, sidecar gone, flag cleared) and does NOT create a task/spec/adr and does NOT delete the note. Mirror the existing apply-decide / apply-persist test style.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- None — can start immediately.

## Prompt

> Add a `resolve` verdict to the dorfl apply-rung decision agent so it can honestly handle "the human answered, keep the note on record, mint nothing." Today the decision agent (`packages/dorfl/src/apply-decide.ts`) offers only `{task, spec, adr, delete, ask}` and its prompt says "Do NOT emit any other outcome," so when the correct move is "resolve without minting" it has no valid verdict and loops on `ask`, re-surfacing an already-answered question every tick.
>
> The persister already implements the target behaviour: `applyAnsweredQuestions` in `packages/dorfl/src/apply-persist.ts` has a "resolve fully" default path that harvests the verbatim answers into the item body as a `## Applied answers` block (`withAppliedAnswers`), strips the marker-fenced open-questions block (`stripOpenQuestionsBlocks`), clears `needsAnswers`, and deletes the sidecar in one atomic commit. That path is invariant-clean: after it runs the sidecar is gone, so `needsAnswers:false` is legal (the `needsAnswers` <=> active-sidecar invariant holds). Your job is to give the DECISION agent a verdict that ROUTES to this existing path; do not write a new persistence path.
>
> Scope: (1) add `resolve` to the verdict set/type and the decision prompt in `apply-decide.ts`, with clear guidance on when to pick it (answers settle the item; no task/spec/adr to mint; the note should be RETAINED, distinguishing it from `delete` which drops the note); (2) validate `resolve` in the shared `parseDecisionVerdict`; (3) wire the apply rung so a `resolve` verdict calls the existing resolve-fully path of `applyAnsweredQuestions` (NOT `discharge`/delete, NOT `appendQuestions`/re-pause, NOT a mint); (4) tests as per the acceptance criteria. Use the verdict string `resolve`, NOT `keep`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): confirm the apply decider's verdict set is still `{task, spec, adr, delete, ask}` in `apply-decide.ts`, that `adr` is already wired (it was added by `agentic-apply-mint-adr-route`), and that `applyAnsweredQuestions`'s resolve-fully path still has the shape described (harvest into `## Applied answers`, strip open-questions, clear flag, delete sidecar). If any of that has changed, re-scope against the code rather than this snapshot, and if a dependency landed differently route to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions durably and linked from the done record. In particular: the exact `resolve` verdict field shape (e.g. a `resolveReason` string vs no payload) and whether the harvested `## Applied answers` block is considered sufficient as the retained-disposition record (it is — do NOT invent a separate `## Disposition` convention unless a reviewer asks). If any choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off), write it as an ADR in `docs/adr/`; otherwise a module JSDoc at the choice site or a `## Decisions` block in the done record, linked from the done record.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/<slug>.md work/tasks/done/<slug>.md
```
