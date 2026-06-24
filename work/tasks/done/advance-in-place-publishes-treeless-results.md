---
title: In-place advance publishes tree-less rung results to the arbiter
slug: advance-in-place-publishes-treeless-results
prd: ci-advance-surfaces-questions-not-only-builds
blockedBy: []
covers: [5, 9, 10]
---

## What to build

Make the IN-PLACE advance drivers publish a tree-less rung's local commit to the
arbiter, so a surfaced question sidecar / triage marker / applied answer actually
lands on the ledger the human reads — instead of dying on the ephemeral CI runner.

The tree-less lifecycle rungs (`surface` / `apply` / `triage-observation`, the set
`TREELESS_RUNGS`) commit their result LOCALLY in the working checkout. The existing
`pushTreelessResult` helper ff-pushes that local `main` to the arbiter (with a
bounded re-fetch+rebase retry). It is already wired into the `--isolated` one-shot
driver and the `run` loop driver, but NOT into the in-place drivers CI uses. This
slice closes that gap.

End-to-end path: after an in-place advance tick wins its lock and runs a tree-less
rung successfully, ff-push the local commit to the configured arbiter, reusing the
existing helper VERBATIM (do not fork it — its rebase-retry is load-bearing for a
sequential `-n` batch that integrates a build/slice rung mid-batch and then pushes
a later tree-less rung that is non-fast-forward by construction).

This independently fixes the CI MERGE job's answer-loop (it already enumerates the
lifecycle pools via the in-place auto-pick path; it just never published them).

Scope:

- Wire `pushTreelessResult` into the in-place advance path used by `advance -n` /
  auto-pick (the multi-item driver) AND by a single named `advance <id>` (the
  single-item tick), fired when the rung is in `TREELESS_RUNGS`, the tick exited 0,
  and an arbiter is configured.
- Match the `--isolated` / loop driver call sites byte-for-byte in shape (same
  `retries`, same non-fatal note-on-failure behaviour, NEVER `--force`).
- Do NOT push for build/slice rungs (they integrate via the `do`/`doDriver` band
  already) and do NOT push when no arbiter is configured (the laptop's live
  checkout case, where the commit is already on the real `main`).
- Gate the push PURELY on `TREELESS_RUNGS.has(result.rung)` + exit 0 + arbiter
  configured — EXACTLY as the `--isolated` / loop drivers do. Do NOT add a cleverer
  guard. In particular: an `apply` rung whose answer was a `promote-slice` /
  `promote-adr` does its OWN CAS to the arbiter (via `promoteObservation`) and
  commits NOTHING tree-less — the existing drivers STILL call `pushTreelessResult`
  for it, and that is SAFE because an ff-push of a HEAD with nothing new is a clean
  no-op. Mirror that: a promote-apply push must be a harmless no-op, never a
  double-publish or a clobber of the promote CAS.
- The push targets `main` in BOTH integration modes (propose AND merge): this
  matches the loop + isolated drivers, which push tree-less results unconditionally
  on `TREELESS_RUNGS` with no propose/merge branch. `integrationMode` governs CODE
  integration, not the answer-loop ledger.
- Two in-place entry points need the hook: the per-item loop in
  `runSelectedInSequence` (covers `advance -n` / auto-pick AND the multi-arg form)
  AND the SINGLE named-item path (`advance <id>` with one arg, which calls
  `performAdvance` directly and does NOT go through the sequence runner — the
  easy-to-miss site). The arbiter is read from `AdvanceContext.arbiter` (already
  threaded; `sharedAdvanceContext` keeps it) — do NOT add a new param.

## Acceptance criteria

- [ ] An in-place advance tick that classifies a `surface` rung commits the sidecar
      locally AND ff-pushes it to the arbiter's `main` (the pushed tree contains
      `work/questions/<type>-<slug>.md`).
- [ ] Same for `triage-observation` (a `triaged:` / sidecar commit lands on the
      arbiter) and `apply` (the answer-application commit lands on the arbiter).
- [ ] A sequential `-n` batch that integrates a build/slice rung to `main`
      mid-batch and then runs a later tree-less rung lands the tree-less push via
      the rebase-retry (the non-fast-forward-by-construction case).
- [ ] No tree-less push fires for `build-slice` / `slice-prd` rungs (they integrate
      via the existing band) and none fires when no arbiter is configured.
- [ ] The promote-apply case is covered: an `apply` rung whose answer is a
      `promote-slice` / `promote-adr` (which does its OWN arbiter CAS via
      `promoteObservation`, committing nothing tree-less) still goes through the
      same `TREELESS_RUNGS` gate, and the in-place push is a harmless no-op — it
      does NOT double-publish nor clobber the promote CAS. Asserted by a test.
- [ ] BOTH in-place entry points are hooked: `advance -n` / auto-pick / multi-arg
      (via `runSelectedInSequence`) AND a SINGLE named `advance <id>` (via the
      direct `performAdvance` path) both publish a tree-less result. A test names a
      single surfaceable item and asserts its sidecar reaches the arbiter.
- [ ] The push is non-fatal on failure: a push that keeps failing (or a genuine
      rebase conflict) is reported via the note sink and does NOT crash the tick;
      the work stays committed locally for the next pass.
- [ ] The existing `pushTreelessResult` helper is reused verbatim (not forked); the
      in-place call site GATES PURELY on `TREELESS_RUNGS.has(result.rung)` + exit 0
      + arbiter configured, matching the `--isolated` / loop driver call sites (no
      cleverer guard).
- [ ] Tests cover the new behaviour using the throwaway-git-repo pattern the
      surface/apply/lock tests use, asserting the OBSERVABLE result (a sidecar on
      the arbiter), not the call wiring.
- [ ] Tests ISOLATE all git state in temp/scratch repos (throwaway arbiter +
      checkout); no real home/config/global location is touched.

## Blocked by

- None — can start immediately.

## Prompt

> Wire the EXISTING tree-less publish into the in-place advance drivers so a
> surfaced/triaged/applied lifecycle result reaches the arbiter from a CI in-place
> tick (today it commits locally and is lost on the ephemeral runner).
>
> FIRST, check this slice against current reality (launch snapshot — may have
> drifted): confirm `pushTreelessResult` + `TREELESS_RUNGS` still live in the
> tree-less-publish module and are still called by the `--isolated` one-shot and the
> `run` loop driver, and that the in-place drivers still do NOT call them. If a
> dependency landed differently, route to `needs-attention/` rather than build on a
> stale premise.
>
> Domain vocabulary: a TREE-LESS rung (`surface` / `apply` / `triage-observation`)
> commits a sidecar / `triaged:` / `needsAnswers` marker LOCALLY; only the
> `advancing` borrow + the promote-CAS reach the arbiter on their own. The tree-less
> publish is the ff-push (`HEAD:main`) of that local commit, with a load-bearing
> re-fetch+rebase retry (a sequential `-n` batch mixes rungs, so a later tree-less
> push is non-fast-forward by construction). NEVER `--force`. The build/slice rungs
> are NOT tree-less (they integrate via the `do`/`doDriver` band).
>
> Where to look: the tree-less publish helper module (`pushTreelessResult`,
> `TREELESS_RUNGS`); the two existing call sites (the `--isolated` one-shot driver
> and the `run` loop driver) — MIRROR them; the in-place advance drivers — the
> wiring goes in BOTH the multi-item path (`runSelectedInSequence`, used by `-n` /
> auto-pick / multi-arg) AND the single named-item path (a one-arg `advance <id>`
> calls `performAdvance` directly and does NOT go through the sequence runner — do
> not miss it). The advance tick result carries the classified `rung` to gate on;
> the arbiter is `AdvanceContext.arbiter` (already threaded — do not add a param).
>
> Reuse the helper verbatim (do not fork it). Gate the push PURELY on
> `TREELESS_RUNGS.has(result.rung)` + exit 0 + a configured arbiter — the SAME gate
> the existing drivers use; do NOT add a cleverer guard. WATCH the promote-apply
> case: an `apply` rung whose answer is `promote-slice`/`promote-adr` runs
> `promoteObservation` (its OWN arbiter CAS) and commits nothing tree-less; the
> existing drivers STILL push it and it is a harmless ff no-op — mirror that, do not
> special-case it. Push to `main` in BOTH integration modes (the loop + isolated
> drivers push unconditionally on `TREELESS_RUNGS`, no propose/merge branch).
>
> "Done" = the acceptance criteria pass: an in-place surface/triage/apply tick lands
> its result on the arbiter's `main`; the rebase-retry handles the mid-batch
> integration case; no push for build/slice or for the no-arbiter case; failures are
> non-fatal. Tests use throwaway git repos and assert the observable arbiter state.
>
> Constraints: see `work/findings/ci-advance-surfacing-gap-analysis.md` (the driver
> coverage map + why this is the foundation slice) and the PRD
> `ci-advance-surfaces-questions-not-only-builds`. RECORD any non-obvious in-scope
> decision (e.g. exactly where the push hook sits in the driver) per the slice
> template's decision-recording rule.

---

### Claiming this slice

```sh
dorfl claim advance-in-place-publishes-treeless-results --arbiter origin
git fetch origin && git switch -c work/advance-in-place-publishes-treeless-results origin/main
git mv work/in-progress/advance-in-place-publishes-treeless-results.md work/done/advance-in-place-publishes-treeless-results.md
```
