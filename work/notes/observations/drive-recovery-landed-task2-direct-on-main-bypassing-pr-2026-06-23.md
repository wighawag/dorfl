---
needsAnswers: true
---

# drive-tasks recovery landed task #2 directly on main, bypassing the PR/Gate-2/Gate-3 surface (2026-06-23)

While driving the 4 post-rename cleanup tasks (brief `code-identifier-slice-prd-to-task-brief-rename`),
task #2 `rename-advance-rung-and-sliced-outcome-tokens` hit TWO infra faults in a row:

1. First `do` run: `transient-infra` (model `overloaded_error`) mid-build. Recovered via
   `requeue` (keep+continue) per the runbook.
2. Re-`do`: Gate-1 green (2585 tests), Gate-2 approved, but the final integrate push failed with
   a `--force-with-lease` `[rejected] (stale info)` race (origin's `work/task-...` branch had a
   stale aborted-wip tip `0e133a3` from run 1, on an OLDER main, that diverged from the new green tip).
3. Manual recovery: force-with-lease-pushed the green tip over the stale one (a WORK branch, not main),
   requeued, cleared the mirror lock, re-`do`.
4. That re-`do`: Gate-1 green again (2585 tests), then the KNOWN `review verdict was not valid JSON`
   Gate-2 parser crash.

NET RESULT (the anomaly): task #2's correct, green work reached `origin/main` as THREE raw linear
commits on the first-parent line — `e30a622` (requeue handoff, authored wighawag), `9edf582`
(`chore: save aborted work (wip)`, agent), `90a25bd` (`feat ...; done`, agent) — with NO `(#NNN)`
PR reference. Contrast task #1, which landed as one squashed `... ; done (#217)` via a proper PR.

So task #2:
- BYPASSED `integration: propose` (no PR opened/merged for the final landed content).
- BYPASSED a clean Gate-2-as-PR-review AND the conductor's Gate-3 PR review (the recovery chain
  skipped both, exactly the runbook's stated risk).
- Left WIP + handoff `chore:` commits in main's permanent linear history (not squashed away).

MITIGATION ACTUALLY DONE (per the runbook's "recovery path skips the gates ⇒ you MUST Gate-3 + manual
re-verify" rule): the conductor (a) Gate-3-reviewed the landed diff against task #2's acceptance criteria
— rename complete (`TickRungKind` = `build-task`/`task-brief`; `'sliced'` → `'tasked'`), scope fence held
(the intake `{slice,prd}` artifact-type cluster UNTOUCHED, left for task #3), `intake.ts:1398` ==
`outcome: kind === 'prd' ? 'prd' : 'tasked'` exactly; (b) ran the FULL acceptance gate manually on the
real main tree: build + 2585 tests + format:check all GREEN. So the CONTENT on main is trustworthy.

OPEN (surfaced to the human as a stuck-set decision):
- Whether the WIP/handoff chore commits leaking into main's first-parent history is acceptable, or
  whether main history should be tidied.
- A residual Gate-2 nit (do.ts:548) names the now-renamed `sliced` outcome in a passthrough-contract
  doc comment — a one-word `sliced` -> `tasked` miss in task #2's blast radius (cosmetic, gate green).

ROOT-CAUSE HYPOTHESIS (worth a real task): the `--isolated` recovery path, when the integrate push
loses a `--force-with-lease` race AND/OR the Gate-2 verdict parser crashes, can leave the green work
reachable such that a subsequent sync replays it onto `main` directly rather than re-opening the PR.
The two compounding infra faults are (a) the Gate-2 `review verdict was not valid JSON` parser crash
(already filed) and (b) the stale-info integrate-push race after a requeue from an older-main aborted tip.
The combination defeated the `propose` guarantee for this one task. Recommend a task to make the recovery
path ALWAYS re-open the PR (never land on main) and to squash the requeue/wip chore commits out of the
integrated result.
