---
title: 'CI advance loop must surface questions + triage observations, not only build/slice'
slug: ci-advance-surfaces-questions-not-only-builds
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices.

## Problem Statement

A repo onboarded to the advance-lifecycle CI loop, with the gate family ON
(`observationTriage: ask|auto`, `surfaceBlockers: true`), expects the "human is
the clock" loop to work: CI grooms the observation inbox and renders declared
blockers into answerable question sidecars (`work/questions/**`), the human
answers them on their own time, and the loop applies the answers and proceeds.

Today that loop NEVER ASKS. With every relevant gate on, no question sidecar is
ever produced by CI: there is no `work/questions/` directory at all, even with a
backlog of untriaged observations. The user reasonably concludes "questions
aren't surfacing" and suspects their config, when the config is correct and the
CI machinery has two concrete gaps:

1. **Propose mode never enumerates lifecycle items.** The propose matrix is built
   from `dorfl scan --json` filtered on `eligibility.eligible == true`. A
   `needsAnswers:true` slice/SPEC has `eligible:false` by construction, and
   untriaged observations are not in the scan's slice/SPEC pools at all. So the
   surface/triage rungs never get a matrix leg — only fully-ready ungated items do
   (which build/slice and never ask). This is the SAME class of bug the merged
   `ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` work fixed for
   PRDs, one layer further: the `jq` is build/slice-only.

2. **In-place advance never publishes tree-less results.** The surface / triage /
   apply rungs commit their sidecar / `triaged:` / answer-application LOCALLY in
   the working checkout, then rely on a separate ff-push to the arbiter
   (`pushTreelessResult`, `TREELESS_RUNGS = {surface, apply, triage-observation}`).
   That push is wired into the `--isolated` one-shot and the `run` loop driver, but
   NOT into the in-place drivers CI uses (`performAdvanceAuto` / `performAdvance`).
   So even when an in-place tick DOES surface (the merge job already enumerates the
   lifecycle pools), the sidecar lands on the ephemeral CI runner and is never
   pushed — it vanishes.

Net effect by integration mode:

- **Merge job** (`advance -n 10 --merge`, in-place): enumerates the lifecycle
  pools already, but never publishes them → surfacing silently lost. Needs gap #2.
- **Propose job** (matrix `advance <id> --propose`, in-place): neither enumerates
  the lifecycle items nor publishes them → needs gaps #1 and #2.

## Solution

Bring the CI advance loop to parity with the `run` loop driver, which already does
the right thing (enumerate every pool, then ff-push tree-less results to the
arbiter), WITHOUT introducing a new isolation mechanism and WITHOUT changing what
`integrationMode` means.

Two orthogonal capabilities, mapped to two slices:

- **Publish tree-less results in-place (the foundation).** Wire the EXISTING
  `pushTreelessResult` (with its load-bearing re-fetch+rebase retry) into the
  in-place advance drivers, gated by `TREELESS_RUNGS` and the presence of a
  configured arbiter, exactly as `advance-isolated.ts` and `advance-loop-driver.ts`
  already do. This alone makes the MERGE job's answer-loop work end-to-end.

- **Enumerate lifecycle items into the propose matrix.** Expose a surface/triage
  (and apply) pool on `scan --json`, reusing `buildLifecyclePools`' predicates and
  the config gates (NOT a forked predicate), and extend the `enumerate` step's `jq`
  + the workflow's structural validator to emit `slice:`/`prd:`/`obs:` legs for
  those items alongside the existing eligible-slice / sliceable-SPEC legs. Each
  becomes its own propose leg. Combined with the foundation slice, a propose leg
  surfaces a sidecar that actually lands on `main`.

The tree-less ledger write goes straight to `main` in BOTH integration modes —
this is established precedent (the loop + isolated drivers push unconditionally on
`TREELESS_RUNGS`, with no propose/merge branch). `integrationMode` governs CODE
integration (build/slice branches → PR or merge); it does NOT govern the question
ledger. This keeps "one word, one meaning" honest.

## User Stories

1. As a repo owner with `surfaceBlockers: true`, I want a `needsAnswers:true` slice
   to be rendered into an answerable `work/questions/slice-<slug>.md` sidecar on the
   arbiter by the hourly CI tick, so that I can answer the blocker in-repo and
   unblock the slice without touching my laptop.
2. As a repo owner with `observationTriage: ask`, I want each untriaged observation
   to surface a promote/keep/delete triage question via CI, so that my observation
   inbox is groomed by the loop and I only have to answer.
3. As a repo owner with `observationTriage: auto`, I want the no-question
   observations auto-dispositioned and the judgement-call ones surfaced as
   questions by CI, so that the conservative auto-triage exception actually runs in
   CI (not just on a laptop).
4. As a repo owner, after I commit an answer to a question sidecar, I want the
   on-answer-committed trigger (`push: work/questions/**`) to re-run the loop and
   the apply rung to consume my answer and advance the item, so that the loop
   drains as I answer.
5. As a repo owner in MERGE mode, I want surfaced sidecars / triage markers / answer
   applications to land on `main` (not vanish on the CI runner), so that the
   "human is the clock" loop is real in merge mode.
6. As a repo owner in PROPOSE mode, I want the surface/triage/apply lifecycle items
   enumerated into the matrix as their own legs, so that the answer-loop runs in the
   conservative default integration mode, not only in merge mode.
7. As a repo owner, I want a lifecycle leg to NEVER also appear as a build/slice leg
   for the same item (no double-leg), so that the matrix does not run two
   contradictory rungs on one item in one tick.
8. As a repo owner, I want the answer-loop ledger writes to go to `main` in BOTH
   propose and merge modes (NOT gated behind a PR per sidecar), so that
   `integrationMode` keeps meaning "how CODE integrates" and the question ledger is
   not held hostage to a code-review PR.
9. As a maintainer, I want the in-place tree-less push to carry the SAME
   re-fetch+rebase retry the loop driver uses, so that a sequential `-n` batch that
   mixes a mid-batch build/slice integration with a later tree-less push still lands
   (the later push is non-fast-forward by construction).
10. As a maintainer, I want NO new isolation machinery in CI (`--isolated`/`--remote`
    stay laptop-only) and NO new `autoAdvance` gate — the fix reuses the existing
    `pushTreelessResult` helper and the existing gate family, so the workflow's
    stated discipline is preserved.
11. As a maintainer, I want `scan --json`'s new lifecycle pool gated by the SAME
    `surfaceBlockers` / `observationTriage` config the engine uses (resolved per
    repo), so that a calm-default repo (gates off) emits an empty lifecycle pool and
    the matrix is unchanged — the fix is inert until a repo opts in.

### Autonomy notes (gate axes)

- `humanOnly`: OMITTED. Slicing this SPEC is mechanical — the design and slice
  boundaries are settled; an agent may auto-slice it.
- `needsAnswers`: OMITTED. The one genuine design fork (does a tree-less rung in
  propose mode open a PR or push straight to `main`?) is RESOLVED by precedent
  (push straight to `main` in both modes — the loop + isolated drivers already do
  this unconditionally on `TREELESS_RUNGS`). No open questions block slicing.

> Sliced into `work/backlog/`: `advance-in-place-publishes-treeless-results`
> (the foundation — Slice B) and `ci-propose-matrix-enumerates-lifecycle-items`
> (Slice A, `blockedBy` the foundation). The Implementation / Testing detail moved
> into those slices; the driver-coverage + ordering rationale lives in
> `work/findings/ci-advance-surfacing-gap-analysis.md`.

## Out of Scope

- A new `autoAdvance` gate — the lifecycle decomposes into the existing gate family
  (`observationTriage` / `surfaceBlockers` + always-on apply). NOT added.
- `--isolated` / `--remote` in CI — these stay laptop-only; CI runs in-place and the
  fix keeps it that way (the in-place push is the whole point).
- Opening a PR per question sidecar in propose mode — explicitly rejected
  (tree-less ledger writes go to `main`; see Implementation Decisions).
- Re-architecting `pushTreelessResult` or the lifecycle-pool enumeration — both are
  reused verbatim; this SPEC only WIRES them into the in-place + propose CI paths.
- Changing the cron cadence / triggers — the existing `schedule` + `push:
  work/questions/**` + `workflow_dispatch` triggers are correct; surfacing +
  on-answer re-run already compose once enumeration + publish work.

## Further Notes

- Provenance: `work/observations/ci-advance-matrix-excludes-needsanswers-so-questions-never-surface.md`
  (the spotted signal) and `work/findings/ci-advance-surfacing-gap-analysis.md`
  (the full driver coverage map + ordering analysis backing this SPEC).
- Ordering / matrix interaction (settled in the finding): the propose matrix is
  parallel (one PR/leg per item) and `selectionOrder` is a SEQUENTIAL-driver concern
  that does not apply to it; lifecycle progression (surface → human answer → build,
  and SPEC-slice → slice-build) is CROSS-TICK (the cron cadence + the on-answer
  trigger are the ordering), so there is no intra-tick ordering dependency to model
  in the matrix.
- Prior art to mirror exactly: the merged
  `ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` (the `jq`
  SPEC-enumeration fix) for Slice A; `advance-isolated.ts` /
  `advance-loop-driver.ts`'s `pushTreelessResult` call sites for Slice B.
