---
title: claim command — agent-runner claim, a TS reimplementation of the claim CAS
slug: claim-command
prd: agent-runner
afk: false
blocked_by: [scan]
covers: [5]
created: 2026-06-03
claimed_by: wighawag
claimed_at: 2026-06-03T14:38:02Z
---

## What to build

`agent-runner claim <slug>` — a first-class, in-process implementation of the
atomic compare-and-swap claim, faithful to the existing `CLAIM-PROTOCOL.md` and
behaviourally equivalent to `skills/to-slices/scripts/claim.sh`. Per ADR §8
(`docs/adr/execution-substrate-decisions.md`), agent-runner is the primary
implementation of the claim protocol; `claim.sh` is retained as the portable,
zero-dependency bootstrap/reference, not replaced or deleted.

End-to-end:

- `agent-runner claim <slug> [--arbiter <remote>] [--by <who>] [--retries N]
  [--dry-run]` with the SAME exit-code semantics as `claim.sh`: `0` claimed, `2`
  not claimable / lost the race, `3` contended after retries, `1` usage/env error.
- Performs the CAS dance from CLAIM-PROTOCOL: refuse on dirty tree; fetch arbiter;
  branch off `<arbiter>/main`; `git mv work/backlog/<slug>.md
  work/in-progress/<slug>.md` (mkdir -p target; stamp advisory claimed_by/at);
  commit; push `claim/<slug>:main --force-with-lease`; verify `<arbiter>/main`
  points at the claim; restore original branch; clean up the claim branch.
- Same guardrails: no-op claim is fatal (never a false "claimed"); failed move is
  fatal; verify-after-push; cap retries then back off.

This consumes the deterministic core where useful but the claim itself is git
plumbing; keep it a focused command. Later, `run-once`/`agent-workspaces` may use
this in-process claim instead of shelling out to `claim.sh` (not required here).

## Acceptance criteria

- [ ] `agent-runner claim <slug>` claims a backlog item via CAS push to the
      arbiter, moving it backlog→in-progress on `<arbiter>/main`.
- [ ] Exit codes match `claim.sh`: 0/2/3/1 as specified.
- [ ] Refuses on a dirty tree; restores the original branch afterward; cleans up
      the claim branch.
- [ ] A simultaneous two-claimer race over the same slug yields exactly one
      winner (the loser gets exit 2) — verified against a local `--bare` arbiter.
- [ ] No-op / failed-move cases are fatal (never a false success).
- [ ] `--dry-run` shows the intended push without mutating the arbiter.
- [ ] `claim.sh` remains present and functional (portable bootstrap).
- [ ] Tests mirror the `claim.sh` verification approach (throwaway repos + bare
      arbiter, true concurrent race).

## Blocked by

- `scan` — needs the package/core in place; independent of the workspace substrate.

## Prompt

> Implement `agent-runner claim <slug>` in `packages/agent-runner/` — an
> in-process TS implementation of the atomic claim compare-and-swap. READ FIRST:
> `skills/to-slices/CLAIM-PROTOCOL.md` (the protocol), `skills/to-slices/scripts/claim.sh` (the reference
> implementation you are matching), and ADR §8 in
> `docs/adr/execution-substrate-decisions.md` (agent-runner is the primary
> impl; claim.sh stays as the portable bootstrap — do not delete it).
>
> Match `claim.sh` exactly in behaviour and exit codes (0 claimed, 2 not
> claimable/lost race, 3 contended, 1 usage/env): refuse on dirty tree, fetch
> arbiter, branch off `<arbiter>/main`, `git mv` backlog→in-progress (mkdir -p,
> stamp advisory claimed_by/at), commit, push `claim/<slug>:main`
> `--force-with-lease`, verify the arbiter main is your claim, restore branch,
> clean up. No-op and failed-move must be fatal (never a false claimed). Support
> `--arbiter`, `--by`, `--retries`, `--dry-run`.
>
> TDD with vitest, mirroring `claim.sh`'s verification: a truly simultaneous
> two-claimer race over one slug must show exactly one winner, against a local
> `--bare` arbiter. Match house style; `commander` for the command. "Done" =
> acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r
> format:check` green.
