---
title: integration-band rebase must not route to needs-attention on a PURELY-protocol-bookkeeping conflict (the work/<slug>.md lifecycle move) — auto-resolve it from the arbiter's truth, for BOTH the slice done-move AND the PRD slicing move, preserving atomicity
slug: continue-rebase-auto-resolves-protocol-bookkeeping-conflicts
blockedBy: []
covers: []
---

## What to build

`rebaseContinuedBranchOntoMain` (`packages/agent-runner/src/continue-branch.ts`) currently follows ADR §10 "rebase-or-abort, NEVER auto-resolve → conflict routes to needs-attention". That is correct for REAL content conflicts. But in practice the ONLY thing that conflicts on a continued slice is the protocol's OWN bookkeeping: the slice's `work/<slug>.md` file is `git mv`'d to different folders on the two divergent histories at once —

- on the **work branch**: `claim → feat + git mv backlog→done → (on gate-fail) git mv done→needs-attention`,
- on **main** (independently, via the runner's own surface/requeue tree-less moves): `surface needs-attention → return to backlog → claim → surface → return to backlog → …`.

So git sees the same `work/<slug>.md` moved/modified differently on both sides and raises a rename/content conflict. ZERO source code is involved — it is entirely agent-runner mutating the same bookkeeping file on two lines of history. The rebase aborts, the slice routes to needs-attention, and (because the kept branch still carries its own move commits) it recurs on every re-`do`. This was reproduced live in a `drive-backlog` run on `serialise-surface-treeless-moved-false-test-under-parallel-load` (see `work/observations/rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md` for the full commit trace).

### VERIFIED against the code (do not re-derive from the prose above — confirm these against current `src/`)

There are TWO distinct needs-attention surface mechanisms today, and they differ exactly on the point this slice cares about — whether the `.md` move is COMMITTED ON THE WORK BRANCH:

- **TREE-LESS surface** (`do.ts` ~L763 + `applyTreelessNeedsAttentionTransition` in `ledger-write.ts`): used for the PRE-build rebase-conflict case (`§10`/`#89`). It is purely a one-file `in-progress/ → needs-attention/` ledger move on `main` with NO branch push, NO worktree mutation. THIS is the model to generalise.
- **BRANCH-COMMITTED `git mv`** (`complete.ts` ~L86: “`git mv work/in-progress|done/<slug>.md → work/needs-attention/<slug>.md`”): used for the GATE-FAILED-after-build case. This is the path that produced the conflicting commit in the live trace: the kept branch carried `58bf7d5` (`vitest.config.ts` edit + `git mv in-progress→done`) THEN `61ea593` (`git mv done→needs-attention`, a BOOKKEEPING move COMMITTED ON THE BRANCH) THEN `9e9847c` (appended the reason note in needs-attention, also on the branch). Those branch-committed bookkeeping moves are what collide on rebase with main's independent tree-less surface/requeue moves of the same `.md`.

So the conflict is NOT “agent-runner has one buggy path” — it is that the GATE-FAILED surface commits the bookkeeping move on the branch while every OTHER lifecycle transition (claim/requeue/pre-build surface) is tree-less on main. The two models disagree on one file. (DRIFT-CHECK: confirm both paths still exist as described before building; if `complete.ts` already routes the gate-failed surface through the tree-less mechanism, Part 1 is already done — then only Part 2 remains.)

### FULL MAP of `<slug>.md` (and PRD) moves — audited; the fix must cover ALL the integration-band ones, not just `→done`

Reviewing EVERY lifecycle transition in `ledger-write.ts` + `integration-core.ts` against this fix, they fall into exactly two mechanisms:

- **Tree-less CAS moves on `main`** (never rebased, so NEVER conflict on a rebase — they just re-CAS): `claim` (`backlog→in-progress`), `requeue` (`needs-attention|in-progress→backlog`), the TREE-LESS surface (`in-progress→needs-attention`, pre-build/after-commit), `resolve-needs-attention` (`needs-attention→in-progress`), the `slicing`-LOCK (`prd→slicing`) and its release, and the `advancing` presence-marker. These are FINE as-is; the fix leaves them untouched.
- **Integration-band moves committed ON A WORK BRANCH then REBASED onto the arbiter** (`integration-core.ts`: `… move → commit → rebase-onto-arbiter → integrate`, shared outcome `rebase-conflict`). There are TWO of these, and they are the SAME conflict class — the fix MUST cover BOTH:
  1. **the slice DONE-move** (`in-progress|done → done` + the code diff), and
  2. **the PRD SLICING transition** (`work/slicing/<slug>.md → work/prd-sliced/<slug>.md` PLUS the emitted `work/backlog/*.md` slice files), which rides the IDENTICAL band via `IntegrationLifecycle` (the band doc says “the shared band … is IDENTICAL; only which item move … is caller-supplied”).
- **The one OTHER branch-committed move** is the GATE-FAILED needs-attention surface (`applyNeedsAttentionTransition`, may commit wip) — Part 1 addresses it.

So: “done-move” below should be read as “ANY integration-band lifecycle move” — it applies verbatim to the PRD slicing move, with `prd-sliced/` in the role of `done/`.

### THE LOAD-BEARING INVARIANT (read this first — it constrains every option below)

**At no point may `arbiter/main` show a COMPLETED-state lifecycle file WITHOUT the artifacts it asserts also being on `main`, atomically.** Two concrete instances:

- `work/done/<slug>.md` must NEVER appear on `main` without the slug's CODE change. (slice done-move)
- `work/prd-sliced/<slug>.md` must NEVER appear on `main` without the EMITTED `work/backlog/*.md` slices it produced. (PRD slicing move — the PRD analog; the lifecycle file + ALL emitted files are ONE atomic transaction, never partially landed.)

The done-move/slicing-move and the artifacts they assert are ONE atomic transaction: they land together (via the merge/integrate) or not at all. This splits the slug's `.md` transitions into TWO categories that must be treated DIFFERENTLY:

- **Bookkeeping moves** — `backlog ⇄ in-progress (claim) ⇄ needs-attention (surface) ⇄ backlog (requeue)`. These assert NOTHING about merged code; `main` may correctly show any of these with zero code on main. They are (and should be) **tree-less CAS moves on `main`**, decided on the arbiter, and they must NOT be carried as commits on the work branch.
- **The integration-band completed-state moves** — the slice `… → done` AND the PRD `slicing → prd-sliced` (+ emitted backlog files). `done/`/`prd-sliced/` ASSERT "the asserted artifacts are merged." They therefore CANNOT be free-standing moves on main; each MUST ride the SAME ref update that brings its artifacts in — a commit ON the work branch (or folded into the integration commit) so the merge lands the lifecycle file AND its code/emitted-files on `main` atomically. **Keeping these moves on the branch is REQUIRED by the invariant; do NOT move them off.**

The conflict we are fixing came from MIXING these: the work branch wrongly carried BOTH the (correct, atomic) `→done` move AND a (wrong) bookkeeping `done→needs-attention` move on gate-fail, while `main` independently did `surface→backlog→claim` tree-less. Two histories editing the same `.md` ⇒ rebase conflict. The fix is NOT to move the done-move off the branch (that would BREAK atomicity) — it is to keep BOOKKEEPING moves off the branch, and to make the rare residual `.md` conflict auto-resolve WITHOUT ever fabricating `done/` on main.

### The fix (two parts; respect the invariant)

**Part 1 (root) — SEPARATE "preserve the code" (branch) from "record the folder placement" (tree-less on main) on the gate-failed surface.**

> ⚠️ CRITICAL CORRECTION (found in review against `ledger-write.ts:219-221`): do NOT naively "switch the gate-failed surface to `applyTreelessNeedsAttentionTransition`." The code DELIBERATELY uses the cwd-bound `applyNeedsAttentionTransition` for the gate-failed/agent-failed/wip-save surfaces BECAUSE THEY MAY CARRY UNCOMMITTED WIP that the cwd-bound path commits first. The tree-less path canNOT commit wip — switching blindly would LOSE uncommitted agent work. The two paths are correctly distinguished today; the defect is narrower.

The actual defect: the gate-failed surface (`complete.ts` ~L86) does the `.md` lifecycle MOVE as a commit ON THE WORK BRANCH (`git mv … → needs-attention/`, the `61ea593` commit). It conflates two separable concerns:

1. **Preserve the agent's code** (incl. any uncommitted wip) — this LEGITIMATELY belongs on the `work/<slug>` branch (commit wip, push the branch; that is what makes the work recoverable). KEEP this.
2. **Record the slug's folder placement** (`… → needs-attention/`) — this is BOOKKEEPING and belongs as a tree-less CAS move on `main`, NOT a commit on the branch.

The fix: on the gate-failed surface, commit + push any wip to the `work/<slug>` branch AS TODAY (recoverability preserved), but perform the `.md` `in-progress/|done/ → needs-attention/` MOVE + reason as a tree-less CAS move on `main` (the `surfaceToNeedsAttention` mechanism), NOT a `git mv` committed on the branch. After this the branch carries ONLY the code (wip + the single `→done` move if it got that far) and NO bookkeeping `.md` move; main records placement tree-lessly. The dual-history-on-one-file disappears WITHOUT losing wip and WITHOUT touching the atomic done-move.

> RECONCILE with the existing seam split: today `applyNeedsAttentionTransition` does BOTH (commit wip AND move the `.md`, all on the branch); `applyTreelessNeedsAttentionTransition` does ONLY the tree-less move (no wip). This slice's Part 1 needs a path that does "commit/push wip to the branch" THEN "tree-less `.md` move on main" — i.e. SPLIT the cwd-bound transition into its two concerns rather than picking one whole-cloth. Confirm against the code whether this is a new compose-of-two-primitives or a modification of `applyNeedsAttentionTransition`; either way the wip-commit must NOT be dropped.
>
> DRIFT-CHECK: if `complete.ts` already separates wip-preservation from a tree-less placement move, Part 1 is done — only Part 2 remains.

**Part 2 (NOT optional — load-bearing for the done-move's OWN rebase) — deterministic auto-resolve of a `work/<slug>.md`-only rebase conflict.**

WHY this is essential, not a safety net (the sharp case): an integration-band lifecycle move (slice `mv in-progress→done`, OR PRD `mv slicing→prd-sliced` + emitted files) MUST stay on the branch (invariant) and the integration sequence REBASES it onto the arbiter (`integration-core.ts`: `move → commit → rebase-onto-arbiter → verify → integrate`, shared outcome `rebase-conflict`). If main independently moved the SAME lifecycle file via a tree-less move between claim/slicing-lock and integration (a surface, a requeue, a lock release), then rebasing the branch's move onto a main where the file now sits elsewhere produces the SAME rename conflict — with Part 1 done, this is the ONLY remaining conflict, but it is INHERENT to these branch-committed moves and Part 1 alone does NOT remove it. So Part 2 is what actually makes BOTH the done-move and the PRD slicing move robust; without it the conflict simply recurs at integrate-time.

The resolver, when `git rebase <main>` conflicts AND every conflicted path is under `work/` and is the slug's `.md` placement and/or runner-appended note bodies (no source/content paths):

- **If the branch commit being replayed is an integrating COMPLETED-STATE move** (the branch is landing its artifacts — the slice done-move, OR the PRD slicing move WITH its emitted backlog files): resolve to the completed folder (`done/` resp. `prd-sliced/`) AND keep ALL the emitted files — the branch WINS the destination, BECAUSE its artifacts are arriving in this same integration. This does NOT violate the invariant: the completed-state file appears on main precisely together with its code/emitted-files (the whole point of atomicity). Main's concurrent bookkeeping placement is SUPERSEDED by the completed work. Notes UNION. For the PRD case, the resolver MUST keep the lifecycle move AND every emitted `work/backlog/*.md` together (never `prd-sliced/` without its slices).
- **If the branch commit being replayed is NOT an integrating completed-state move** (e.g. a leftover continue with no integration happening): the **arbiter's `main` is the source of truth** for bookkeeping placement; resolve to main's folder, notes UNION. The resolver does NOT fabricate `done/`/`prd-sliced/` here — only an actual integrating move earns the completed folder.
- If ANY conflicted path is OUTSIDE the `work/<slug>.md`+notes set (a real source/content conflict), keep EXISTING behaviour exactly: `--abort` + `{kind: 'conflict'}` → needs-attention (ADR §10 unchanged).

The invariant stays intact: `done/` is only ever written by an integrating done-move (which carries the code in the same ref update), NEVER by resolving a non-integration bookkeeping conflict. The distinction the resolver makes is "is the commit I'm replaying THE done-move that is integrating code right now?" — if yes, done/ is correct and atomic; if no, defer to main's bookkeeping.

> Companion primitive: the existing tree-less move in `advance-treeless-publish.ts` is the right vehicle for the bookkeeping moves on `main`. Do NOT repurpose it for the done-move (the done-move is integration, not bookkeeping) — the done-move rides the rebase+integrate band and is made robust by the auto-resolve above, not by a CAS move.

## Acceptance criteria

- [ ] **INVARIANT (must be tested explicitly):** `arbiter/main` NEVER shows `work/done/<slug>.md` without the slug's code change on `main`. The done-move stays on the work branch and lands atomically with the code via the merge; bookkeeping moves (claim/surface/requeue) are tree-less on `main`. A test asserts that no intermediate state (gate-fail, surface, requeue, conflict-resolve) ever puts `done/<slug>.md` on main without the code.
- [ ] The GATE-FAILED surface (`complete.ts`) no longer commits the `.md` `git mv … → needs-attention/` ON THE WORK BRANCH; the folder placement is recorded as a tree-less CAS move on `main`, while any uncommitted agent WIP is STILL committed + pushed to the `work/<slug>` branch (recoverability preserved — do NOT drop the wip-commit the cwd-bound path does today). A test asserts BOTH: (a) the gate-failed branch tip carries NO bookkeeping `.md` move commit, and (b) uncommitted wip present at gate-fail is still preserved on the pushed branch and a later continue finds it.
- [ ] **The slice DONE-MOVE's own rebase auto-resolves:** when the integrating done-move (`in-progress→done`) is rebased onto a main that concurrently moved the same `work/<slug>.md` via a tree-less move (surface/requeue), the rebase resolves to `done/` (integrating branch wins, atomic with the code) and completes `clean` — NOT needs-attention. A test pins it (claim → done-move on branch; main surfaces/requeues the same .md; integrate; assert clean + file in done/ + code present).
- [ ] **The PRD SLICING move's own rebase auto-resolves, ATOMICALLY:** when the integrating slicing move (`work/slicing/<slug>.md → work/prd-sliced/<slug>.md` + emitted `work/backlog/*.md`) is rebased onto a main that concurrently moved the same PRD file, the rebase resolves to `prd-sliced/` AND keeps EVERY emitted backlog slice, completing `clean`. A test pins it AND asserts `prd-sliced/<slug>.md` is NEVER on main without its emitted slices (no partial landing).
- [ ] A NON-integration continued-branch rebase whose ONLY conflicts are the slug's `.md` placement across BOOKKEEPING folders and/or appended notes is AUTO-RESOLVED to MAIN's folder (arbiter wins; notes union), completes `clean`, and does NOT fabricate `done/`/`prd-sliced/`.
- [ ] **Invariant preserved (both instances):** `done/<slug>.md` is written to main ONLY by an integrating done-move carrying the code; `prd-sliced/<slug>.md` ONLY by an integrating slicing move carrying its emitted slices — NEVER by resolving a non-integration conflict. Tests assert both.
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
> GOAL: make a continued-branch rebase distinguish a GENUINE content conflict (keep aborting → needs-attention, ADR §10) from a PURELY protocol-BOOKKEEPING conflict (the slug's `.md` placement across backlog/in-progress/needs-attention + runner-appended notes), and auto-resolve only the latter, with the arbiter's `main` as the authority for bookkeeping placement. This was a live drive-backlog footgun: correct, building work was routed to needs-attention (and nearly discarded via `requeue --reset`) purely because the runner moved the same `.md` on two of its own histories.
>
> HARD INVARIANT (do not violate): `arbiter/main` must NEVER show `work/done/<slug>.md` without the slug's code on `main`. The done-move is INTEGRATION, not bookkeeping: it stays on the work branch and lands atomically with the code via the merge. Keep BOOKKEEPING moves (claim/surface/requeue) off the branch (tree-less on main); the conflict-resolver must NEVER fabricate `done/` on main. If unsure whether a transition is bookkeeping or done, treat done as sacred and abort rather than invent a merged state.
>
> SEAM TO TEST AT: `rebaseContinuedBranchOntoMain` — feed it a branch + a main that diverge ONLY on the slug `.md` folder move and assert `clean` + correct placement + code diff preserved; feed it a real source conflict and assert it still aborts → `conflict`. No network; throwaway git repos as the existing continue-branch tests do.
>
> DONE: the two-branch fork is pinned by tests, the live scenario regression-tests green, ADR/contract updated at the SOURCE and mirrored, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.
