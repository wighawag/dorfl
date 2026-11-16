---
title: 'The mass-deletion guard asks the build agent once, then tells the reviewer (both, in that order)'
status: accepted
created: 2026-11-16
decided: 2026-11-16
supersedes:
superseded_by:
---

# ADR: The mass-deletion guard asks the build agent once, then tells the reviewer

## Context

A build agent on the wherever task `telegram-token-and-pairing` (PR #98) rewrote `CONTEXT.md`, a ~780-line doc, and left it with 3 insertions and 313 deletions, ending mid-sentence ("... conversationSearch.au"). The acceptance gate was green because prose is not tested, so the PR opened with half the project's context doc gone. The human Gate-3 caught it and a requeue fixed it. Nothing deterministic in the pipeline looks at how much of a pre-existing file survived.

The request named two remedies: (a) feed the finding back to the agent once ("you deleted N lines from X; confirm intentional or restore"), or (b) record it in the PR body so the reviewer sees it immediately, preferring (a) if the agent loop allows a cheap follow-up turn.

## Decision

Do both, in that order, in one shared helper (`runWithMassDeletionGuard` in `packages/dorfl/src/mass-deletion-guard.ts`) that wraps the build agent launch on every build path: in-place `do`, `do --remote` (and so the CI agent phase, which runs `performDo`), and the `run` fleet.

1. After the agent's turn ends cleanly (ok, not timed out, not cut off, no TASK-STOP), diff the work against its merge-base with `<arbiter>/main`, working tree included (`git diff --numstat -z -M <base>`). A pre-existing tracked text file is flagged when its NET loss (deleted minus added) is more than `massDeletionLines` (default 150), or more than `massDeletionRatio` (default 0.4) of its base line count and at least 20 lines. Binary files, brand-new files and pure renames are never flagged.
2. When something is flagged, give the agent ONE follow-up turn in the same session (pi resumes the build's `--session` file, so it has full context; the null/shell adapter gets a self-contained prompt). The prompt lists each file and the base sha. It says a removal that is part of the task, INCLUDING content deliberately moved elsewhere (a file split, an extraction, a relocation, a retired file), must NOT be restored, and that the agent should check whether the removed content now exists elsewhere in its change before restoring anything, because restoring moved code duplicates it. Only content lost by accident is restored (`git show <base>:<path>`) and the change redone as a targeted edit.
3. Re-run the check. Whatever is still flagged is appended to the PR body under `## Large deletions (runner check)`, saying whether the agent kept the deletion after being asked or the follow-up failed. The first turn's output stays the PR summary.

The guard is advisory. It never fails, stops or stucks a build: a follow-up that fails is ignored (the first result stands and the note says so), a git plumbing failure flags nothing, and a follow-up that hits the agent deadline hands back `timedOut` so the existing checkpoint route saves the work. The follow-up spends what is left of the build's deadline, never a fresh one.

Config (per-repo `dorfl.json`, env, global, as every gate-family key): `massDeletionGuard` (boolean, default `true`), `massDeletionLines` (positive integer, default 150), `massDeletionRatio` (number in (0, 1], default 0.4). Out-of-range thresholds fail loud at load. A single task can override the on/off switch in its own frontmatter with `massDeletionGuard: false` (or `true`), so a planned refactor opts out without turning the guard off for the whole repo. The override is task-only: a spec does not carry it, because a spec fans out into tasks of which usually only one is the big move. The worker prompt wrapper (`CLAIM-PROTOCOL.md`) also gains one line: edit large existing files with targeted edits, never rewrite them whole.

### Why (a) then (b), not one of them

The agent loop does allow a cheap follow-up: pi resumes a session from its file, and the turn only happens when the guard trips. Asking the agent is the only remedy that can FIX the incident before a human spends attention on it: a truncated rewrite is almost always an accident the agent can undo in one turn, so in the common case the PR is clean and nobody has to look. But the runner cannot know whether "the task asked for that", and the agent's own answer is not something to trust silently (it already produced the bad diff once). So a deletion that survives the follow-up is not dropped; it goes to the reviewer, who is the one who can judge intent. (a) alone would hide a confirmed deletion from review; (b) alone would ship every accidental truncation to a human first.

### Rejected

- **(b) only, a PR-body note with no follow-up.** Simplest, no extra agent turn. Rejected because it turns every accidental truncation into review work and a requeue, which is exactly the cost the incident paid.
- **Fail the gate on a mass deletion.** Deterministic and loud, but a legitimate removal (a task that retires a doc, a regenerated lockfile) would bounce to needs-attention with no way for the agent to say "this was asked for". The guard has no reliable way to know intent, so it must not be a gate.
- **Gross deletions instead of net loss.** A legitimate rewrite of a section replaces many lines with many lines; counting deletions alone would flag it. Net loss is what "half the doc is gone" means.
- **Skip `work/` or lockfiles.** Not needed for the smallest useful version: a flagged lockfile costs one follow-up turn and a note, never a failed build. Revisit if it proves noisy.

### Large refactors

The guard cannot block a legitimate refactor (it has no failure route), but its follow-up turn can do harm: git's rename detection only sees whole-file moves, so SPLITTING a big file makes the old file look gutted, and an agent that reads the split as "not explicitly asked for" could restore the old content and duplicate it. Two things address that: the follow-up prompt names moved content as intended and tells the agent to look for it elsewhere in the change first, and a task planned as a big refactor opts out with `massDeletionGuard: false`. Detecting moves heuristically (removed lines reappearing in new files) was considered and left out: more code and more guessing for a case the prompt and the opt-out already cover.

## Consequences

- A build that trips the guard costs one extra agent turn. A build that does not costs one `git fetch` of `<arbiter>/main` and one `git diff --numstat`.
- In `merge` mode there is no PR body; the residue is only reported through the runner's progress notes. The follow-up turn still runs, which is where most of the value is.
- On a continue-build the base is the fork point, so deletions an earlier run made (and possibly confirmed) are seen again and can trigger another follow-up.
