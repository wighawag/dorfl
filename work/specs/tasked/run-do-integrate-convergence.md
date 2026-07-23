---
title: 'run/do integrate-path convergence — one shared gate→integrate back-half (integration-core.ts) wrapped by do''s in-place tail and run''s worktree-reap tail'
slug: run-do-integrate-convergence
humanOnly: true
sliceAfter: []
---

> **Sliced into `work/backlog/` on 2026-06-07** — Implementation/Testing/Slices detail trimmed to the two slices (`extract-integration-core`, `run-through-integration-core`); durable framing (Problem / Solution / User Stories / Out of Scope) kept here. Source finding: `work/findings/run-and-do-have-separate-integrate-paths.md`. A launched-and-sliced snapshot, not a pending plan.

## Problem Statement

`run` and `do` SHARE the shape of the per-item pipeline but share almost NONE of the code for the **back-half** (gate → review → done-move → commit → rebase → integrate). `do`/`complete` run it through `performComplete` (`src/complete.ts`); `run.ts`'s `runOneItem` has its OWN copy — its own gate (`ctx.testGate`), its own done-move + completion commit, its own `Integrator` + `integrateWithRebase`. `run.ts` does NOT import `performComplete`.

This fork is ALREADY producing bugs — three confirmed drift instances (see the finding):

1. **Review gate (PR #11/#12)** lives in `performComplete` ⇒ `do`/CI get Gate 2; `run` does NOT.
2. **PR title + body (PR #15)** was threaded through `do`'s chain ⇒ fleet PRs opened by `run` STILL get `gh --fill` (run-on title, empty body — confirmed live on PR #15 itself).
3. **The acceptance gate is a PROTOCOL VIOLATION in `run`:** `do` runs `runVerify(config.verify)` (the per-repo, language-agnostic gate, ADR §8); `run`'s `defaultTestGate` HARDCODES `pnpm -r test` (test-only, no build/format) and IGNORES `config.verify` — wrong for any non-Node repo or any custom `verify`.

Every future back-half feature will keep drifting until the back-half is shared.

## Solution

Extract the shared back-half band into a NEW `src/integration-core.ts` (`performIntegration`), and make BOTH callers thin **HEAD + core-call + TAIL** wrappers around it. They share a CALLEE — they never call EACH OTHER (which would couple the human command to the fleet daemon). This is the same "relocate where the call is expressed, one strategy, no caller-identity branching" discipline the `ledger-write.ts` write-seam already established, applied to the whole gate→integrate band.

### The head / core / tail decomposition

```
performComplete (do/complete)            runOneItem (run)
┌─ HEAD (caller-specific) ───────┐       ┌─ HEAD (caller-specific) ───────┐
│ repo/arbiter/branch checks     │       │ claim, jobWorktreeStrategy.    │
│ on-work-branch check           │       │   prepare (tree.*),            │
│ in-progress vs needs-attention │       │ continueRebaseConflict,        │
│ recovering flag                │       │ runAgent, saveAgentFailure     │
└────────────────────────────────┘       └────────────────────────────────┘
┌─ CORE — src/integration-core.ts: performIntegration() ─────────────────┐
│ verify gate (runVerify) → review gate → effective-mode decision →      │  SHARED
│ done-move → atomic commit → rebase → integrate (applyCompleteTransition)│  (extract)
│ → needs-attention routing (applyNeedsAttentionTransition) on any failure│
│ returns DATA: {outcome, routedToNeedsAttention, branch, commitMessage,  │
│                integration?, reason?}                                    │
└─────────────────────────────────────────────────────────────────────────┘
┌─ TAIL (caller-specific) ───────┐       ┌─ TAIL (caller-specific) ───────┐
│ switch main / syncLocalMain /  │       │ updateJobRecord(done/needs-    │
│ delete-local-branch /          │       │   attention, prUrl, reason) /  │
│ --no-switch / propose block →  │       │ teardown() reap →              │
│ CompleteResult                 │       │ ItemResult                     │
└────────────────────────────────┘       └────────────────────────────────┘
```

### The core contract (`performIntegration`)

INPUT `IntegrationCoreInput` — everything the core needs, nothing caller-shaped:

- `cwd` (in-place checkout OR `tree.dir`), `arbiter` (the remote name valid in `cwd`), `slug`, `source: 'in-progress' | 'needs-attention'`, `recovering: boolean`.
- Gate: `verify?: VerifyConfig` (per-repo; undefined ⇒ `DEFAULT_VERIFY_COMMAND`), `skipVerify?`.
- Review: `review?`, `reviewGate?: ReviewGate`, `autoMerge?`, `reviewModel?`, `reviewMaxRounds?`.
- Integration: `mode: IntegrationMode`, `provider: ReviewProvider`, `body?`, `title?`.
- Autonomous surfacing: `surfaceArbiter?` — the ONE knob that encodes human (unset ⇒ local-only) vs autonomous (set ⇒ surface on main + push branch). DATA, not an identity flag.
- Observability passthroughs: `watch?`, `watchSink?`, `color?`, `sessionsDir?`, `note?`, `env?`.

OUTPUT `IntegrationCoreResult` — pure data; the core performs the gate/review/move/ commit/rebase/integrate AND the failure routing, but NOT switch/reap/job-records:

- `outcome: 'completed' | 'gate-failed' | 'review-blocked' | 'rebase-conflict'`
- `routedToNeedsAttention: boolean` (the core already called the routing seam)
- `branch`, `reason?` (needs-attention reason; tails map to message/detail), `commitMessage?`, `integration?: IntegrateResult` (carries the EFFECTIVE mode + url).

### Why this contract has zero caller-identity leakage

Every divergence maps to a FIELD VALUE, not an `if (caller === 'run')` branch: in-place vs worktree = just `cwd`; arbiter name = just `arbiter`; human vs autonomous surfacing = `surfaceArbiter`; do's recovery = `source` + `recovering`; per-repo/lang gate = `verify`. The genuine asymmetries (in-place switch/delete vs worktree reap + job records) stay in the tails — they are different WORK, not duplicated logic.

## User Stories

1. As the maintainer, I want a back-half feature (review gate, PR title/body, the next one) written ONCE and inherited by BOTH `do` and `run`, so the two cannot drift.
2. As an operator of the fleet, I want `run` to enforce the SAME per-repo `verify` gate the human `do` enforces (build + test + format, or my repo's configured command), in ANY language — not a hardcoded `pnpm -r test`.
3. As an operator of the fleet, I want `run`'s propose PRs to carry the same synthesised title + agent-summary body that `do`'s do.
4. As the maintainer, I want the convergence to land with NO observable change to the human `do`/`complete` path (Slice 1 is a pure refactor), so it is low-risk to review and ship.

> **Sliced** — the ratified decisions (core owns routing + effective-mode incl. the verbatim `autoMerge` downgrade; gate unified on `runVerify(config.verify)` as a protocol-conformance fix; `integration-core.ts` as a NEW neutral file; surface `run`'s agent `output`), the testing decisions (Slice 1 = zero behaviour change / existing suite green unchanged; Slice 2's four acceptance proofs; the gate-stub re-pointing), and the two-slice plan now live in the slices: `work/backlog/extract-integration-core.md` and `work/backlog/run-through-integration-core.md`. Slice 2 `blockedBy: [extract-integration-core]`; BOTH land BEFORE `run-daemon-reframe` (concurrency wraps ONE converged back-half, not the fork). The `autoMerge` concept-collision is fenced OUT (`work/findings/automerge-concept-collision-merge-vs-propose.md`).

## Out of Scope

- The `autoMerge` merge-vs-propose concept reconciliation (separate finding + later SPEC/slice).
- `run-daemon-reframe` (concurrency) — sequenced AFTER this convergence; not part of it.
- Any change to `do`'s observable behaviour (Slice 1 is a pure refactor).
- The `pnpm` DEFAULT fallback in `verify.ts` (left as-is; the setup-skill note `work/ideas/setup-and-migrate-skills.md` handles making scaffolded `verify` stack-appropriate).

## Further Notes

- Source finding (with the three worked drift instances + the resolved design): `work/findings/run-and-do-have-separate-integrate-paths.md`.
- Insertion point D in `work/findings/review-gate-vs-slicer-edit-loop.md` ("run coverage — converge on do/performComplete FIRST") is satisfied by this SPEC.
- The observation `work/observations/run-worktree-path-pr-no-title-body.md` is SUPERSEDED (its signal folded into the finding as drift instance #2) and can be retired.
