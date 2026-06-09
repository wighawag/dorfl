---
title: a propose-mode PR's remote `work/<slug>` branch is NEVER deleted after the PR merges — agent-runner has no post-merge branch cleanup, so merged work branches accumulate on the arbiter (standard "delete head branch on merge" hygiene is missing); tension with the documented never-delete-the-remote-branch invariant (which protects the PRE-merge recovery point, not a merged branch)
type: observation
status: spotted
spotted: 2026-06-09
---

## The signal

The maintainer: "the remote PR branch should be closed when merged." In propose
mode, `do --propose` / `complete --propose` pushes `work/<slug>` to the arbiter and
opens a PR (`integrator.ts` `integrate`, `input.mode === 'propose'` → push the branch
under its own ref + `provider.openRequest`). When that PR is later MERGED (on GitHub,
by a human or auto-merge), **nothing in agent-runner deletes the remote
`work/<slug>` branch.** It lingers on the arbiter. Over many merged slices the
arbiter accumulates dozens of dead `work/*` branches — the exact thing GitHub's
"automatically delete head branches" setting exists to prevent.

## What the code does now (verified)

- **Propose mode** (`src/integrator.ts`, `integrate` mode `propose`): pushes the
  branch under its own ref, asks the provider to open a PR. The remote `work/<slug>`
  branch is CREATED and is the PR's head.
- **`src/github.ts`** (the only provider): opens the PR (`gh pr create`) and can post
  a review COMMENT. It has **NO branch-deletion capability at all** — no
  `gh pr merge --delete-branch`, no `git push --delete`, nothing post-merge. (grep:
  zero delete-remote refs in `github.ts`.)
- **`complete`** (`cli.ts` ~969): after integrate it deletes the **LOCAL** work branch
  "iff provably on the arbiter (**never the remote**)". So the LOCAL branch is cleaned
  but the REMOTE one is deliberately left.
- **Merge mode** does NOT create a remote `work/<slug>` at all (it pushes
  `work/<slug>:main`), so this is a PROPOSE-mode concern — EXCEPT a branch a prior
  needs-attention/requeue pushed for recovery can also linger after the eventual
  merge.

So the lifecycle has a gap: agent-runner OPENS the PR but never participates in the
post-MERGE cleanup. The merge happens out-of-band (GitHub UI / `gh`), and the head
branch is never reaped.

## The tension (why this is a DECISION, not an obvious fix)

There is a documented **"never-delete-the-remote-branch invariant"**
(`cli.ts` ~1598, `requeue --reset` is called out as "a deliberate departure from the
never-delete-the-remote-branch invariant"; ADR §4 deletion-safety: "deletion rides
the push, a provider failure leaves a SAFE pushed branch, not lost work; we NEVER
`--force`"). The invariant exists because the remote `work/<slug>` branch is the
**cross-machine RECOVERY point**: `requeue` (keep+continue) and the continue-detection
read `<arbiter>/work/<slug>` ahead of main to resume saved work. Deleting it would
destroy recoverable work.

**The key distinction this observation turns on:** the invariant protects the branch
**while the work is IN FLIGHT / un-merged** (it might still need recovery). Once the
PR is **MERGED**, the branch's commits are on `main` — it is NO LONGER a recovery
point, and deleting it is both SAFE (the work is preserved on main) and DESIRABLE
(standard PR hygiene). So "delete the remote branch AFTER its PR merges" does NOT
violate the spirit of the invariant; it complements it. The invariant is
"never delete an UN-merged/in-flight branch"; this is "delete a MERGED one."

## Fix direction (shape, not a decision)

Add post-merge remote-branch cleanup, gated on PROVABLE merged-ness (mirror the §4
deletion-safety predicate's rigour — only delete when provably safe):

- **Where:** a provider capability (`github.ts`) — e.g. open the PR with
  `gh pr create` and either (a) set the repo/PR to delete-head-on-merge, or (b) on a
  later pass, `gh pr merge --delete-branch` when WE perform the merge, or (c) a
  reap step that deletes `<arbiter>/work/<slug>` ONLY when the branch tip is
  provably an ancestor of `<arbiter>/main` (merged) — the remote analogue of `gc`'s
  per-worktree "reachable on the arbiter" predicate.
- **Safety predicate:** delete the remote branch IFF `merge-base --is-ancestor
  work/<slug> <arbiter>/main` (the commits are on main) — never on a branch that is
  merely pushed-but-not-merged (that is still the in-flight recovery point the
  invariant protects). This is the same reachability check `src/gc.ts` already uses
  for worktrees; reuse the predicate, do not invent a second.
- **Who triggers it:** two sub-cases to decide —
  1. **auto-merge mode** (agent-runner performs the merge): delete the head branch as
     part of the merge step (we know exactly when it merged).
  2. **propose mode + an OUT-OF-BAND human/UI merge** (the common case): agent-runner
     does not see the merge happen. Options: a `gc`-style sweep that prunes
     provably-merged remote `work/*` branches (the remote counterpart to worktree
     `gc`), OR rely on GitHub's repo-level "auto-delete head branches" and have
     `install-ci` / `setup` enable it. The sweep is provider-agnostic (plain
     `git push --delete` guarded by the ancestor check) and works on a `--bare`
     arbiter too; the GitHub setting is zero-code but GitHub-only.

Open sub-questions for the eventual slice:
- Provider-agnostic sweep (works on `--bare` arbiters, reuses `gc`'s predicate) vs
  GitHub-setting (zero-code, GitHub-only) vs both. The sweep is the more general,
  invariant-respecting home; the setting is a nice default `setup`/`install-ci` can
  turn on.
- Does this become a new `gc` sub-mode ("reap provably-merged remote work branches",
  the arbiter counterpart to worktree reaping) or a step in the merge path? A
  `gc`-style sweep is attractive because the out-of-band-merge case has no merge
  event for agent-runner to hook.
- Interaction with `requeue`/continue: the predicate (ancestor-of-main) already
  EXCLUDES an in-flight branch (a kept-for-continue branch is NOT an ancestor of
  main), so a merged-branch reap cannot eat a recovery point — confirm in tests.

## Related

- ADR §4 (deletion safety) + `src/gc.ts` — the "reachable on the arbiter" predicate
  to REUSE (worktree reaping today; this adds the remote-branch counterpart).
- `cli.ts` `requeue --reset` — the ONE sanctioned existing remote-branch deletion (of
  an UN-merged branch, deliberately + guarded); this observation is the complementary
  MERGED-branch case.
- `src/integrator.ts` (propose vs merge), `src/github.ts` (the provider — currently
  no delete capability).
- `conductor-prefer-fixup-on-work-branch-over-parallel-pr-branch.md` — adjacent
  "orphaned on the remote" concern, but about the conductor's fixup-vs-parallel-PR
  choice, not post-merge cleanup.
- `work/prd/advance-loop.md` — the CI `install-ci` deliverable (slice
  `advance-install-ci`) is a natural place to ENABLE GitHub's auto-delete-head-branch
  as a default, if that route is chosen; the provider-agnostic sweep is independent.
