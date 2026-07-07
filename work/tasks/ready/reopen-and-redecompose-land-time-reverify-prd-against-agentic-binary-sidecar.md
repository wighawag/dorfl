## Context

The keystone PRD `agentic-question-resolution-retire-disposition-vocabulary` retired the sidecar disposition vocabulary: there is no `disposition=` field, no `promote-* | keep | delete | dropped | needs-attention` tokens, no picker. Apply is now the agentic `decide(input, allowedOutcomes)` returning one of `{mint-task | mint-prd | delete-source | ask-follow-up}`. Sidecar entries are binary (no-answer | answered).

That retirement INVALIDATED THE PREMISE of the unbuilt merge-question tasks belonging to the sibling PRD `land-time-reverify-and-parallel-merge-ceiling` (currently in `prds/tasked/`). Specifically:

- `tasks/backlog/merge-question-surfacer.md` (covers US #14) — its `## What to build`, a scope bullet, AND an acceptance criterion require emitting merge-questions with `merge | hold | drop` **disposition vocabulary** into the sidecar. There is no longer a `disposition=` field to emit into.
- `tasks/backlog/apply-rung-merge-disposition.md` — specifies extending the apply rung's `promote-slice`/`dropped` disposition-dispatch in `triage-persist.ts` to dispatch an answered `merge` disposition. That dispatch (and `triage-persist.ts`'s disposition routing, the `pickTerminal` picker, `answeredPromoteArtifact`) was removed by the keystone. `merge` is not a `DecisionOutcome` either.
- `tasks/backlog/merge-questions-gate-axis.md` — only GATES whether the surfacer runs; less directly drifted but depends on the surfacer's reshape.

The PRD's GOAL is still valid: surface unmerged `work/*` branches → human answers → apply lands them (LAND primitive: rebase → re-verify → advance). Only the MECHANISM (disposition tokens) is gone. The human has decided: re-open the PRD and re-decompose these tasks against the new model BEFORE any of them are built.

## What to do

1. **Move the PRD back to the open / re-decompose state.** Move `prds/tasked/land-time-reverify-and-parallel-merge-ceiling.md` back to whichever folder the repo's PRD lifecycle uses for "open, awaiting (re-)decomposition" (typically `prds/open/`). Update its frontmatter / status accordingly.

2. **Hold the three affected tasks out of the build pool** for the duration of this work. Do NOT delete them yet — they are the raw material for the re-decompose. Concretely: leave them in `tasks/backlog/` but mark them held (or move them to a holding location if the repo has one) so they cannot be claimed for build. Note in each task body that it is superseded pending the re-decompose landing under this task.

3. **Rewrite the PRD body to reflect the new model.** Preserve the GOAL (surface unmerged `work/*` branches → human answers → land: rebase → re-verify → advance). Replace every reference to disposition tokens / picker / `disposition=` field / `promote-slice`/`dropped` dispatch with the new shape:
   - Sidecar entries are binary (no-answer | answered); the human's answer is plain prose, not a token.
   - Content-outcome decisions go through the agentic `decide(input, allowedOutcomes)` returning `{mint-task | mint-prd | delete-source | ask-follow-up}`.
   - **Runner ACTIONS are a DISTINCT dispatch layer.** Answer-driven runner actions (merge/land for the merge-question surfacer, and the sibling stuck-lock requeue) are dispatched by a separate layer keyed off the surfaced QUESTION'S IDENTITY (its kind / origin / target ref) plus the human's plain answer. They are NOT forced into `decide()`'s content-outcome union — `merge` is not a `DecisionOutcome`.

4. **Resolve the PRD's two existing open cross-cutting questions in the same pass**, so the re-decomposition rests on settled ground:
   - sidecar → branch / lock-ref keying (how a surfaced merge-question or stuck-lock question is keyed back to the specific `work/*` branch or lock ref it acts on);
   - questions-folder shape (where these question sidecars live and how they are named / discovered).
   Pick concrete answers, write them into the PRD, and remove them from the open-questions list.

5. **Re-decompose into fresh tasks under the new model.** For each of the three retired-premise tasks, either (a) rewrite it in place to match the new model, or (b) delete it and mint a fresh replacement task — whichever is cleaner. The replacement set should collectively cover:
   - a surfacer that emits binary merge-question sidecars keyed as decided in step 4;
   - the gate/axis that decides whether the surfacer runs;
   - the runner-action dispatch layer that consumes an ANSWERED merge-question sidecar and performs the land (rebase → re-verify → advance), keyed off question-identity + plain answer;
   - analogous coverage for the sibling stuck-lock requeue action, since it shares the runner-action dispatch layer.
   Each new/rewritten task must be independently buildable and must NOT reference the retired disposition vocabulary.

6. **Discharge the originating observation.** Once the re-decompose has landed (PRD moved, questions resolved, tasks rewritten/replaced, three original tasks either updated or superseded-and-removed), delete `work/observations/observation-merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md` (or whatever its exact filename is) as discharged.

## Acceptance criteria

- `prds/tasked/land-time-reverify-and-parallel-merge-ceiling.md` no longer exists; the PRD lives in the open/re-decompose folder with an updated body that (a) preserves the LAND goal, (b) contains no references to `disposition=`, `promote-slice`, `dropped`, `keep`, `needs-attention`, `pickTerminal`, `answeredPromoteArtifact`, or a `merge | hold | drop` picker, (c) describes the runner-action dispatch layer as distinct from `decide()`, and (d) has zero remaining open cross-cutting questions on sidecar→branch/lock-ref keying and questions-folder shape.
- The three affected tasks (`merge-question-surfacer`, `apply-rung-merge-disposition`, `merge-questions-gate-axis`) are either rewritten in place against the new model or removed in favour of freshly-minted replacements; in NO case does any task in `tasks/backlog/` still require emitting or dispatching on the retired disposition vocabulary.
- No merge-question task is promotable to the build pool that still assumes the retired vocabulary.
- The originating observation file is deleted.
- Repo verify is green: `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check`.

## Non-goals

- Actually BUILDING the surfacer / gate / runner-action dispatch layer. This task only re-opens the PRD and re-decomposes; the freshly-minted replacement tasks are what get built afterward.
- Revisiting the keystone decision to retire the disposition vocabulary — that is settled and is the PREMISE of this work.

## Prompt

> Build the task 'reopen-and-redecompose-land-time-reverify-prd-against-agentic-binary-sidecar', described above.
