# `advance`'s surface/apply rungs can carry MERGE-questions for unmerged branches/PRs, making the runner the merger host-agnostically

2026-06-21

Verified against the advance-loop code (`surface-gate.ts`, `sidecar-apply.ts`, `sidecar.ts`, `triage-persist.ts`). Relevant to the `land-time-reverify-and-parallel-merge-ceiling` brief (resolves OPEN QUESTION 2; closes the propose PR-merge-time gap host-agnostically).

## How surface -> answer -> apply works today

- **surface rung** (`surface-gate.ts`): on `classify=surface`, a fresh-context agent runs the `surface-questions` skill, GATHERS an item's open-judgement residue, and EMITS questions; the ENGINE persists them to the sidecar + sets `needsAnswers: true`. "The skill JUDGES, the engine PERSISTS." Questions are keyed to a work/ ITEM (`slice:foo` / `spec:bar` / `observation:baz`).
- **apply rung** (`sidecar-apply.ts` `applyAtomic`): a single atomic commit that rewrites item body + sidecar; on FULL resolution (every question answered) it clears `needsAnswers` and deletes the sidecar.
- **disposition precedent** (`sidecar.ts` `SidecarDisposition` = `promote-slice|promote-adr|keep|delete|dropped|needs-attention`; `triage-persist.ts`): an answered question's `disposition` ALREADY triggers a RUNNER ACTION on apply (e.g. promote/drop/route an observation), not merely a body edit. So "an answer drives an action beyond body+sidecar" is an EXISTING pattern, not a new concept.

## The idea (user's), mapped onto this machinery

Surface UNMERGED `work/*` branches / open PRs as a NEW kind of question ("branch `work/<slug>` / PR #N is built and pushed - merge it? hold? drop?"); the human's ANSWER is the approval (the human-judgement gate); the APPLY step then LANDS an answered-merge through the EXISTING land primitive (`integration-core.ts`: rebase onto current main -> re-run verify on the rebased tree -> advance).

Two deltas from today's rungs (the accurate framing):
1. **New question SOURCE.** Today surface gathers an item's *judgement* residue. A merge-question is about repo *state* (an unmerged branch / open PR), enumerated by the runner (branches not reachable from `main`; or `gh pr list`), NOT by the `surface-questions` judgement skill. So it is a SECOND surfacer feeding the SAME sidecar shape, with a new disposition (e.g. `merge|hold|drop`).
2. **New apply EFFECT.** An answered `merge` disposition triggers the LAND primitive (the action), the way `promote-slice`/`dropped` trigger their `git mv` today, EXTENDED to invoke rebase+re-verify+advance rather than only a body/sidecar commit.

## Why this is the right closure (not a workaround)

- **It makes the RUNNER the merger** - which the propose-PR-merge-time-drift observation concluded is the ONLY host-agnostic way to close the gap ("the gap closes only when the RUNNER does the merge"). The re-verify then gates the ACTUAL merge-time tree (the rebased tip at apply time), not the stale push-time tip.
- **PR-optional by construction.** The question is about an UNMERGED BRANCH; a bare `--bare` arbiter has branches but no PRs and STILL works (runner enumerates branches, surfaces, lands on answer). GitHub's PR is then a nicer RENDERING of the same question, not a requirement - exactly the git-alone-floor / host-raises-the-ceiling gradient. (`gh pr list` enumeration is the ceiling; branch-reachability enumeration is the floor.)
- **Propose vs merge collapse to one axis:** is a merge-question surfaced for human approval first? Merge = no (auto-land). Propose = yes (answer = approval). Both then run the IDENTICAL apply-time `rebase -> re-verify -> advance`. Human review = answering the question = additive judgement ON TOP of the re-verify, never a substitute - the brief's doctrine, now mechanised.

## The subtlety to decide (staleness of an approval)

An answered-merge is a CONDITIONAL request, not a guarantee: between answer-commit and apply, `main` can move again. Apply rebases + re-verifies; on a RED re-gate (the clean-rebase-but-broken case) apply must REFUSE the merge (route to needs-attention, or re-surface the question), NOT land. So the answer's semantics are "merge IF it still verifies on current main." Open sub-decision: does a CHANGED merge-base re-surface the question even when verify still PASSES (the host-agnostic analogue of GitHub's "dismiss stale approvals when the base changes"), or is a green re-verify enough to honour the prior approval? (Conservative = re-surface on base-change; cheap = green-verify-is-enough.)

This resolves OPEN QUESTION 2 toward "runner merges propose output via advance's surface/apply rungs" and INTERACTS with OPEN QUESTION 1 (the apply-time land is still the serialised critical section needing the cross-job queue/CAS discipline).
