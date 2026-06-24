---
title: extract-integration-core — pull do/complete's gate→integrate back-half into src/integration-core.ts (performIntegration); zero behaviour change
slug: extract-integration-core
prd: run-do-integrate-convergence
blockedBy: []
covers: [1, 4]
---

## What to build

Extract the SHARED back-half band of `performComplete` (`src/complete.ts`) into a NEW `src/integration-core.ts` exporting `performIntegration(input)`. This is a PURE REFACTOR — only `do`/`complete` call the new core; `run.ts` is untouched; the human `do`/`complete` path is byte-for-byte unchanged. It is the safe first step of the run/do convergence (see `work/prd/run-do-integrate-convergence.md` and `work/findings/run-and-do-have-separate-integrate-paths.md`).

The core is the band: **verify gate → review gate (Gate 2) → effective-integration- mode decision → done-move → atomic commit → rebase → integrate (via `ledgerWrite.applyCompleteTransition`) → needs-attention routing on ANY failure**. It returns DATA; it does NO caller-specific side-effects (no `git switch main`, no branch delete, no job records, no propose next-step block).

### The decomposition (head / core / tail)

`performComplete` becomes a thin wrapper: its existing HEAD (repo/arbiter/branch checks, in-progress-vs-needs-attention source resolution, the `recovering` flag) stays in `complete.ts`; it then CALLS `performIntegration`; its existing TAIL (land-on-main / `syncLocalMain` / delete-local-branch / `--no-switch` / the propose next-step block) stays in `complete.ts` and reads the core's returned data.

### The core owns (decisions — do not relitigate; from the PRD)

- **The needs-attention routing** (`applyNeedsAttentionTransition` on red gate / review block / rebase conflict) — one place, parameterised by `surfaceArbiter` (human `complete` passes none → local-only; autonomous `do` passes the arbiter → surface on main + push branch). The tail NEVER calls the routing seam.
- **The effective-integration-mode decision**, INCLUDING the current `autoMerge`-off `merge`→`propose` downgrade — preserved VERBATIM (the PRD fences the `autoMerge` concept-collision OUT of this work; do NOT change its behaviour). The returned `integration` result carries the EFFECTIVE mode; the tail reads mode from the result, never the requested mode.

### The contract

INPUT `IntegrationCoreInput`: `cwd`, `arbiter`, `slug`, `source: 'in-progress'|'needs-attention'`, `recovering`, `verify?`, `skipVerify?`, `review?`, `reviewGate?`, `autoMerge?`, `reviewModel?`, `reviewMaxRounds?`, `mode`, `provider`, `body?`, `title?`, `surfaceArbiter?`, plus the observability passthroughs (`watch?`, `watchSink?`, `color?`, `sessionsDir?`, `note?`, `env?`).

OUTPUT `IntegrationCoreResult`: `{ outcome: 'completed' | 'gate-failed' | 'review-blocked' | 'rebase-conflict'; routedToNeedsAttention: boolean; branch; reason?; commitMessage?; integration?: IntegrateResult }`. (The outcomes already match `CompleteOutcome` — the tail maps 1:1.)

### Scope fence

- IN: the new `src/integration-core.ts` + `performIntegration`; `performComplete` reshaped to HEAD + core-call + TAIL; the routing + effective-mode decision MOVED into the core verbatim.
- OUT: any `run.ts` change (Slice 2); any behaviour change to `do`/`complete`; the gate-unification / `defaultTestGate` deletion (Slice 2); the `autoMerge` reconciliation (separate finding); the `propose` next-step block / switch / reap (stay in the tails).

## Acceptance criteria

- [ ] A new `src/integration-core.ts` exports `performIntegration(input:     IntegrationCoreInput): Promise<IntegrationCoreResult>` with the contract above.
- [ ] `performComplete` calls `performIntegration` and reconstructs its existing `CompleteResult` (outcome, `routedToNeedsAttention`, message, branch, commitMessage, mergedToMain, switchedTo, deletedLocalBranch, prUrl) from the core's returned data — the TAIL (switch/ff/delete-branch/`--no-switch`/propose block) stays in `complete.ts`.
- [ ] The needs-attention routing and the effective-mode (`autoMerge`-off downgrade) decision now live in the core, parameterised by `surfaceArbiter` — NOT in the tail; behaviour is identical (human = local-only, autonomous = surface+push).
- [ ] **Zero behaviour change:** the ENTIRE existing `do`/`complete` test suite passes UNCHANGED (no test edits) — `outcome`, `routedToNeedsAttention`, message substrings, the propose next-step block, and the `gh --title/--body/--fill` args are all preserved.
- [ ] `run.ts` is not modified by this slice.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — startable now. (Slice 2 `run-through-integration-core` depends on THIS.)

## Prompt

> Extract the shared gate→integrate back-half of `performComplete` (`src/complete.ts`) into a NEW `src/integration-core.ts` exporting `performIntegration`. PURE REFACTOR: only `do`/`complete` use it; `run.ts` untouched; the human `do`/`complete` path is byte-for-byte unchanged. This is Slice 1 of the run/do convergence — see `work/prd/run-do-integrate-convergence.md` and `work/findings/run-and-do-have-separate-integrate-paths.md`.
>
> FIRST run the drift check: confirm `performComplete`'s structure is still HEAD (git/arbiter/branch checks, in-progress-vs-needs-attention source resolution, `recovering`) → the gate→review→done-move→commit→rebase→integrate band → TAIL (switch main / `syncLocalMain` / delete-local-branch / `--no-switch` / the `formatProposeNextStep` block). Confirm `ledgerWrite.applyCompleteTransition`, `applyNeedsAttentionTransition`, `runVerify`, the `reviewGate` seam, and `IntegrateResult.mode` are as the PRD assumes. Route to needs-attention on any real discrepancy.
>
> Build the core as the band ONLY, returning DATA (`IntegrationCoreResult`) and performing the needs-attention routing + the effective-mode decision (incl. the `autoMerge`-off `merge`→`propose` downgrade) VERBATIM — DO NOT change autoMerge behaviour (the concept-collision is fenced out: `work/findings/automerge-concept-collision-merge-vs-propose.md`). The human-vs-autonomous difference rides on `surfaceArbiter` (data), never a caller flag. Keep the TAIL (switch/reap-free; the propose block, switch, branch-delete, `--no-switch`) in `complete.ts`, reading the core's result; the tail reads the EFFECTIVE mode from `result.integration.mode`, never the requested mode.
>
> "Done" = the new file + reshaped `performComplete`, the ENTIRE existing `do`/`complete` suite green UNCHANGED (no test edits — the proof of zero behaviour change), `run.ts` untouched, and the gate green.
>
> READ FIRST: `src/complete.ts` (`performComplete` — the function to split — and `CompleteResult`/`CompleteOutcome`); `src/ledger-write.ts` (`applyCompleteTransition` + `applyNeedsAttentionTransition`); `src/integrator.ts` (`IntegrateResult`, `IntegrationMode`); `src/review-gate.ts` (`ReviewGate`); `src/verify.ts` (`runVerify`, `VerifyConfig`); the PRD + the two findings above.
>
> TDD with vitest, house style: the new core has its own unit tests (approve→ completed, red gate→gate-failed+routed, block→review-blocked+routed, rebase conflict→rebase-conflict+routed), AND the existing `do`/`complete` tests stay green unchanged.

---

### Claiming this slice

```sh
dorfl claim extract-integration-core --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/extract-integration-core <remote>/main
git mv work/in-progress/extract-integration-core.md work/done/extract-integration-core.md
```
