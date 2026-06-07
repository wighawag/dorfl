---
title: run/do integrate-path convergence — one shared gate→integrate back-half (integration-core.ts) wrapped by do's in-place tail and run's worktree-reap tail
slug: run-do-integrate-convergence
humanOnly: true
sliceAfter: []
---

> **Launch snapshot, not maintained.** Source material for slicing (`to-slices`);
> once sliced, technical detail moves into the slices and durable rationale into
> `docs/adr/`. Expect this to be outrun by the work — that is fine.
>
> **Design RESOLVED in the 2026-06-07 grilling pass.** This PRD records the ratified
> head/core/tail decomposition and the two-slice plan. Source finding:
> `work/findings/run-and-do-have-separate-integrate-paths.md`.

## Problem Statement

`run` and `do` SHARE the shape of the per-item pipeline but share almost NONE of the
code for the **back-half** (gate → review → done-move → commit → rebase → integrate).
`do`/`complete` run it through `performComplete` (`src/complete.ts`); `run.ts`'s
`runOneItem` has its OWN copy — its own gate (`ctx.testGate`), its own done-move +
completion commit, its own `Integrator` + `integrateWithRebase`. `run.ts` does NOT
import `performComplete`.

This fork is ALREADY producing bugs — three confirmed drift instances (see the
finding):

1. **Review gate (PR #11/#12)** lives in `performComplete` ⇒ `do`/CI get Gate 2;
   `run` does NOT.
2. **PR title + body (PR #15)** was threaded through `do`'s chain ⇒ fleet PRs opened
   by `run` STILL get `gh --fill` (run-on title, empty body — confirmed live on PR
   #15 itself).
3. **The acceptance gate is a PROTOCOL VIOLATION in `run`:** `do` runs
   `runVerify(config.verify)` (the per-repo, language-agnostic gate, ADR §8); `run`'s
   `defaultTestGate` HARDCODES `pnpm -r test` (test-only, no build/format) and
   IGNORES `config.verify` — wrong for any non-Node repo or any custom `verify`.

Every future back-half feature will keep drifting until the back-half is shared.

## Solution

Extract the shared back-half band into a NEW `src/integration-core.ts`
(`performIntegration`), and make BOTH callers thin **HEAD + core-call + TAIL**
wrappers around it. They share a CALLEE — they never call EACH OTHER (which would
couple the human command to the fleet daemon). This is the same "relocate where the
call is expressed, one strategy, no caller-identity branching" discipline the
`ledger-write.ts` write-seam already established, applied to the whole gate→integrate
band.

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

- `cwd` (in-place checkout OR `tree.dir`), `arbiter` (the remote name valid in `cwd`),
  `slug`, `source: 'in-progress' | 'needs-attention'`, `recovering: boolean`.
- Gate: `verify?: VerifyConfig` (per-repo; undefined ⇒ `DEFAULT_VERIFY_COMMAND`),
  `skipVerify?`.
- Review: `review?`, `reviewGate?: ReviewGate`, `autoMerge?`, `reviewModel?`,
  `reviewMaxRounds?`.
- Integration: `mode: IntegrationMode`, `provider: ReviewProvider`, `body?`, `title?`.
- Autonomous surfacing: `surfaceArbiter?` — the ONE knob that encodes human (unset ⇒
  local-only) vs autonomous (set ⇒ surface on main + push branch). DATA, not an
  identity flag.
- Observability passthroughs: `watch?`, `watchSink?`, `color?`, `sessionsDir?`,
  `note?`, `env?`.

OUTPUT `IntegrationCoreResult` — pure data; the core performs the gate/review/move/
commit/rebase/integrate AND the failure routing, but NOT switch/reap/job-records:

- `outcome: 'completed' | 'gate-failed' | 'review-blocked' | 'rebase-conflict'`
- `routedToNeedsAttention: boolean` (the core already called the routing seam)
- `branch`, `reason?` (needs-attention reason; tails map to message/detail),
  `commitMessage?`, `integration?: IntegrateResult` (carries the EFFECTIVE mode +
  url).

### Why this contract has zero caller-identity leakage

Every divergence maps to a FIELD VALUE, not an `if (caller === 'run')` branch:
in-place vs worktree = just `cwd`; arbiter name = just `arbiter`; human vs autonomous
surfacing = `surfaceArbiter`; do's recovery = `source` + `recovering`; per-repo/lang
gate = `verify`. The genuine asymmetries (in-place switch/delete vs worktree reap +
job records) stay in the tails — they are different WORK, not duplicated logic.

## User Stories

1. As the maintainer, I want a back-half feature (review gate, PR title/body, the
   next one) written ONCE and inherited by BOTH `do` and `run`, so the two cannot
   drift.
2. As an operator of the fleet, I want `run` to enforce the SAME per-repo `verify`
   gate the human `do` enforces (build + test + format, or my repo's configured
   command), in ANY language — not a hardcoded `pnpm -r test`.
3. As an operator of the fleet, I want `run`'s propose PRs to carry the same
   synthesised title + agent-summary body that `do`'s do.
4. As the maintainer, I want the convergence to land with NO observable change to the
   human `do`/`complete` path (Slice 1 is a pure refactor), so it is low-risk to
   review and ship.

## Implementation Decisions

- **The core owns the needs-attention routing.** Both callers already route via the
  same `applyNeedsAttentionTransition` seam parameterised by the arbiter; putting it
  in the core writes the subtle failure-handling once. The tails NEVER call the
  routing seam themselves.
- **The core owns the effective-integration-mode decision**, including today's
  `autoMerge`-off `merge`→`propose` downgrade — preserved VERBATIM. The result
  carries the EFFECTIVE mode; both tails read it from the result, never the requested
  mode.
- **The gate is UNIFIED on `runVerify(config.verify)`** — `defaultTestGate` and the
  `TestGate` type are DELETED. This is a protocol-conformance fix (drift #3): `run`
  starts honouring the per-repo, language-agnostic gate it currently ignores. State
  it as an intended behaviour change (ADR note); it upgrades `run`'s gate from
  test-only to the full configured floor.
- **`integration-core.ts` is a NEW file** (not folded into `complete.ts`): a neutral
  home makes the head/core/tail decomposition legible and avoids `run.ts` importing
  from a file whose name/doc are about the human `complete` command. Mirrors the
  `ledger-write.ts` precedent.
- **`do.ts`'s build-agent `output`** already flows into `performComplete` as `body`
  (PR #15); the core just carries it. `run.ts`'s `runAgent` currently DROPS
  `launched.output` — Slice 2 must surface it (mirror `do`'s `runDoAgent`) so fleet
  PRs get a real body too.
- **OUT OF SCOPE — the `autoMerge` concept-collision is FENCED OFF.** The core
  preserves CURRENT behaviour verbatim and takes NO position on the
  merge-vs-propose `autoMerge` ambiguity. Reconciliation is a SEPARATE later effort
  — see `work/findings/automerge-concept-collision-merge-vs-propose.md`.

## Testing Decisions

- **Slice 1 = zero behaviour change.** All existing `do`/`complete` tests stay green
  unchanged (they assert on `outcome`, `routedToNeedsAttention`, message substrings,
  the propose block, and `gh` args — all preserved by the thin wrapper). The proof
  of Slice 1 is "nothing observable changed."
- **Slice 2 acceptance proofs (the drift symptoms become tests):**
  - a `run` item is review-gated (stub a `block` verdict → the item routes to
    needs-attention; `do` already has this test to mirror);
  - a `run` propose PR carries title + body (stub provider records the `gh` args);
  - a repo with a CUSTOM `verify` has THAT command run by `run` (not `pnpm -r test`);
  - a format-only failure (build+test green, format red) routes a `run` item to
    needs-attention (proving the full floor, not test-only).
- **Gate-stub re-pointing:** `run`'s ~15 `testGate: greenGate/redGate` injections
  become `verify: 'exit 0'` / `verify: 'exit 1'` (the same string-command stubs
  `do`'s tests already use — `PASS`/`FAIL`). Mechanical; assertions unchanged.
- House style: vitest, temp work trees, `isolatePiAgentDir`, stubbed provider/agent,
  no real model/network/GitHub.

## Slices

> Two slices. Slice 2 `blockedBy: [slice-1]`. BOTH land BEFORE `run-daemon-reframe`
> (concurrency must wrap ONE converged back-half, not the fork).

1. **`extract-integration-core`** — extract `src/integration-core.ts`
   (`performIntegration` with the contract above, INCLUDING the routing + effective-
   mode decision). `performComplete` becomes HEAD + core-call + TAIL. ONLY
   `do`/`complete` use it. Zero behaviour change; all existing tests green. (`run`
   untouched.)
2. **`run-through-integration-core`** (`blockedBy: [extract-integration-core]`) —
   route `runOneItem`'s steps 5–7 through `performIntegration`; surface
   `launched.output` from `run`'s `runAgent` so the body flows; DELETE
   `defaultTestGate`/`TestGate` and re-point the gate stubs (gate unification, option
   a). Map `IntegrationCoreResult` → `updateJobRecord` + `ItemStatus`. Acceptance =
   the four Slice-2 proofs above.

## Out of Scope

- The `autoMerge` merge-vs-propose concept reconciliation (separate finding +
  later PRD/slice).
- `run-daemon-reframe` (concurrency) — sequenced AFTER this convergence; not part of
  it.
- Any change to `do`'s observable behaviour (Slice 1 is a pure refactor).
- The `pnpm` DEFAULT fallback in `verify.ts` (left as-is; the setup-skill note
  `work/ideas/setup-and-migrate-skills.md` handles making scaffolded `verify`
  stack-appropriate).

## Further Notes

- Source finding (with the three worked drift instances + the resolved design):
  `work/findings/run-and-do-have-separate-integrate-paths.md`.
- Insertion point D in `work/findings/review-gate-vs-slicer-edit-loop.md` ("run
  coverage — converge on do/performComplete FIRST") is satisfied by this PRD.
- The observation `work/observations/run-worktree-path-pr-no-title-body.md` is
  SUPERSEDED (its signal folded into the finding as drift instance #2) and can be
  retired.
