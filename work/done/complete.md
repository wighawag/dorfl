---
title: complete — gate, mark done, commit, and integrate a work item
slug: complete
prd: agent-runner
humanOnly: true
blockedBy: [verify, claim-command]
covers: [12, 7, 8]
---

## What to build

`agent-runner complete [<slug>] [--skip-verify] [--type <t>] [--message <s>] [--arbiter <remote>]` — the human "finish this" command that runs the same back-half the autonomous runner runs: gate -> mark done -> commit -> integrate. Dual-use: this is the finish/integration logic `run-once`/`watch` reuse.

Resolved design points (were ambiguous; now decided):

- **Commit `<type>`/`<summary>` source (Q1):** from flags `--type` (default **`feat`**) and `--message` (default: the slice's `title` frontmatter, stripped of any leading "slug — " prefix). NOT interactive (must work unattended for the runner); no new frontmatter field. So zero-flag `complete foo` on a slice titled "foo — do the thing" produces `feat(foo): do the thing; done`.
- **What gets committed (Q2):** in the dogfood loop the build agent does NO git, so its work sits UNCOMMITTED in the working tree when `complete` runs. `complete` therefore `git add -A` (the agent's work + the `git mv`) into ONE atomic commit. Committing nothing is a no-op ERROR (mirrors claim.sh's no-op-is-fatal guard) — there must be real work and/or the move to commit.
- **Local main sync (Q3):** in `merge` mode, after pushing to the arbiter's `main`, also sync the LOCAL clone (`git switch main` + ff to the just-pushed commit) so the user ends on an up-to-date local main, not a stale one. The push is the authoritative step; the local sync is the ergonomic finish.
- **`--arbiter` (Q5):** defaults to `origin`, resolved like `claim`/`start` (flag > config `defaultArbiter` > `origin`).
- **Integration vocab (Q4):** the canonical modes are **`merge` | `propose`** (ADR §6, PRD). The existing code (`config.ts` `IntegrationMode`, `integrate.ts`, and `run-once` call sites) still uses the OLD `'pr'` name — a pre-rename debt. **This slice renames `pr` -> `propose` across the code** (config type + default, `integrate.ts`, callers), keeping existing tests green, so `complete` maps config -> integration with one vocabulary. Keep `merge` as-is.

End-to-end, on a `work/<slug>` branch (slug inferred from the branch if omitted):

1. **Gate**: run `agent-runner verify` (the per-repo gate). Abort with a clear message if it fails. `--skip-verify` skips it (human-only escape hatch; the autonomous runner never skips — ADR §8). Bad work never proceeds to done.
2. **Mark done**: `mkdir -p work/done` then `git mv work/in-progress/<slug>.md work/done/<slug>.md` (target dir created first — git doesn't track empty dirs).
3. **Commit**: `git add -A` (the agent's uncommitted work + the `git mv`) and make ONE atomic commit with the completed-slice message `<type>(<slug>): <summary>; done` (`<type>`/`<summary>` from flags/defaults above; CLAIM-PROTOCOL "completed-slice commit message"). Error if there is nothing to commit.
4. **Rebase-before-integrate** (ADR §10): `git fetch` + rebase `work/<slug>` onto the latest `<arbiter>/main`. Clean -> continue. Conflict -> `git rebase --abort` and STOP with a clear needs-attention message (the human resolves; `complete` never auto-resolves).
5. **Integrate** per config `integration`:
   - **`merge`**: ff onto `<arbiter>/main` (already rebased), push to main, then **sync the LOCAL clone**: `git switch main` + ff to the just-pushed commit (`pull --ff-only`, or fetch + reset to the new `<arbiter>/main`), so the user ends on an up-to-date local main. (Provider-agnostic git; in scope now.)
   - **`propose`**: push the `work/<slug>` branch (the safety-bearing step) + request review. The push + a `none`-provider message is in scope now; full provider-driven PR/MR creation lands with the integration seam (`agent-workspaces` + `integration-github`). Never `--force` to main.

Scope: minimal-but-useful now — gate + done-move + commit + push, full auto-merge in `merge` mode (incl. local-main sync), and the `pr`->`propose` code rename. `propose`-mode auto-PR is completed once the integration seam exists; until then `complete` pushes the branch and tells the human to open the review.

## Acceptance criteria

- [ ] On a `work/<slug>` branch (or with `<slug>`), `complete` runs `verify` and aborts (no done-move, no commit) if it fails.
- [ ] `--skip-verify` skips the gate (human-only); behaviour otherwise identical.
- [ ] On pass: `git mv` in-progress->done after `mkdir -p work/done`, then `git add -A` (all working-tree changes + the move) into ONE atomic commit `<type>(<slug>): <summary>; done`; errors if there is nothing to commit.
- [ ] `--type` (default `feat`) and `--message` (default from slice `title`) produce the message; `--arbiter` defaults to `origin` (resolved like `claim`/`start`).
- [ ] Before integrating, rebases `work/<slug>` onto the latest `<arbiter>/main`; a conflicting rebase is aborted and surfaced as needs-attention (never auto-resolved).
- [ ] `merge` mode: integrates to `<arbiter>/main` (ff after rebase + push) AND syncs the local clone so the user ends on an up-to-date local `main` (not stale); never `--force`.
- [ ] `propose` mode: pushes the branch and reports the next step (full provider PR creation deferred to the integration seam).
- [ ] The code's integration vocabulary is `merge` | `propose` (the old `pr` name is renamed across `config.ts`/`integrate.ts`/callers as part of this slice); existing run-once tests still pass after the rename.
- [ ] Slug inferred from the current `work/<slug>` branch when omitted.
- [ ] Tests cover: gate-fail aborts cleanly; gate-pass stages-all + does move+commit; `merge` integrates to arbiter main AND leaves local main up-to-date; a conflicting rebase aborts + surfaces; `--skip-verify`; the `pr`->`propose` rename keeps run-once tests green. Use throwaway repos + a local `--bare` arbiter.

## Blocked by

- `verify` — `complete` runs the gate via it.
- `claim-command` — shares the arbiter/branch plumbing and lives in the same command surface; `complete` finishes what `start`/`claim` began.

## Prompt

> Implement `agent-runner complete [<slug>] [--skip-verify] [--type <t>] [--message <s>] [--arbiter <remote>]` in `packages/agent-runner/`: the human finish-and-integrate command. READ FIRST: ADR §4/§6/§8/§10 in `docs/adr/execution-substrate-decisions.md` (deletion/integration/gate/ conflict), CLAIM-PROTOCOL.md (completed-slice commit message; done-move), and the existing `verify.ts`, `integrate.ts`, and `config.ts`.
>
> On a `work/<slug>` branch (infer slug from the branch if omitted): run `agent-runner verify` and abort if it fails (`--skip-verify` skips — human-only; the autonomous runner never skips). On pass: `mkdir -p work/done`, `git mv` in-progress->done, then `git add -A` (the build agent left its work UNCOMMITTED — stage everything) and make ONE atomic commit `<type>(<slug>): <summary>; done` (`--type` default `feat`; `--message` default = slice `title`); error if nothing to commit. Rebase onto the latest `<arbiter>/main` (ADR §10: clean continues; conflict -> `git rebase --abort` + stop, needs-attention; never auto-resolve). Then integrate per config `integration`: `merge` = push to `<arbiter>/main` AND sync the local clone to the new main (end on up-to-date local main); `propose` = push the branch + report the next step (full provider PR deferred to the integration seam). `--arbiter` defaults to `origin`. NEVER `--force` to main.
>
> ALSO (Q4 debt): the canonical integration vocab is `merge` | `propose`, but the code still uses the old `pr`. Rename `pr` -> `propose` across `config.ts` (`IntegrationMode` + default), `integrate.ts`, and run-once call sites, keeping existing tests green. This is the same finish/integration back-half the autonomous run-once/watch will reuse.
>
> TDD with vitest against throwaway repos + a local `--bare` arbiter: gate-fail aborts cleanly (nothing moved/committed); gate-pass stages-all + does the move+commit; `merge` integrates to arbiter main AND leaves local main up-to-date; conflicting rebase aborts + surfaces; `--skip-verify` works; the `pr`->`propose` rename keeps run-once tests passing. Follow `AGENTS.md` (format with `pnpm format`; the gate is check-only). Match house style; `commander`. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
