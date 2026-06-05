---
title: in-place do/complete should pre-flight-guard local main vs arbiter (unpushed/diverged) like the dirty-tree guard
type: observation
status: spotted
spotted: 2026-06-05
---

# in-place `do`/`complete --merge` fails confusingly when local `main` diverged from the arbiter

## What was spotted (live, building `do-in-place`)

`complete --merge` on the `do-in-place` work pushed the rebased work to
`<arbiter>/main` successfully (the work LANDED on `origin/main`), then tried to
fast-forward the LOCAL `main` to match and FAILED:

```
error: git merge --ff-only --quiet origin/main failed (exit 128):
fatal: Not possible to fast-forward, aborting.
```

Confusing outcome: the important half WORKED (work is on the arbiter), but the
secondary local-sync half failed, leaving the operator thinking the merge failed
when it actually succeeded remotely.

## Root cause

The local checkout's `main` had **2 unpushed commits** (docs/observations) that
`origin/main` did not have. `ar-run.sh`/`do`/`complete` claim+build off
`<arbiter>/main` (the source of truth), so the agent built on a `main` WITHOUT
those local commits; on integration, `complete` pushed to the arbiter then tried
to ff the local `main` \u2014 which can't fast-forward because local `main` had
diverged (commits the arbiter lacks).

Note the design is otherwise CORRECT: `merge` mode IS authoritative against the
ARBITER (`complete.ts`: "push the rebased branch to `<arbiter>/main`, then sync
the LOCAL clone to that new main; the push is authoritative; the local sync
follows"). So `--merge` does merge into the remote `main` (good) \u2014 the failure is
purely the secondary local-ff convenience step when local `main` has drifted.

## The fix: a pre-flight DIVERGENCE GUARD (sibling to the dirty-tree refusal)

The in-place `do` already REFUSES on a dirty working tree (it runs in a real
checkout, must not entangle unrelated state). A **diverged/unpushed local `main`**
is the same class of problem \u2014 a checkout state that will break the in-place flow
\u2014 and deserves the same up-front refusal:

- **Before starting** (in `do`, and the in-place `complete --merge` path), check the
  local integration branch (`main`) against `<arbiter>/main`. If local `main` is
  AHEAD/diverged (has commits the arbiter lacks \u2014 i.e. unpushed work), **refuse with
  a clear message**: "local `main` is ahead of `<arbiter>/main` by N commits
  (unpushed); the slice builds off `<arbiter>/main` and the merge-back can't
  fast-forward \u2014 push or reconcile `main` first." Turn a post-hoc ff failure into an
  actionable pre-flight refusal.
- **Override:** an `--ignore-...`-style flag to proceed anyway (consistent with the
  readiness-guard pattern), for the operator who knows what they're doing.

## What this is NOT

- **NOT "auto-push first".** Auto-publishing the operator's local-only commits before
  a slice is unsafe (could push WIP / unintended state). The operator owns the push.
- **NOT "pull/fetch first for the work".** Already done \u2014 `do`/`start` cut off the
  freshly-fetched `<arbiter>/main`, and `complete` rebases onto it before pushing
  (ADR \u00a76 freshness). The WORK is always built on current arbiter state.
- **NOT "merge to remote instead of local".** `--merge` already merges to the
  ARBITER `main` (authoritative); the local ff is only a follow-on sync.

So the fix is a narrow PRE-FLIGHT CHECK on the local `main` ref vs the arbiter, not
a change to the pull/push/merge model.

## Scope

- Applies to the **in-place** paths that fast-forward the local `main`: `do`
  (in-place) and human `complete --merge`.
- Does NOT apply to `do --remote` / `run` \u2014 those work in job WORKTREES off a hub
  mirror and never touch the operator's local `main`, so they are immune by
  construction.

## Operator workaround (until guarded)

Keep local `main` in sync with the arbiter before running a slice: push any local
docs/observation commits FIRST (`git push origin main`). `ar-run.sh`/`do` assume
`<arbiter>/main` is current; local-only-unpushed commits on `main` will always
diverge on the next slice's merge-back.

## The fix is TWO complementary parts (maintainer, sharpened)

NOT just the pre-flight guard — there are two distinct failure modes and BOTH need
fixing:

1. **Pre-flight GUARD (refuse early, with override).** Before the agent runs,
   refuse if local `main` diverged from `<arbiter>/main` (as above), with an
   `--ignore-...` override. Catches it BEFORE wasting a build.
2. **Post-merge convenience step MUST be NON-FATAL.** The local `main` fast-forward
   is a CONVENIENCE — the authoritative work already landed on `<arbiter>/main`
   (the push succeeded). So when the local ff can't apply, `complete` must print a
   friendly MESSAGE — e.g. "work landed on `<arbiter>/main`; your local `main`
   couldn't fast-forward (it has diverged) — run `git rebase origin/main` to sync"
   — and **succeed (exit 0)**, NOT error out.

**The deeper bug today: the EXIT CODE LIED.** `complete --merge` exited non-zero
because a COSMETIC follow-on (the local ff) failed, even though the MERGE
SUCCEEDED (work was on `origin/main`). An operator / CI reading that exit code
would wrongly conclude the work did not land. A failed convenience step must never
fail the command — the command's success is defined by the AUTHORITATIVE arbiter
push, not the local-sync courtesy.

Why both: the guard makes the divergence case rare (refused upfront); the
non-fatal convenience step makes the outcome HONEST even when divergence slips
through (guard `--ignore`'d, or a race) — success exit + a "sync your local main"
hint, never a scary error implying the merge failed.

## Why an observation, not a work item yet

Spotted in live use; the fix is small + clean (a future slice against the in-place
`do`/`complete` path): (1) the pre-flight divergence guard + `--ignore-...`, and
(2) make the local-ff convenience step non-fatal (message + exit 0, the arbiter
push defines success). Minor open choices: refuse-vs-warn default + the exact flag
name. Captured so it is not lost. Delete once both parts land.
