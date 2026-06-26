<!-- dorfl-sidecar: item=observation:tasked-prd-needsanswers-sidecar-stranded-no-apply-pool-2026-06-26 type=observation slug=tasked-prd-needsanswers-sidecar-stranded-no-apply-pool-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this signal — should it be tasked as a fix to `lifecycle-gather.ts` (extend the `needsAnswers` candidate set so a tasked PRD's answered sidecar can never be stranded), promoted into a PRD-level decision about which folders may legitimately hold a `needsAnswers` item, or discharged some other way?**

> Observation at `work/notes/observations/tasked-prd-needsanswers-sidecar-stranded-no-apply-pool-2026-06-26.md`.
>
> Claim verified against current code: `lifecycle-gather.ts` `blockedItemsInPlace` gathers `needsAnswers` candidates from `state.ready` (= `tasks/ready/` + `prds/ready/`) and, when `surfaceStaging` is on, from STAGING (`tasks/backlog/` + `prds/proposed/`). `prds/tasked/` is NOT in either set, so the apply pool — which is consume/always-on — never sees a `needsAnswers: true` PRD resting there, and an answered sidecar is silently stranded (no tick ever runs, so even the `needsAnswers <=> active sidecar` invariant in `advance-classify.ts` does not fire).
>
> This is the dual of a sanctioned WORK-CONTRACT rule we just codified ("A PRD that has drifted AFTER it was TASKED" → flip `needsAnswers: true` IN PLACE in `prds/tasked/`, do NOT move back to `prds/proposed/`). The observation reproduced it end-to-end on `land-time-reverify-and-parallel-merge-ceiling`, where a human had to hand-apply the answer.
>
> The observation explicitly says "do NOT build from this note; surface/decide first" and sketches two fix directions (1: extend gather to include `prds/tasked/` for both pools; 2: only APPLY reads `prds/tasked/`, leaving SURFACE pool/staging-only) — the choice between them is real open judgement, not mechanical: option 2 still leaves the case where a tasked PRD's questions must be MINTED (not just consumed) unaddressed unless the human writes the sidecar directly.

_Suggested default: Mint a task to extend `blockedItemsInPlace`'s `needsAnswers` candidate set to include `prds/tasked/` for the APPLY pool unconditionally (the consume side must never strand an answer), and for the SURFACE pool as well so a tasked-and-drifted PRD's questions can also be minted by the normal path — i.e. the observation's option (1). Preserves the invariant the note names: an answered sidecar must never be un-consumable because of where its item rests._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
