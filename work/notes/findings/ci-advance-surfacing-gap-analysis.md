---
title: Analysis — how A (enumerate) + B (treeless push) must compose to make CI surface questions, with no redundancy and correct ordering
type: finding
status: incubating
source: read of packages/dorfl/src on 2026-06-16 — advance-drivers.ts, advance-loop-driver.ts, advance-isolated.ts, advance-treeless-publish.ts, advance-lifecycle-template.ts, scan.ts, lifecycle-pools.ts, select-priority.ts, select-order.ts, cli.ts (advance command), eligibility.ts
---

This is the design analysis that must back the SPEC. It establishes that the fix
is real, locates it precisely per CI integration mode, shows there is NO
redundancy, and answers the ordering / matrix-interaction questions.

## The two independent capabilities a CI tick needs for the answer-loop

1. **ENUMERATE** the lifecycle items (untriaged observations → triage; `needsAnswers`
   slices/PRDs with no all-answered sidecar → surface; with an all-answered sidecar
   → apply) into whatever the tick acts on.
2. **PUBLISH** the result of a *tree-less* rung (surface / triage / apply commit a
   sidecar / `triaged:` / `needsAnswers` marker LOCALLY) to the arbiter, so it
   actually lands on the ledger the human reads.

`build`/`slice` rungs are NOT tree-less: they integrate via the `do`/`doDriver`
band (branch → PR/merge) and already publish. The answer-loop rungs are tree-less
and need an explicit `HEAD:main` ff-push — that is `pushTreelessResult`
(`advance-treeless-publish.ts`), gated by `TREELESS_RUNGS = {surface, apply,
triage-observation}`.

## State of each driver TODAY (the redundancy / coverage map)

| Driver | Enumerates lifecycle pools? | Pushes tree-less result? |
| --- | --- | --- |
| `run` loop / registry-set (`advance-loop-driver.ts`) | YES (`buildLifecyclePools`) | YES (`pushTreelessResult`) |
| `--isolated` one-shot (`advance-isolated.ts`) | n/a (named item) | YES (`pushTreelessResult`) |
| **in-place `advance -n` auto-pick (`performAdvanceAuto`)** | **YES** (lifecycleGates from config) | **NO** |
| **in-place named `advance <id>` (`performAdvance`)** | n/a (named) | **NO** |

The in-place paths are the ONLY ones CI uses (the workflow runs in-place: "no
--isolated/--remote"). Both in-place paths are missing the tree-less push. So:

- **CI merge job** (`advance -n 10 --merge`, in-place auto-pick): it ALREADY
  enumerates the lifecycle pools (so Part A is effectively done for merge), but it
  NEVER publishes the tree-less commit → a surfaced sidecar dies on the ephemeral
  CI runner. Merge mode needs **only Part B**.
- **CI propose job** (matrix legs `advance <id> --propose`, in-place named): the
  matrix `jq` is build/slice-only (Part A missing) AND the named tick does not
  publish tree-less (Part B missing). Propose mode needs **both A and B**.

### No redundancy

- A and B are ORTHOGONAL (enumerate vs publish). B is shared by BOTH modes; A is
  propose-only. There is no path where both would double-publish: `pushTreelessResult`
  fires ONLY on `TREELESS_RUNGS` and is a single ff-push of an already-committed
  `main` (the `advancing` borrow / promote-CAS reach the arbiter on their own and
  are deliberately NOT in `TREELESS_RUNGS`, so nothing is published twice).
- A does NOT duplicate the merge path's enumeration: merge uses the sequential
  `performAdvanceAuto` pool; propose uses the matrix `jq` over `scan --json`. They
  are different shapes for different integration modes (the same split the merged
  #144 SPEC-enumeration fix already lives within). A just brings the propose `jq`
  to parity with what `performAdvanceAuto` already enumerates.

## Ordering & matrix interaction (the questions raised)

### Sequential drivers (merge `-n`, `run`): ordering already solved

`selectPrioritised` + `selectionOrder` (`select-order.ts`) pin `apply` FIRST
(consume-always-wins) and rank `build`/`slice`/`surface`/`triage` by the `drain`
default (`[build, slice, surface, triage]` — drain ready work, then create, then
ask). `count`/`-n` bounds the batch. The tree-less rebase-retry in
`pushTreelessResult` is LOAD-BEARING because a build/slice rung can integrate to
`main` mid-batch and a later tree-less push is then non-fast-forward BY
CONSTRUCTION. **Part B must preserve that retry in the in-place path too** (a
sequential `-n` mixes rungs exactly like the loop does).

### Propose matrix: PARALLEL, one PR per item — `selectionOrder` does NOT apply

The propose matrix has NO cross-pool ordering: each eligible/surfaceable/triageable
item becomes an INDEPENDENT leg → its own `advance <id> --propose` → its own PR.
This is fine and even desirable, but four interactions must be stated in the SPEC:

1. **No double-leg for one item.** A `needsAnswers:true` slice has `eligible:false`
   (`eligibility.ts`), so it is NOT in the build pool — it appears ONLY as a
   `surface` leg. An untriaged observation is a separate namespace (`obs:`),
   never also a `slice:`/`prd:` leg. So A's `jq` union cannot emit two legs for
   the same item. (The SPEC must require the `jq` to keep `unique` and to keep the
   pools disjoint by construction.)

2. **PR semantics of a tree-less leg.** A surface/triage/apply leg produces a
   COMMIT (sidecar / `triaged:` / answer-application), not a feature branch from a
   build. The SPEC must decide HOW that commit reaches the human in propose mode.
   Option (a): the tree-less push lands it straight on `main` even under
   `--propose` (surfacing a question is not "merging code" — it is the ledger
   update the human then answers; the on-answer-committed `push: work/questions/**`
   trigger then re-runs). Option (b): open a PR per sidecar. RECOMMENDATION:
   DECIDED BY PRECEDENT — option (a): `--propose` governs CODE integration
   (build/slice); the answer-loop ledger writes are tree-less ff-pushes to `main`
   in BOTH modes. Verified: BOTH `advance-loop-driver.ts` AND `advance-isolated.ts`
   call `pushTreelessResult` (HEAD:main) UNCONDITIONALLY on `TREELESS_RUNGS` — there
   is NO integration-mode branch around the tree-less push. So tree-less ledger
   writes already go straight to `main` regardless of propose/merge; Part B in-place
   must MATCH that. This keeps "one word integrationMode" honest: it governs code,
   not the question ledger. The SPEC states this as DECIDED (precedent cited), not an
   open question.

3. **Cross-tick, not within-tick, progression.** Surfacing a question (create) and
   building a now-ready slice (consume) generally happen across SEPARATE cron ticks,
   not within one matrix run: a surfaced question needs a HUMAN answer before its
   item is buildable, and the human is the clock. Within ONE tick the matrix just
   fans out whatever is currently actionable in parallel. SPEC-slicing → slice-build
   is likewise cross-tick (slicing a SPEC CREATES backlog slices that become eligible
   legs on a LATER tick). So there is no intra-tick ordering dependency to model in
   the matrix — the cron cadence + the on-answer trigger ARE the ordering.

4. **Apply vs surface in propose.** An all-answered sidecar (apply) and an
   unanswered/absent one (surface) are mutually exclusive states of the same item,
   so they never both produce a leg for that item in one tick. Apply legs carry no
   ordering urgency in the parallel matrix (each is independent); the
   "apply-pinned-first" rule is a SEQUENTIAL-driver concern and simply does not
   arise in the matrix.

## What the SPEC should therefore specify (slice boundaries)

- **Slice A — propose-matrix enumerates lifecycle items.** Add a surface/triage(/
  apply) pool to `scan --json` (reusing `buildLifecyclePools`' predicates + the
  config gates, NOT a forked predicate), and extend the `enumerate` `jq` +
  `validateAdvanceLifecycleWorkflow` to emit `slice:`/`prd:`/`obs:` legs for them,
  keeping pools disjoint + `unique`. Mirrors the merged #144 SPEC-enumeration fix.
- **Slice B — in-place advance publishes tree-less results.** Wire
  `pushTreelessResult` (with the load-bearing rebase-retry) into the in-place
  drivers (`performAdvanceAuto` / `performAdvance`) when an arbiter is configured,
  exactly as `advance-isolated.ts` / `advance-loop-driver.ts` already do. This is
  the bug that ALSO silently breaks the merge job's surfacing, so it is the
  higher-leverage slice and arguably should land FIRST (merge mode then works
  end-to-end; propose mode then only needs A).

Dependency: A without B surfaces sidecars that never reach the arbiter in CI →
useless alone. B without A fixes merge mode fully and is independently valuable.
So **B is the foundation; A builds on it** (A's acceptance test needs B's push to
prove a sidecar lands on the arbiter from a propose leg).

## Decisions settled by this analysis (so the SPEC need NOT carry `needsAnswers`)

The PR-vs-direct-push question for tree-less rungs (interaction #2) is SETTLED by
precedent: direct ff-push to `main` in both modes, matching the loop + isolated
drivers (which push unconditionally on `TREELESS_RUNGS`). The SPEC states it as a
DECIDED constraint. No open `needsAnswers` remains for the core design; the only
remaining judgement is slice granularity / acceptance phrasing, which `to-slices`
resolves.
