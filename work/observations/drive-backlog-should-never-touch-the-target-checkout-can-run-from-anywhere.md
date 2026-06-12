---
title: drive-backlog should NEVER touch the target repo's working checkout (no git switch/branch/reset/push in it) — and, being a pure arbiter-observer, it needn't even RUN from that checkout; it can run from any folder, pointed at the arbiter
date: 2026-06-12
status: open
---

## The signal

Across several drive-backlog runs the conductor has reached INTO the human's working checkout to do git operations it should never do there:

- This run (`run-internal-error-tests`, flake re-verification): the conductor ran `git switch -C _verify-run-internal origin/work/slice-run-internal-error-tests` IN the human checkout to cheaply re-run a slice's own tests. Git refused ("Aborting"), it caught itself ("switching branches in the human checkout is exactly what the skill says to avoid anyway"), and backed out — no harm, but a discipline slip that only self-corrected after the fact.
- Earlier runs (`advance-verb-resolver`, `review-comment-fallback`, `advance-drivers-and-gates`): manual stale-lease recovery was done partly against the live checkout (fetch/rebase/branch inspection), and the human-vs-conductor commits got entangled, repeatedly requiring `git rebase origin/main` to reconcile the conductor's own checkout against parallel human commits.

The recurring shape: the conductor treats the human's checkout as its scratch space — switching branches, rebasing, inspecting work branches, even committing+pushing its own notes there — which (a) risks corrupting/entangling the human's in-flight work, (b) fights git's "branch checked out" refusals, and (c) is simply unnecessary.

## The insight (the design the skill should encode)

`drive-backlog` builds `--isolated` (a job worktree off the ARBITER) and merges via `gh`/the arbiter. So the conductor is already a **pure arbiter-observer**: everything it legitimately needs is

- READ the arbiter's `work/` lifecycle state (which slices are ready/blocked/in-progress/done) — from `origin/main`, via `git fetch` + read, OR the mirror-side scan;
- DISPATCH `do slice:<slug> --isolated` (which never reads the human checkout);
- REVIEW the opened PR's diff + MERGE it (`gh pr …` against the arbiter);
- optionally COMMIT+PUSH its own `work/observations/` notes — which is a commit against the arbiter, not a working-tree edit that must live in the human's checkout.

NONE of that requires mutating — or even being inside — the target repo's working checkout. Two consequences the skill should state:

1. **NEVER touch the target checkout.** No `git switch`/`branch -D`/`reset`/`checkout -B`/`rebase`/commit/push IN the human's working tree as a side effect of driving. If the conductor needs a working tree for a cheap verification (e.g. run a slice's own tests in isolation), it uses a THROWAWAY clone / the job worktree / a temp dir — never the human checkout. The human's uncommitted work and current branch are sacrosanct; the conductor must leave the tree exactly as it found it.

2. **It can RUN FROM ANYWHERE.** Because it only needs the arbiter (a URL/remote) + `gh` + a scratch area, `drive-backlog` does not have to be invoked from inside the target checkout at all — it could run from any folder (a temp dir, the agents' area, CI) pointed at the arbiter, exactly as `do --remote <url>` / `run` already operate against a registered repo with NO checkout. The "cd into the repo and drive" posture is a convenience, not a requirement; making the skill checkout-agnostic removes the whole class of "entangled with the human's working tree" incidents (the repeated `git rebase origin/main` reconciliations this session needed are a symptom of running IN, and committing notes TO, the same checkout a human is using).

UNLESS THE HUMAN ASKS otherwise (e.g. "drive in-place in this checkout"), the default should be: operate against the arbiter, never the working tree.

## What to change (skill, not code)

`skills/drive-backlog/SKILL.md`: add an explicit rule (alongside golden rule 5 / the `--isolated` mandate) that the conductor (a) NEVER performs git operations in the target repo's working checkout — verifications use a throwaway clone / the job worktree / temp dir; and (b) is checkout-AGNOSTIC: it needs only the arbiter + `gh` + a scratch area and may run from any folder, so it should resolve the arbiter explicitly (not assume `cwd` is the repo) and treat the human's checkout, if it happens to be cwd, as read-only / off-limits. The note-commit step should push notes to the arbiter without depending on (or dirtying) the human's working tree. Cross-ref: `drive-backlog-skill-assumes-in-place-do-not-remote.md` (the `--isolated`-always decision this builds on) and `requeue-and-recovery-assume-local-checkout-no-remote-arbiter-form.md` (the fetch-from-arbiter-first recovery model — same arbiter-is-truth principle applied to the recovery verbs).

## Where

`skills/drive-backlog/SKILL.md` (the discipline doc). NOT a code change — it constrains the conductor's own behaviour. The enabling primitives already exist (`--isolated`, mirror-side scan, `gh` against the arbiter); this is about the skill DECLARING the checkout-agnostic, never-touch-the-working-tree posture as the default.
