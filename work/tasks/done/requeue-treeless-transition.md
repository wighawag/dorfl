---
title: requeue performs its backlog-folder transition WITHOUT writing the cwd working tree (tree-less CAS push, like claim) so it never collides with a concurrent writer in a shared checkout
slug: requeue-treeless-transition
blockedBy: []
---

## What to build

Make `requeue` perform its `needs-attention/ → backlog/` folder transition **without staging or committing in the cwd working tree**, the same way `claim` (`performClaim`) already does its `backlog/ → in-progress/` move as an atomic compare-and-swap push to the arbiter ref. Today `requeue` (`ledgerWrite.applyReturnToBacklogTransition`) does a `git mv` + commit **directly in `--cwd`** (default `process.cwd()`), so when it runs in a working tree another actor is using, its commit can sweep up that actor's uncommitted files.

This is a real, observed defect: a concurrent autonomous `requeue` (`advance-verb-resolver`) committed in this repo's shared checkout and swallowed an assistant's uncommitted `work/ideas/` files into commit `8c92f63`. See `work/observations/drive-backlog-skill-assumes-in-place-do-not-remote.md` (the "precise mechanism" section) for the full incident + the correction that this is NOT a consequence of `requeue` being a "human verb" — it is an isolation choice, orthogonal to commit attribution.

### Precise scope

- Move the `requeue` transition off the cwd working tree. The move is a single file rename (`work/needs-attention/<slug>.md → work/backlog/<slug>.md`) plus the body-append for `-m/--message` — it does NOT need a checkout to compute. Construct the transition as a commit and **CAS-push it to the arbiter**, exactly the mechanism `performClaim` / the `ledger-write` CAS seam already use for the claim move (the same `:main` push + lease + verify strategy — reuse it, do not hand-roll a second one).
- **Preserve every behaviour:** default keep+continue (move + commit + push, branch untouched), `--reset` (delete remote branch first, then move), `-m/--message` (dated handoff note appended, append-only, both modes), the `--arbiter` requirement for `--reset`, and the HUMAN identity attribution (ambient `process.env`, NOT the runner `config.identity`). ONLY the WHERE-it-writes changes (arbiter ref, not the cwd tree); the WHAT and WHO are unchanged.
- **Attribution stays human.** Tree-less does NOT mean identity-aware: the requeue commit is still the human's (ambient env), threaded explicitly at the call site as today. (Where-it-writes and whose-commit-it-is are orthogonal axes — this slice changes only the former.)
- **`--cwd` becomes an ORIGIN SOURCE, not a write target:** it is used to resolve the arbiter remote (as `claim` uses it), never as the place the transition is staged/committed. A `requeue` from inside a repo must leave that repo's working tree byte-for-byte untouched.
- Resolve the `claim`/`requeue` inconsistency: a backlog-folder transition should have ONE mechanism, and the safe (no-cwd-write) one `claim` already uses is it. Prefer reusing `performClaim`'s CAS path / the shared `ledger-write` seam over duplicating logic.

> Drift note: confirm `performClaim` / the `ledger-write` CAS seam is still the tree-less claim mechanism (it was at slice time). If the claim path has changed, reconcile against the CURRENT claim implementation — the goal is "requeue writes the arbiter the SAME tree-less way claim does", whatever that is now.

## Acceptance criteria

- [ ] `requeue <slug>` performs the `needs-attention/ → backlog/` move via a CAS push to the arbiter ref, NOT a `git mv` + commit in the cwd working tree.
- [ ] After a `requeue` run from inside a repo, the cwd working tree is UNTOUCHED — a pre-existing uncommitted/untracked file in that tree is neither staged nor committed by `requeue` (this is the regression test for the `8c92f63` incident: seed an untracked file, run `requeue`, assert it is still untracked and not in any commit `requeue` made).
- [ ] All existing `requeue` behaviours preserved: default keep+continue (branch untouched), `--reset` (remote branch deleted first, `--arbiter` required), `-m/--message` (dated append, both modes), human identity attribution (ambient env, not `config.identity`).
- [ ] The transition reuses the shared claim/`ledger-write` CAS mechanism rather than a second hand-rolled push+lease+verify.
- [ ] Tests use throwaway git repos / the existing CAS-seam test style; assert no shared/global location is touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately.

## Prompt

> Make `requeue` do its `needs-attention/ → backlog/` folder transition WITHOUT writing the current working tree — as an atomic compare-and-swap push to the arbiter ref, exactly like `claim` (`performClaim`) already does its `backlog/ → in-progress/` move. Today `requeue` (`ledgerWrite.applyReturnToBacklogTransition`, wired at the `requeue` command in `cli.ts`) does a `git mv` + commit directly in `--cwd`, which means a `requeue` run in a shared checkout can sweep up another actor's uncommitted files into its commit. This was observed live (commit `8c92f63` swallowed an assistant's `work/ideas/` files); the full incident + analysis is in `work/observations/drive-backlog-skill-assumes-in-place-do-not-remote.md` ("The precise mechanism" section).
>
> Preserve EVERY existing behaviour — default keep+continue (branch untouched), `--reset` (delete remote branch first; `--arbiter` required), `-m/--message` (dated handoff note, append-only, both modes), and the HUMAN identity attribution (ambient `process.env`, never `config.identity`). Change ONLY where the transition writes: the arbiter ref via the shared CAS, not the cwd working tree. Tree-less is orthogonal to attribution — the commit stays the human's. `--cwd` becomes purely an origin source (to resolve the arbiter remote), never a write target.
>
> READ FIRST: `packages/agent-runner/src/cli.ts` (the `requeue` command — `.command('requeue <slug>')` — and how it calls `applyReturnToBacklogTransition`), `packages/agent-runner/src/ledger-write.ts` (`applyReturnToBacklogTransition` + the CAS write seam), `performClaim` / the claim CAS (in `claim-cas.ts`, used from `cli.ts`/`do.ts` — the tree-less CAS claim move), and `work/observations/drive-backlog-skill-assumes-in-place-do-not-remote.md`. Reuse the claim/`ledger-write` CAS path — do NOT hand-roll a second push+lease+verify. Resolve the `claim`/`requeue` inconsistency toward the safe tree-less mechanism.
>
> FIRST, check this slice against current reality (drift): confirm `claim` is still tree-less via `performClaim`/the `ledger-write` CAS seam and that `requeue` still does an in-cwd `git mv`+commit. If either has changed, reconcile against the current code or route to `needs-attention/` with the discrepancy.
>
> TDD with vitest, house style (throwaway git repos for the CAS). The headline regression test: seed an untracked file in the repo, run `requeue`, assert that file is still untracked and absent from any commit `requeue` made, AND that the slice moved `needs-attention/ → backlog/` on the arbiter. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim requeue-treeless-transition --arbiter origin
git fetch origin && git switch -c work/requeue-treeless-transition origin/main
git mv work/in-progress/requeue-treeless-transition.md work/done/requeue-treeless-transition.md
```
