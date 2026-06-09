# Working in this repo (agent guidance)

Repo-specific etiquette for any agent working in `agent-runner`. This is local convenience guidance read by the harness; it is NOT part of the agent-runner protocol and the protocol must not depend on it (see the note on git below).

## Formatting — run the writer, not the checker first

To fix formatting, run the **writer** directly:

```sh
pnpm format            # prettier --write . (fixes formatting)
```

Do NOT run `pnpm format:check` first expecting to hand-fix the diff — just run `pnpm format`, then the check passes. (`format:check` is the read-only gate used for verification, not the way to fix things.)

## Acceptance gate

A slice is "green" / done-eligible when this passes (equivalent to `agent-runner verify`):

```sh
pnpm -r build && pnpm -r test && pnpm -r format:check
```

So a normal finish is: `pnpm format` → confirm `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

## Git transitions (reminder only — not the source of truth)

When you are dispatched to build a work slice, you do NOT perform git operations on this repo: no stage/commit/push, and do not move files between `work/` folders. The runner/human owns every git-state transition (claim, done-move, commit, integration). Your tests MAY use their own throwaway git repos.

> This is only a local reminder. The authoritative statement is **in-band in the prompt** the runner hands you (and in `work/findings/execution-substrate-decisions.md` §9 + the PRD): the agent-runner protocol states it in the prompt precisely so it does not rely on this file existing. Do not treat this `AGENTS.md` as the protocol's source of truth for the git rule.
