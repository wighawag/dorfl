---
title: 'an AUTONOMOUS (do/advance) integration-time REFUSAL must SURFACE the item to needs-attention (or fail loud), never silently strand it in in-progress/ — today a post-claim `refused` is caught in performComplete and returned as exit 1 with NO surface, so the slug rots in in-progress/ and the next tick re-claims it forever'
slug: autonomous-integration-refusal-surfaces-not-strands-in-progress
spec: ledger-integrity
needsAnswers: false
blockedBy: [autonomous-path-auto-recovers-already-committed-stranded-branch]
covers: [7]
---

## What to build

Close the AUTONOMOUS-path safety hole where a post-claim integration REFUSAL leaves the item silently stuck in `in-progress/` on the arbiter with no `needs-attention/` bounce and no surface — so a CI `advance`/`do` tick that hits an unexpected integration refusal neither self-recovers nor becomes visible, and the next tick just re-claims the same stuck item and crashes the same way.

### The incident (the strand, distinct from the crash itself)

The CI `advance "slice:<slug>" --propose` that threw `nothing to complete` (see the sibling slice `autonomous-path-auto-recovers-already-committed-stranded-branch`) did NOT route the item to `needs-attention/`. It returned exit 1 and left `work/in-progress/<slug>.md` on the arbiter. So:

- `scan`/`status`/another machine see the item as a live in-flight claim, not a stuck one needing a human.
- The next hourly tick re-claims it (it is "in-progress", so re-claim/continue picks it up) and hits the identical crash — an infinite no-progress loop with no surfaced signal.

The CRASH itself is removed by the sibling slice (auto-recover the stranded-done branch). THIS slice is the GENERAL safety net for every OTHER refusal that can still reach the autonomous integration path: it must not silently strand the item in `in-progress/`.

### Where the refusal actually is (VERIFIED — corrects an earlier draft)

The earlier draft pointed at the `do.ts` integration tail (~L1053-1102) and said to reuse `saveAgentFailure`. BOTH were wrong; verified against the code:

- **The refusal is caught in `performComplete`, BEFORE `do.ts` sees it.** `runComplete` (`complete.ts`) THROWS `CompleteRefusal` at the source-resolution site (~L462) and at the diverged-local-main site (~L480); `performComplete`'s try/catch (`complete.ts` ~L365-373) catches `CompleteRefusal` (and the core's `IntegrationNothingStaged`) and returns `{exitCode: 1, outcome: 'refused'}`. So the refusal NEVER reaches `performIntegration`, and by the time `do.ts` gets `outcome: 'refused'` the source-folder context is already gone. The surface therefore belongs in `complete.ts` (where `surfaceArbiter` and the slug/source are in scope), NOT re-derived in the `do.ts` tail. The `do.ts` tail change is only to map the new surfaced outcome.
- **The correct surface seam is `ledgerWrite.applyNeedsAttentionTransition({arbiter: surfaceArbiter})`** — the SAME one the core's own failures use (`integration-core.ts` ~L591 prepare-fail, ~L651 gate-fail, ~L985 rebase-conflict, ~L1087 rebased-tip fail, ~L2353 review-block). It surfaces the move on `main` + pushes the branch when `surfaceArbiter` is set, and routes LOCAL-only when it is unset (the human-vs-autonomous gate). Do NOT use `saveAgentFailure`: that classifies via `classifyFailureCause` and returns an `agent-failed`/`transient-infra`/`config-error` outcome (NOT a needs-attention one) AND writes a wip + on-branch move-only commit — conceptually wrong for a `refused` (the work is not an agent failure) and it re-introduces the on-branch ledger move the `humanOnly` SPEC `branch-carries-code-not-ledger-status-main-owns-status` is removing.

### The asymmetry, verified

- **`run` (the fleet daemon) is already defended.** It wraps `performIntegration` in a `try/catch` (`run.ts` ~L927) that routes any thrown core error through `saveAgentFailure` → needs-attention ("never crash the tick"), and maps the core `invariant-violation` refusal to needs-attention explicitly (`run.ts` ~L961-973, comment: "`complete.ts` mirrors this refusal with exit 1").
- **`do`/`advance` is NOT.** A `refused` returned by `performComplete` falls through `do.ts` (~L1101) to `return {exitCode: 1, outcome: 'refused'}` with no surface — the item stays in `in-progress/`. `do` already passes `surfaceArbiter: tree.arbiterRemote` (~L1044), so the autonomous-vs-human signal is present; only the handling is missing.

> The human-vs-autonomous gate is `surfaceArbiter` being set. A HUMAN in-place `complete` (no `surfaceArbiter`) that refuses must stay a local refusal (the human is right there — never auto-bounce their checkout). So the new bounce is gated on `surfaceArbiter` being present, mirroring every other failure route in the core.

### WHICH refusals get the bounce (do NOT blanket-bounce every `refused`)

There is more than one `CompleteRefusal` cause; they are NOT all stuck-slice strands:

- **`nothing to complete` (source missing, `complete.ts` ~L462) on an autonomous run** ⇒ BOUNCE to needs-attention. This is the strand. (After the sibling slice lands, the stranded-DONE sub-case is recovered earlier and never reaches here; the bounce remains the backstop for any OTHER way the source goes missing under an autonomous claim.)
- **`local main is ahead of <arbiter>/main` (diverged-main, `complete.ts` ~L480)** ⇒ do NOT bounce. This is an operator/env condition about the local checkout, not a stuck slice; bouncing the slice to needs-attention would mis-attribute an env problem to the work. It keeps its current `refused` return. (And note the autonomous `do` path passes `ignoreDivergedMain: true`, so this site is largely inert there — but be explicit, do not bounce it.)
- **`IntegrationNothingStaged` (core empty-commit refusal)** ⇒ decide explicitly and record: on an autonomous run a genuinely-empty integration is itself a "nothing happened, item still claimed" strand, so it SHOULD bounce; pin the decision with a test either way. Do NOT silently leave it stranding.

So the bounce is keyed on (autonomous `surfaceArbiter` set) AND (the refusal is a SOURCE-strand class), never a blanket re-route of every `refused`.

## Acceptance criteria

- [ ] **An autonomous source-strand `refused` SURFACES to `needs-attention/`** via `ledgerWrite.applyNeedsAttentionTransition({arbiter: surfaceArbiter})` (the SAME seam the core's gate-fail uses — move on main + branch push + recorded reason), returning a needs-attention-family outcome, NOT a bare `refused` that leaves `in-progress/` untouched. A throwaway-git fixture induces a source-missing `refused` on an autonomous run (`surfaceArbiter` set) and asserts: the arbiter shows the slug in `needs-attention/` (not `in-progress/`), the reason is recorded, and the item no longer strands.
- [ ] **A HUMAN in-place refusal is UNCHANGED** (no `surfaceArbiter`): still `refused` exit 1, the human's checkout NOT bounced to needs-attention. A test pins this (the gate is `surfaceArbiter`).
- [ ] **The diverged-main `refused` is NOT bounced.** A `local main is ahead` refusal keeps its current `refused` return on both human and autonomous paths (it is an env/operator condition, not a stuck slice). A test pins that it does NOT surface to needs-attention.
- [ ] **`IntegrationNothingStaged` disposition is explicit + tested.** Pin (in `## Decisions`) whether an autonomous empty-integration bounces to needs-attention (recommended — it is a no-progress strand) or stays `refused`, and a test asserts the chosen behaviour; it is never a silent strand.
- [ ] **Surface-cannot-land is honest, never swallowed.** When the tree-less surface cannot land (lost the CAS race / no arbiter), the result reflects that the item is honestly still in-progress on the arbiter (reuse the existing `surface-unmoved`-style signal the gate-fail path already produces via the seam's `moved:false`), never a fake success. A test pins this.
- [ ] **No infinite re-claim loop.** After the bounce the item is in `needs-attention/` on the arbiter, so the next autonomous tick does NOT re-claim it as a fresh in-progress build. A test asserts the post-bounce arbiter state is `needs-attention/`, not `in-progress/`.
- [ ] **Owned in `complete.ts`, not re-derived in `do.ts`.** The surface decision lands where `surfaceArbiter` + the slug/source are in scope (`complete.ts`, before/at the `CompleteRefusal` catch), so the source-folder context is not lost; the `do.ts` tail only maps the new outcome. No second surfacing mechanism, no on-branch ledger move (do NOT use `saveAgentFailure`). A test/comment documents the seam choice.
- [ ] No shared/global location touched outside temp fixtures (throwaway `--bare` `file://` arbiters + real clones; point `workspacesDir` at a temp dir; no network).
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `autonomous-path-auto-recovers-already-committed-stranded-branch` — SAME-FILE SERIALISATION: both slices edit `complete.ts`'s source-resolution region (~L455-466). The sibling adds the recover-already-committed route AT that site; THIS slice adds the autonomous-refusal surface around the same `CompleteRefusal` throw/catch. Serialise to avoid a guaranteed merge conflict, and build THIS slice on the POST-sibling reality: the stranded-DONE case is already handled, so this slice's bounce is the backstop for the REMAINING refusal causes. Re-read `complete.ts` (your drift-check) and add the surface ON TOP of whatever the sibling landed; do not re-handle the stranded-done case.

## Decisions (to record while building)

- The seam: surfacing the autonomous source-strand refusal through `applyNeedsAttentionTransition(surfaceArbiter)` in `complete.ts` (NOT `saveAgentFailure`, NOT the `do.ts` tail) and WHY (context-in-scope; no on-branch move; parity with the core's other failure routes).
- The exact set of refusals that bounce (source-strand + the `IntegrationNothingStaged` decision) vs excluded (diverged-main), and the `surfaceArbiter`-set autonomous gate.
- `do --remote`/`performDoRemote` coverage: confirm it reaches the same `complete.ts` path and inherits the fix.
- The parity note: this brings `do`/`advance` to `run`'s "an autonomous failure NEVER silently strands the item in in-progress/" posture; record so a future reader sees the two paths now agree.

## Prompt

> FIRST, drift-check: re-read `src/complete.ts` (~L362-373 the `performComplete` try/catch that maps `CompleteRefusal`/`IntegrationNothingStaged` → `refused`; ~L455-466 the source-missing `CompleteRefusal`; ~L476-483 the diverged-main `CompleteRefusal`); `src/integration-core.ts` (the failure routes ~L591/651/985/1087/2353 all calling `ledgerWrite.applyNeedsAttentionTransition({arbiter: input.surfaceArbiter})` — the seam to MIRROR, and the `surfaceArbiter` doc ~L312-318 = the human-vs-autonomous gate); `src/do.ts` (~L1044 `surfaceArbiter` set proving `do` is autonomous; ~L1053-1102 the outcome dispatch where `refused` falls through with no bounce); `src/run.ts` (~L927 try/catch and ~L961-973 the `invariant-violation`→needs-attention parity target). CONFIRM the sibling slice `autonomous-path-auto-recovers-already-committed-stranded-branch` has landed (this is `blockedBy` it) and re-read its `complete.ts` change so you build ON it, not over it. If an autonomous-refusal bounce already exists, route to needs-attention noting that.
>
> GOAL: bring `do`/`advance` to parity with `run`'s "an autonomous failure NEVER silently strands the item in in-progress/" posture. An autonomous SOURCE-STRAND `refused` (and, per your pinned decision, an autonomous `IntegrationNothingStaged`) must SURFACE to needs-attention via `applyNeedsAttentionTransition(surfaceArbiter)` in `complete.ts` — so `scan`/`status`/another machine see the stuck item and the next tick does NOT re-claim-and-recrash forever. PRESERVE the human in-place refusal unchanged (gated on `surfaceArbiter`).
>
> SAFETY / SCOPE: do NOT blanket-bounce every `refused` — the diverged-main refusal (`local main is ahead`) is an env/operator condition, NOT a stuck slice; leave it `refused`. Do NOT use `saveAgentFailure` (it returns an agent-failed-family outcome and writes a wip + ON-BRANCH `→needs-attention` move — wrong outcome, and it re-introduces the on-branch ledger move the `humanOnly` SPEC `branch-carries-code-not-ledger-status-main-owns-status` is removing). Use the tree-less `applyNeedsAttentionTransition(surfaceArbiter)` seam (arbiter-truth, idempotent) the core's other failures use; when it cannot land, surface the honest still-in-progress signal (`moved:false`), never a fake success.
>
> SEAM TO TEST AT: the autonomous integrate path with throwaway `--bare` `file://` arbiters + real clones — (a) autonomous source-strand `refused` ⇒ arbiter shows needs-attention/ (not in-progress/); (b) human refusal (no `surfaceArbiter`) ⇒ unchanged `refused`, checkout NOT bounced; (c) diverged-main refused ⇒ NOT bounced; (d) `IntegrationNothingStaged` ⇒ the pinned behaviour; (e) surface cannot land ⇒ honest still-in-progress signal. Point `workspacesDir` at a temp dir; no network.
>
> DONE: an autonomous source-strand integration refusal surfaces to needs-attention (or the honest cannot-land signal), the human refusal + the diverged-main refusal are unchanged, the infinite re-claim loop is gone, the surface is owned in `complete.ts` (not `do.ts`, not `saveAgentFailure`), `## Decisions` records the seam + the bounce-set + the `do --remote` coverage + the `run`-parity note, and `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.

## Needs attention

PR/code review (Gate 2) blocked this work:
- In-place `performDo` does not map the new `strand-surfaced` / `surface-unmoved` outcomes — they fall through to `usage-error`. Update do.ts ~L1073-1113 to mirror what `runRemotePipeline` (~L2141-2175) now does, and add a `performDo`-level test. (complete.ts now returns `outcome: 'strand-surfaced'` or `'surface-unmoved'` from `performComplete`. The in-place dispatch at do.ts L1073-1093 enumerates `prepare-failed/gate-failed/review-blocked/rebase-conflict → outcome: 'needs-attention'` and defaults at L1112 to `completed.outcome === 'refused' ? 'refused' : 'usage-error'`. Neither new outcome is enumerated, so an autonomous in-place `do --propose` (and `advance slice:...` via the default `doDriver = performDo`, advance.ts L428) returns `DoOutcome 'usage-error'` for a strand surface, whereas `runRemotePipeline` returns `'needs-attention'` / `'surface-unmoved'`. The slice explicitly says `the do.ts tail only maps the new outcome` and lists a parity-note + `do --remote coverage` decision; this is the parity miss. The arbiter ledger IS correctly surfaced (complete.ts owns that), so the primary safety hole IS closed — only the caller-visible outcome label is wrong on the in-place path.)
PR/code review (Gate 2) did not reach an approve verdict within reviewMaxRounds=2 round(s); forcing needs-attention (never silently merged or looped).

## Requeue 2026-06-17

Gate-2 nit only: performDo (do.ts ~L1073-1113) doesn't map the new strand-surfaced/surface-unmoved outcomes — they fall through to usage-error. Mirror runRemotePipeline (~L2141-2175) and add a
 performDo-level test. Arbiter ledger surface is already correct; only the in-place outcome label is wrong.

## Needs attention

continue on a kept branch whose 'autonomous-integration-refusal-surfaces-not-strands-in-progress' slice is already in work/done/ produced new uncommitted edits this run — the stranded-done auto-recover was gated off to avoid SILENTLY DISCARDING that work. Finish with `dorfl complete --isolated autonomous-integration-refusal-surfaces-not-strands-in-progress` after committing those edits on `work/slice-autonomous-integration-refusal-surfaces-not-strands-in-progress`, or `dorfl requeue --reset autonomous-integration-refusal-surfaces-not-strands-in-progress` to discard the kept branch and rebuild fresh.
