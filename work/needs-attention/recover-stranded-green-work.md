---
title: recover GREEN-BUT-UNINTEGRATED work via `complete --isolated <slug>` (integrate from the retained job worktree) — no new verb, no hand-rebuild, no orphan branch
slug: recover-stranded-green-work
blockedBy: []
covers: []
---

## What to build

Let an operator recover a build whose WORK is green + committed but whose INTEGRATION did not complete (the "stranded green work" case) with **`complete --isolated <slug>`** — `complete` resolves the slug's RETAINED job worktree and integrates from the commit already in it, reusing the existing integration tail. No new verb, no rebuild of the build agent, no parallel/orphan branch, never `--force` to main.

### The two facts that make this small (verified against the code)

This started as a big `needsAnswers` slice; investigating the code collapsed it:

- **The retained worktree is GUARANTEED to hold the green commit.** The reaper (`reapJob`, `gc.ts`) removes a job worktree ONLY when it is clean AND its branch tip is reachable on the arbiter (merged or pushed). When the push FAILED (the whole incident), the tip is NOT on the arbiter (`unmerged-commits`), so the predicate fails CLOSED and **KEEPS the worktree** — its docstring: *"a successful-but-unpushed job is retained… a retained worktree is a reliable 'needs attention' signal."* So the green commit (`64b9501` in the incident) is intact in the job worktree, by design. There is NOTHING to fix on the `do`/reaper side — the recovery SOURCE already exists.
- **`complete` already does the recovery OPERATION.** `complete` takes a `cwd` ("the working clone/checkout the work branch lives in") and runs (gate →) done-move → commit → rebase-onto-`<arbiter>/main` → integrate THERE, reusing `performIntegration`/`integration-core` — integrating from the existing branch in place, never `--force` to main, with `--skip-verify` to skip the (already-passed) gate and `--propose`/`--merge` honoured. That IS the recovery. The only missing piece is pointing it at the retained job worktree.

### Precise scope

- **Teach `complete` (and `resume`, for symmetry) a `--isolated <slug>` form that RESOLVES the slug's existing job worktree** in the agents' area (`workspacesDir`) and runs against it (sets the operation's `cwd` to that worktree dir). This is a **LOCATE-EXISTING** handle — the inverse of `do --isolated`, which CREATES a fresh worktree. Reuse the same worktree-naming/`workspacesDir` resolution `createJob`/`reapJob` use to FIND the dir (do not re-derive the encoding).
  - **The worktree dir is keyed on the ARBITER URL + slug, not the slug alone** (`jobWorktreePath` = `<workspacesDir>/work/<encodeWorkId(arbiterURL, slug)>`, via `encodeRepoKey`). So `--isolated <slug>` must FIRST resolve the repo's arbiter URL from the cwd — **exactly as `do --isolated` already does** (`resolveDefaultArbiterForCwd` → arbiter remote → URL) — THEN compute the work-id and locate the dir. Reuse that resolver; do NOT glob `workspacesDir` by slug suffix (two repos can share a slug). This is the same "run from a participating repo" constraint `do --isolated` carries.
  - `--isolated` (not `--cwd <dir>`) is the right surface: it keeps the flag SYMMETRIC with `do --isolated` (and the planned `--isolated`-as-default / `--in-place` direction), and — decisively — the operator must NOT have to know the encoded worktree path (`~/.agent-runner/work/<host>__<org>__<repo>__<slug>`). The runner locates it from the slug.
- **`do`'s integration-failure path emits the exact recovery command** — when a green build fails to integrate (push/PR step failed terminally), print a copy-pasteable `agent-runner complete --isolated <slug> --skip-verify` (mode flags as appropriate) so the operator is handed the one-liner instead of reverse-engineering it.
- **Idempotent / honest when there is nothing to recover:** `complete --isolated <slug>` when no retained worktree exists for the slug → a CLEAR message (already integrated / nothing retained), not a crash or a fresh worktree. When the worktree IS there but its work is already on the arbiter, the existing reachable-on-arbiter logic makes integration a clean no-op.
- **Do NOT** add a new verb, a new integration path, or a `do`-side keep-vs-reap change (the reaper already keeps unpushed work). Do NOT rebuild the agent or re-cut a branch off main (the orphan anti-pattern `drive-backlog`'s golden-rule sidebar warns against).

### The observed incident (motivation)

`advance-verb-resolver` built green (1467 tests, Gate-2 approved, commit `64b9501` in the job worktree) but the `--force-with-lease` push failed; no PR opened, and recovery was a manual `git switch -C work/<slug> origin/main` + re-apply-from-the-commit + re-gate + force-push — the orphan-prone dance this slice replaces with one command. (`work-branch-push-retry-on-stale-lease` / #88 made the stranding RARER by retrying a stale lease, but a terminal integration failure still strands green work with no first-class recovery — this slice is that recovery.)

## Acceptance criteria

- [ ] `complete --isolated <slug>` resolves the slug's RETAINED job worktree (from `workspacesDir`, reusing the existing naming/resolution — not a re-derived encoding) and integrates from the commit in it, via the SAME `performIntegration`/`integration-core` tail (rebase-onto-`<arbiter>/main` → propose/merge), never `--force` to main, no orphan/parallel branch.
- [ ] `--skip-verify` skips the already-passed gate; `--propose`/`--merge` and `--arbiter` resolve identically to a normal `complete`.
- [ ] `resume --isolated <slug>` re-engages the same retained job worktree (the "continue here, but in the isolated tree" symmetric counterpart) without claiming.
- [ ] `complete --isolated <slug>` with no retained worktree for the slug → a clear "nothing to recover / already integrated" message (no crash, no fresh worktree created). After a SUCCESSFUL recovery the work is on the arbiter, so the worktree is now provably-safe to reap — a re-run finding it gone (or already-integrated) is the CORRECT no-op end state, not an error.
- [ ] `do`'s integration-failure path prints the exact `complete --isolated <slug> --skip-verify` recovery command.
- [ ] Tests reproduce "green build, integration fails terminally → worktree retained" in a throwaway-git fixture and assert `complete --isolated <slug>` integrates from the retained worktree (PR opened / work landed), with NO rebuild, NO orphan branch, NO `--force` to main; plus the idempotent/nothing-to-recover cases.
- [ ] No shared/global location touched outside temp fixtures (the agents'-area `workspacesDir` is pointed at a temp dir).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. (The reaper already retains unpushed green work, and `complete` already owns the integration tail; this slice only adds the locate-existing `--isolated` resolution + the recovery-command surfacing.)

## Prompt

> Add `complete --isolated <slug>` (and `resume --isolated <slug>` for symmetry) to recover GREEN-BUT-UNINTEGRATED work: integrate from the slug's RETAINED job worktree, reusing the existing integration tail — no new verb, no rebuild, no orphan branch, never `--force` to main. This replaces the manual rebuild-and-force-push dance the `advance-verb-resolver` incident required (commit `64b9501` stranded after a failed push).
>
> TWO facts make this small (CONFIRM both still hold, then build): (1) the reaper (`reapJob`, `gc.ts`) RETAINS a worktree whose work is committed-but-not-on-the-arbiter — so a failed-push green build's worktree is intact (the recovery source already exists; do NOT add a keep-vs-reap change). (2) `complete` already does the integration FROM a given `cwd` (gate → done-move → commit → rebase → `performIntegration`), with `--skip-verify` to skip the already-passed gate. So the ONLY new code is: resolve `--isolated <slug>` → the EXISTING job worktree dir (a LOCATE-EXISTING handle — inverse of `do --isolated` which CREATES one), set `complete`'s `cwd` to it, and emit the recovery command from `do`'s integration-failure path. The dir is keyed on the ARBITER URL + slug (`jobWorktreePath`/`encodeWorkId`/`encodeRepoKey`), NOT the slug alone — so FIRST resolve the arbiter URL from cwd exactly as `do --isolated` does (`resolveDefaultArbiterForCwd`), THEN compute the work-id; reuse that resolver, never glob `workspacesDir` by slug (two repos can share a slug).
>
> `--isolated` (NOT `--cwd <dir>`) is the surface: symmetric with `do --isolated` (and the planned `--isolated`-default/`--in-place` direction), and the operator must not have to know the encoded worktree path. Make `complete --isolated <slug>` with nothing retained a clear no-op message; re-running after success a clean no-op.
>
> READ FIRST: `packages/agent-runner/src/complete.ts` (the `cwd`-parameterised integration path + `--skip-verify`/`--propose`/`--merge`), `packages/agent-runner/src/integration-core.ts` (`performIntegration`), `packages/agent-runner/src/gc.ts` (`reapJob` + the retain predicate — the retained-worktree guarantee), `packages/agent-runner/src/workspace.ts` + `isolation.ts` (`createJob` + `workspacesDir` worktree naming to RESOLVE the existing dir), `packages/agent-runner/src/cli.ts` (the `do --isolated` resolution to mirror, and the `complete`/`resume` commands to extend), and `packages/agent-runner/src/do.ts` (the integration-failure path to surface the recovery command). Cross-ref observations `drive-backlog-skill-assumes-in-place-do-not-remote.md` (orphan-branch warning) + `gate1-could-run-in-fresh-worktree-to-match-pushed-branch.md` (gate-vs-pushed-tree, re: whether to re-gate on recovery — default: trust the prior green via `--skip-verify`).
>
> FIRST, check this slice against current reality (drift): confirm the reaper still RETAINS unpushed-green worktrees and `complete` still integrates from `cwd` via `performIntegration`. If either changed, reconcile or route to `needs-attention/` with the discrepancy.
>
> TDD with vitest, house style (throwaway git repos; point `workspacesDir` at a temp dir). "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim recover-stranded-green-work --arbiter origin
git fetch origin && git switch -c work/recover-stranded-green-work origin/main
git mv work/in-progress/recover-stranded-green-work.md work/done/recover-stranded-green-work.md
```

## Needs attention

The slice's load-bearing premise is FALSE and was verified empirically against current code (packages/agent-runner). The slice claims: "`complete` already does the recovery OPERATION (gate → done-move → commit → rebase → performIntegration) ... The only missing piece is pointing it at the retained job worktree ... the ONLY new code is: resolve `--isolated <slug>` → the existing worktree dir, set complete's cwd to it."

That is not true for the stranded-green state. In `integration-core.ts` `performIntegration` runs in this ORDER: (1) gate, (2) done-move `git mv work/<source>/<slug>.md → work/done/<slug>.md`, (3) `git add -A` + commit, (4) rebase, (5) integrate/PUSH. A TERMINAL push failure happens at step 5 — AFTER the done-move and commit. So the retained worktree the reaper keeps is in this state (reproduced via a throwaway-git fixture: an offlining agent that breaks `origin` after editing, exactly like `test/do-remote.test.ts`'s retain test):
  - `work/done/<slug>.md` PRESENT; `work/in-progress/<slug>.md` and `work/needs-attention/<slug>.md` ABSENT
  - the green work ALREADY committed on `work/slice-<slug>` (`feat(<slug>): ...; done`), tip NOT on the arbiter
  - `do`'s outcome was `usage-error` (the push throw is swallowed by `performComplete`'s try/catch, NOT routed to needs-attention)

Running `complete` against that worktree (cwd = worktree, arbiter = `origin`, even with `--skip-verify`) therefore returns `refused`, NOT `completed`: `runComplete`/`performIntegration` resolve the source folder as `in-progress` || `needs-attention` (never `done/`), find neither, and `IntegrationNothingStaged` fires (the done-move + commit already happened, so nothing is left to stage). I confirmed this directly: `performComplete({slug, cwd: worktree, arbiter:'origin', integration:'merge', skipVerify:true})` → `outcome: 'refused'`, exit 1, work NOT on the arbiter.

So "locate the worktree + set complete's cwd" is necessary but NOT sufficient — it does not integrate the stranded commit; it refuses. Genuine recovery requires a NEW capability the slice does not scope: integrate an ALREADY-committed, already-done-moved work branch (item already in `done/`) by SKIPPING the done-move/commit and running only (rebase →) integrate/push. That is a new source-state path through the SHARED `integration-core.ts` (consumed by `do`, `run`, AND `complete`) plus a change to `complete.ts`'s source-folder resolution — load-bearing, hard-to-reverse, and touching other commands' integration machinery. This is the exact "design decision that no longer matches the code" STOP criterion, not a small self-contained factual gap.

Suggested re-scope (for a human to ratify before re-dispatch):
1. Add an explicit "recover already-committed work" source state to the shared integration core: when the item is already in `work/done/<slug>.md` AND the work branch tip is already committed but not on the arbiter, SKIP steps 2–3 (done-move + commit) and run only step 4 (rebase onto `<arbiter>/main`) → step 5 (integrate/push) — reusing `performIntegration`'s tail, never `--force` to main. Decide the surface: a new internal `source: 'done'` / `recovering: 'committed'` mode threaded through `IntegrationCoreInput`, or a dedicated thin recovery entry that calls only the rebase+integrate tail.
2. THEN add the `--isolated <slug>` locate-existing resolver (resolve arbiter URL from cwd via `resolveArbiterUrlFromCheckout` → `jobWorktreePath`/`encodeWorkId` → require a present worktree with a job record) and point that recovery path's `cwd` at it (arbiter remote inside the worktree = `origin`), plus `resume --isolated` and the `do`-integration-failure recovery-command surfacing.
3. Note a secondary discrepancy to resolve in the same pass: the incident/slice say the failed-push leaves a clean stranded-green worktree, but the current `do` path returns `usage-error` (push throw swallowed) WITHOUT routing to needs-attention or pushing the branch — so cross-machine the only artifact is the LOCAL retained worktree. Confirm that is the intended recovery surface for `--isolated` (it is local-only), and whether the `do` push-failure path should also surface the recovery command (the slice's 5th acceptance criterion) given it currently lands in the `usage-error` tail, not a needs-attention/`pushFailed` route.

No source changes were made; the working tree is clean and `work/in-progress/recover-stranded-green-work.md` is untouched.
