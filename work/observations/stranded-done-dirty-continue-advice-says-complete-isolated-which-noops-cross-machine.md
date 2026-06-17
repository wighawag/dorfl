---
title: stranded-done dirty-continue refusal advises `complete --isolated <slug>`, which silently NO-OPS from any checkout other than the machine that retained the worktree (e.g. a human laptop finishing a CI-stranded slice) — the cross-machine finish is `git switch` to the branch + plain `complete`
type: observation
status: spotted
spotted: 2026-06-17
---

## What was seen

Live `agent-runner advance "slice:do-fails-fast-when-acceptance-gate-statically-unrunnable" --propose --watch --arbiter origin` run **in CI** on 2026-06-17. The slice was already in `work/done/` from a prior attempt; this run onboarded the kept branch `work/slice-do-fails-fast-when-acceptance-gate-statically-unrunnable`, found the build broken by a sibling-ledger rebase (a new required `kind` arg on `CompleteRefusal` at `complete.ts:753`), fixed it (extended `RefusalKind` with `'gate-unrunnable'`), and reported `pnpm -r build && pnpm -r test && pnpm format:check` green.

Because the slice was already in `done/` AND this run produced new edits, the **dirty-continue gate** (`complete.ts` ~L613-630: `committedRecovery = folderShapeStranded && !dirtyContinue`) correctly refused to silently auto-recover (which would discard the fix), routed the slice to `work/needs-attention/`, and printed the advice:

> Finish with `agent-runner complete --isolated <slug>` after committing those edits on `work/slice-<slug>`, or `agent-runner requeue --reset <slug>` to discard the kept branch and rebuild fresh.

The operator then tried to finish from their **local laptop checkout** (a DIFFERENT machine from the CI runner that did the work):

1. `agent-runner complete --isolated <slug>` → `>> Nothing to recover for '<slug>': no retained isolated worktree found (already integrated and reaped, or never stranded).` (exit 0, no-op).
2. `agent-runner complete <slug>` (no `--isolated`) → `error: not on work/slice-<slug> (HEAD is 'main'). Check out the work branch before completing '<slug>'.`

## Why it matters

The refusal's advice is **wrong for the common CI-stranded case** (an `advance`/`run` in CI strands a slice; a human finishes it from their own checkout):

- **`--isolated` is worktree-LOCAL.** `locateIsolatedRecovery` (`recover-isolated.ts` ~L100) resolves `jobWorktreePath(workspacesDir, arbiterUrl, slug)` and returns `{present:false}` if that directory is absent. The retained worktree only ever existed on the **CI runner** and is reaped when the job ends, so from any other machine `complete --isolated` is a GUARANTEED no-op — it looks like "nothing to do" when in fact the work is sitting committed on the remote branch. This is a silent-wrong-answer footgun: the operator reasonably reads "nothing to recover" as "already done", when nothing has been integrated.
- The advice also says "**after committing those edits**", but on this path the run already WIP-saved the edits (`save aborted work (wip)` commit on the kept branch). So that instruction is stale too — there is nothing left to commit.
- The actually-correct cross-machine finish was: `git fetch origin && git switch -c work/slice-<slug> origin/work/slice-<slug> && agent-runner complete <slug>` (plain `complete` requires HEAD == the work branch; it does NOT fetch or switch — `complete.ts` ~L565-573).

So the protocol's own recovery instruction, when the stranding happened in CI, points the human at the one verb that cannot work from their checkout, and away from the verb that can.

## Refs

- Refusal advice strings: `packages/agent-runner/src/complete.ts` ~L650-677 (three sites: the routed-to-needs-attention message, and the could-not-route fallback) — all say `complete --isolated <slug>` / `requeue --reset <slug>`.
- `--isolated` locate-or-noop: `packages/agent-runner/src/recover-isolated.ts` ~L100-158 (`locateIsolatedRecovery` + the "no retained isolated worktree found" no-op).
- Plain `complete` on-branch precondition: `packages/agent-runner/src/complete.ts` ~L541-573 (`not on <branch> (HEAD is '<head>')`).
- Also-stale "FINISH the stranded branch" hint after a terminal integrate failure: `do.ts` ~L1151-1153 prints `complete --isolated <slug>` with the same machine-locality assumption.
- This run's slice (currently parked): `work/needs-attention/do-fails-fast-when-acceptance-gate-statically-unrunnable.md`.

## Candidate dispositions (for triage — not decided here)

- Make the refusal advice **machine-aware**: when the run is in CI / the operator may be on a different checkout, advise the cross-machine finish first — `git fetch && git switch -c work/slice-<slug> <arbiter>/work/slice-<slug> && agent-runner complete <slug>` — and present `complete --isolated` only as the SAME-MACHINE shortcut (or have `complete --isolated`, when it finds no local worktree BUT the remote branch exists and is ahead of `<arbiter>/main`, print the switch+plain-complete recipe instead of a bare "nothing to recover").
- Consider letting plain `complete <slug>` (or a `--from-branch`/`--fetch` flag) DO the `fetch` + `switch` itself when HEAD is on main but `<arbiter>/work/slice-<slug>` exists ahead of main, instead of erroring — so a human finishing a CI strand has one verb, not three manual git steps.
- Drop / rephrase the "after committing those edits" clause on the path where the run already WIP-committed (the edits are on the branch, not in a dirty tree).
- Doc-only fallback: if the verbs stay as-is, the CI workflow's surfaced-needs-attention summary (what CI prints / writes) should spell out the cross-machine finish recipe, since the in-CLI advice assumes same-machine.

## Update (2026-06-17 — RESOLVED)

Fixed directly. `complete.ts` now routes all three dirty-continue refusal messages through a shared `finishStrandedBranchAdvice(slug, branch, arbiter)` helper that leads with the CROSS-MACHINE finish (`git fetch <arbiter> && git switch -c <branch> <arbiter>/<branch> && agent-runner complete <slug>`, works from any checkout), names `complete --isolated` only as the SAME-MACHINE shortcut, and keeps `requeue --reset` as the discard path. The stale "after committing those edits" clause is gone (the run already wip-commits). `do.ts`'s `recoverIsolatedOneLiner` got the same cross-machine note (it had the identical machine-locality footgun). Tests pin both the cross-machine recipe and the same-machine shortcut. Gate green.
