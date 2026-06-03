---
title: complete — gate, mark done, commit, and integrate a work item
slug: complete
prd: agent-runner
afk: false
blocked_by: [verify, claim-command]
covers: [12, 7, 8]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

`agent-runner complete [<slug>] [--skip-verify]` — the human "finish this" command
that runs the same back-half the autonomous runner runs: gate → mark done →
commit → integrate. Dual-use: this is the finish/integration logic `run-once`/
`watch` reuse.

End-to-end, on a `work/<slug>` branch (slug inferred from the branch if omitted):

1. **Gate**: run `agent-runner verify` (the per-repo gate). Abort with a clear
   message if it fails. `--skip-verify` skips it (human-only escape hatch; the
   autonomous runner never skips \u2014 ADR §8). Bad work never proceeds to done.
2. **Mark done**: `mkdir -p work/done` then `git mv work/in-progress/<slug>.md
   work/done/<slug>.md` (target dir created first \u2014 git doesn't track empty dirs).
3. **Commit**: one atomic commit (work + the move) with the completed-slice
   message format `<type>(<slug>): <summary>; done` (CLAIM-PROTOCOL "completed-slice
   commit message").
4. **Integrate** per config `integration`:
   - **`merge`**: ff/rebase onto `<arbiter>/main`, push to main, return to main.
     (Provider-agnostic git; in scope now.)
   - **`propose`**: push the `work/<slug>` branch (the safety-bearing step) +
     request review. The push + a `none`-provider message is in scope now; full
     provider-driven PR/MR creation lands with the integration seam
     (`agent-workspaces` + `integration-github`). Never `--force` to main.

Scope: minimal-but-useful now \u2014 gate + done-move + commit + push, and full
auto-merge in `merge` mode. `propose`-mode auto-PR is completed once the
integration seam exists; until then `complete` pushes the branch and tells the
human to open the review.

## Acceptance criteria

- [ ] On a `work/<slug>` branch (or with `<slug>`), `complete` runs `verify` and
      aborts (no done-move, no commit) if it fails.
- [ ] `--skip-verify` skips the gate (human-only); behaviour otherwise identical.
- [ ] On pass: `git mv` in-progress\u2192done after `mkdir -p work/done`, one atomic
      commit using `<type>(<slug>): <summary>; done`.
- [ ] `merge` mode: integrates to `<arbiter>/main` (ff/rebase + push) and returns
      the user to `main`; never `--force`.
- [ ] `propose` mode: pushes the branch and reports the next step (full
      provider PR creation deferred to the integration seam).
- [ ] Slug inferred from the current `work/<slug>` branch when omitted.
- [ ] Tests cover: gate-fail aborts cleanly; gate-pass does done-move+commit;
      `merge` integrates to main on a local `--bare` arbiter; `--skip-verify`
      path. Use throwaway repos + a local `--bare` arbiter.

## Blocked by

- `verify` \u2014 `complete` runs the gate via it.
- `claim-command` \u2014 shares the arbiter/branch plumbing and lives in the same
  command surface; `complete` finishes what `start`/`claim` began.

## Prompt

> Implement `agent-runner complete [<slug>] [--skip-verify]` in
> `packages/agent-runner/`: the human finish-and-integrate command. READ FIRST:
> ADR §4/§6/§8 in `work/findings/execution-substrate-decisions.md` (deletion/
> integration/gate), CLAIM-PROTOCOL.md (completed-slice commit message; done-move),
> and the `verify` slice.
>
> On a `work/<slug>` branch (infer slug from the branch if omitted): run
> `agent-runner verify` and abort if it fails (`--skip-verify` skips \u2014 human-only;
> the autonomous runner never skips). On pass: `mkdir -p work/done` then `git mv`
> in-progress\u2192done, one atomic commit `<type>(<slug>): <summary>; done`. Then
> integrate per config `integration`: `merge` = ff/rebase onto `<arbiter>/main` +
> push + return to main (in scope now); `propose` = push the branch + report the
> next step (full provider PR creation is deferred to the integration seam in
> `agent-workspaces`/`integration-github`). NEVER `--force` to main. This is the
> same finish/integration back-half the autonomous run-once/watch will reuse.
>
> TDD with vitest against throwaway repos + a local `--bare` arbiter: gate-fail
> aborts cleanly (nothing moved/committed); gate-pass does the move+commit;
> `merge` integrates to main; `--skip-verify` works. Match house style;
> `commander`. \"Done\" = acceptance criteria met and `pnpm -r build && pnpm -r
> test && pnpm -r format:check` green.
