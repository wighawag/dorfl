---
title: continue-branch rebase must not route to needs-attention on a PURELY-protocol-bookkeeping conflict (the work/<slug>.md lifecycle move) — auto-resolve it from the arbiter's truth
slug: continue-rebase-auto-resolves-protocol-bookkeeping-conflicts
blockedBy: []
covers: []
---

## What to build

`rebaseContinuedBranchOntoMain` (`packages/agent-runner/src/continue-branch.ts`) currently follows ADR §10 "rebase-or-abort, NEVER auto-resolve → conflict routes to needs-attention". That is correct for REAL content conflicts. But in practice the ONLY thing that conflicts on a continued slice is the protocol's OWN bookkeeping: the slice's `work/<slug>.md` file is `git mv`'d to different folders on the two divergent histories at once —

- on the **work branch**: `claim → feat + git mv backlog→done → (on gate-fail) git mv done→needs-attention`,
- on **main** (independently, via the runner's own surface/requeue tree-less moves): `surface needs-attention → return to backlog → claim → surface → return to backlog → …`.

So git sees the same `work/<slug>.md` moved/modified differently on both sides and raises a rename/content conflict. ZERO source code is involved — it is entirely agent-runner mutating the same bookkeeping file on two lines of history. The rebase aborts, the slice routes to needs-attention, and (because the kept branch still carries its own move commits) it recurs on every re-`do`. This was reproduced live in a `drive-backlog` run on `serialise-surface-treeless-moved-false-test-under-parallel-load` (see `work/observations/rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md` for the full commit trace).

Build a deterministic auto-resolution for the SPECIFIC case where the rebase conflict is confined to `work/**` protocol-bookkeeping paths (the slice `.md` folder placement and/or the runner's own appended handoff/needs-attention note text):

- When `git rebase <main>` conflicts, inspect the conflicted paths. If EVERY conflicted path is under `work/` AND is a protocol-lifecycle artifact the runner itself owns (the slug's `.md` rename across `backlog`/`in-progress`/`needs-attention`/`done`, and/or appended note bodies), RESOLVE it deterministically: the **arbiter's `main` is the single source of truth for FOLDER PLACEMENT** (the work branch's view of "which folder" is always stale — placement is decided by claim/surface/requeue on main, never by the branch), and appended handoff notes UNION (keep both). Then continue the rebase.
- If ANY conflicted path is OUTSIDE that protocol-bookkeeping set (i.e. a real source/content conflict), keep the EXISTING behaviour exactly: `--abort` and return `{kind: 'conflict'}` so it routes to needs-attention (ADR §10 unchanged for genuine conflicts).
- The deeper, preferred companion fix is to stop the work branch from carrying `work/<slug>.md` move commits AT ALL (let placement be decided ONLY on the arbiter via the existing tree-less primitive in `advance-treeless-publish.ts`, so the branch carries only the code diff and there is nothing to conflict). If that larger change is in scope for this slice, prefer it; otherwise this slice delivers the auto-resolve and files a follow-up observation/idea for the branch-carries-no-bookkeeping refactor.

## Acceptance criteria

- [ ] A continued-branch rebase whose ONLY conflicts are the slug's `work/<slug>.md` lifecycle move and/or runner-appended note bodies is AUTO-RESOLVED (arbiter wins on folder placement; notes union) and the rebase completes `clean` — it does NOT route to needs-attention.
- [ ] A continued-branch rebase with ANY conflict OUTSIDE the protocol-bookkeeping set still aborts and returns `{kind: 'conflict'}` → needs-attention, EXACTLY as today (ADR §10 preserved for genuine conflicts). A test pins both branches of this fork.
- [ ] The resolution is deterministic and decided from the ARBITER's current folder for the slug (never the branch's stale view); the slug ends in the folder the arbiter says it is in.
- [ ] A regression test reproduces the live scenario: branch did `claim → feat+done-move → done→needs-attention`; main independently did `surface → return-to-backlog → claim`; assert the rebase auto-resolves and the code diff (the only real change) survives, with the slug placed per the arbiter.
- [ ] ADR §10 / `WORK-CONTRACT.md` (and any `continue-branch.ts` docblock) updated to record the narrow protocol-bookkeeping auto-resolve carve-out and WHY (a same-file lifecycle move on two runner-owned histories is not a human-decision conflict). Edit the SOURCE (`skills/setup/protocol/`) and mirror into `work/protocol/` per this repo's AGENTS.md.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None.

## Prompt

> FIRST, drift-check: re-read `packages/agent-runner/src/continue-branch.ts` (`rebaseContinuedBranchOntoMain`, currently `git rebase` → on non-zero `--abort` + return `{kind:'conflict'}`) and `docs/adr/` for the §10 "rebase-or-abort, never auto-resolve" decision, plus `work/observations/rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md` and `work/observations/requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md` for the live trace. If the continue path has since been refactored to keep `work/**` bookkeeping OFF the work branch (so this conflict can no longer arise), this slice is moot — route to needs-attention noting that. Otherwise build the narrow auto-resolve.
>
> GOAL: make a continued-branch rebase distinguish a GENUINE content conflict (keep aborting → needs-attention, ADR §10) from a PURELY protocol-bookkeeping conflict (the slug's `work/<slug>.md` lifecycle move + runner-appended notes), and auto-resolve only the latter, with the arbiter's `main` as the authority for folder placement. This was a live drive-backlog footgun: correct, building work was routed to needs-attention (and nearly discarded via `requeue --reset`) purely because the runner moved the same `.md` on two of its own histories.
>
> SEAM TO TEST AT: `rebaseContinuedBranchOntoMain` — feed it a branch + a main that diverge ONLY on the slug `.md` folder move and assert `clean` + correct placement + code diff preserved; feed it a real source conflict and assert it still aborts → `conflict`. No network; throwaway git repos as the existing continue-branch tests do.
>
> DONE: the two-branch fork is pinned by tests, the live scenario regression-tests green, ADR/contract updated at the SOURCE and mirrored, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.
