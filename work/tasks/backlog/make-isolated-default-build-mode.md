---
title: Make isolated the DEFAULT build mode for `do` (build in a job worktree off the arbiter; add an explicit in-place opt-out)
slug: make-isolated-default-build-mode
needsAnswers: true
blockedBy: []
covers: []
---

<!-- open-questions -->
<!--
  TRANSIENT BLOCK — stripped by the apply rung on full resolution.
  This task flips a DECIDED default (ADR command-surface-and-journeys §3), so it
  carries real open questions that must be answered before it is agent-buildable.
-->

## Open questions

1. **Per-repo config for isolated-off-own-arbiter builds — CONFIRM the prerequisite is met.** The default cannot flip while an isolated build could silently run a different `harness`/`verify`/`provider` than the repo declares. A slice landed that reads per-repo `.dorfl.json` from the arbiter's `main` for `--remote` builds (`remote-do-reads-per-repo-config-from-arbiter-main`, done). Does it ALSO cover the isolated-off-THIS-repo's-own-arbiter form (not only foreign `--remote`)? If not, that gap is a `blockedBy` prerequisite, not part of this task. (In-place reads config from the local file; isolated must read it from `main:.dorfl.json` on the arbiter — verify the two agree.)
2. **No-arbiter / offline fallback.** A repo with no configured arbiter has nothing to isolate off. Decide the default behaviour: degrade to in-place automatically, or error with a clear message telling the user to configure an arbiter or pass the opt-out flag. (Lean unclear — pick and record.)
3. **Opt-out flag name.** The true-in-place case must survive as an explicit opt-out. Name it: `--in-place` / `--here` / `--no-isolated`. Pick one; check it against the existing flag surface for coherence.
4. **Local-only / untracked task visibility.** Isolated builds off `origin/main`, so a task (or its deps) that exists only in the local checkout and is not pushed cannot be built isolated — in-place can. Confirm this ergonomic change (default becomes "your task must be on the arbiter") is acceptable, with the opt-out covering the edit-locally-then-build loop.

<!-- /open-questions -->

## What to build

Flip the default build mode for `do <slug>` in a checkout from **in-place** to **isolated**: build in a job worktree off the current repo's arbiter (the same isolation `--isolated` / `--remote` / `run` already use), treating the cwd checkout as an **origin SOURCE only** (resolve the arbiter remote from it, never write/commit in the working tree). Add an explicit opt-OUT flag for the rare true-in-place case. `--remote <r>` is unchanged (foreign repo, isolation already implied).

The default flips like this:

- `do <slug>` → isolated worktree off the arbiter (NEW default).
- `do <opt-out> <slug>` → today's in-checkout behaviour (the current default, now opt-in).
- `do --remote <r> <slug>` → unchanged.

Motivation (the concrete why): it eliminates the cwd-entanglement class of bug ENTIRELY — a concurrent autonomous `do` job can no longer sweep a human's / assistant's uncommitted `work/` files into its own chore commit, because the build never writes the cwd tree. It also converges conductor + daemon + human-worker onto ONE isolation substrate (`run` and `do --remote` already isolate), which collapses much of the `drive-tasks` in-place-vs-remote special-casing.

Because this flips a deliberately-decided default, it is an **ADR amendment**, not a silent change: amend `docs/adr/command-surface-and-journeys.md` §3 (the three-form table + the in-place-default decision) with the new default and the recorded why (cwd-entanglement elimination + substrate convergence).

## Acceptance criteria

- [ ] `do <slug>` in a checkout with a configured arbiter builds in an isolated job worktree off the arbiter; the cwd working tree is UNTOUCHED after the run (no claim-revert / done-move / dist rebuild lands in it).
- [ ] The isolated default reads per-repo `.dorfl.json` (`harness` / `verify` / `provider`) from the arbiter's `main`, so a repo declaring e.g. `harness: pi` gets that harness (never the null adapter). (Depends on OQ1.)
- [ ] The opt-out flag restores today's exact in-place behaviour (dirty-tree refusal included).
- [ ] The no-arbiter / offline case behaves per the OQ2 decision (degrade-to-in-place OR clear error) — deterministically, with a test.
- [ ] `docs/adr/command-surface-and-journeys.md` §3 is amended: the new default, the opt-out, and the recorded why.
- [ ] Tests cover the new default, the opt-out, and the no-arbiter fallback, mirroring the repo's existing `do` / isolation test style.
- [ ] This task makes `do` build in a worktree off the arbiter (an isolated location by construction); tests must isolate any arbiter/worktree scratch (temp dirs) and assert the invoking checkout's working tree is UNCHANGED after the run.

## Blocked by

- None to start the DESIGN, but OQ1 may reveal a per-repo-config prerequisite that must land first — resolve OQ1 before promoting to the pool.

## Prompt

> Build the task 'make-isolated-default-build-mode', described above.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): re-read `docs/adr/command-surface-and-journeys.md` §3 (the three-form model + the current in-place-default decision this amends) and the isolation seam (worktree/fresh-checkout, per the execution-substrate ADR). Confirm OQ1 against the actual code: does the landed `remote-do-reads-per-repo-config-from-arbiter-main` work cover the isolated-off-own-arbiter form, or only foreign `--remote`? If per-repo config is NOT honoured for the isolated-off-own-arbiter form, do NOT flip the default — route to needs-attention (or hold the task) with that gap as a prerequisite, because the default MUST honour the repo's declared `harness`/`verify`/`provider`.
>
> Domain vocabulary: `do` builds a ready task; the three forms are in-place (current default, refuses a dirty tree), `--isolated` (job worktree off THIS repo's arbiter — added as a purely-additive opt-in in the `do-isolated-in-place` slice), and `--remote` (foreign repo, isolation implied). The isolation mechanism itself already exists; this task changes only the DEFAULT + adds the opt-out + defines the no-arbiter fallback + amends the ADR.
>
> RECORD non-obvious in-scope decisions durably (the opt-out flag name, the no-arbiter fallback shape) — these meet the ADR gate, so they belong in the §3 amendment. Reference the originating design (this task was promoted from the idea `make-isolated-the-default-build-mode`, now deleted; its full case-for/against and 5-step sequencing were folded into this file) and `work/notes/observations/drive-backlog-skill-assumes-in-place-do-not-remote.md` (the cwd-as-origin-source-only corollary + the live entanglement evidence).
