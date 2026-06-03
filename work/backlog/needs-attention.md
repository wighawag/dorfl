---
title: needs-attention — route stuck items to a folder, surface them, allow return
slug: needs-attention
prd: agent-runner
afk: false
blocked_by: [verify]
covers: [11, 12]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

The single, folder-native mechanism for "couldn't finish, a human must look":
move a stuck claimed item from `work/in-progress/` to `work/needs-attention/`,
record why, surface it, and allow a clean return to `backlog/`. See ADR §12 in
`docs/adr/execution-substrate-decisions.md` and the contract's
`needs-attention/` section in `WORK-CONTRACT.md` (the authoritative spec).

End-to-end:

- **The move:** a helper the runner calls when a claimed item cannot complete —
  failed acceptance gate (red `verify`), rebase/merge conflict (ADR §10), a slice
  the agent reported too ambiguous to build, a timeout, or a rejected review. It
  writes the **reason** (and any agent-surfaced questions) into the item's file
  body, then `git mv work/in-progress/<slug>.md work/needs-attention/<slug>.md`
  (mkdir -p first), committing the transition like the done-move. The RUNNER does
  this, never the build agent.
- **Wire the existing stuck outcomes into it:** `complete` (and later
  `run-once`/`watch`) route their failure paths here instead of just aborting —
  a red gate or a conflict ends with the item in `needs-attention/`, not left
  dangling in `in-progress/`.
- **Surface but don't claim:** `scan`/eligibility must SKIP `needs-attention/`
  items for claiming (they are not eligible), and `status` must LIST them with
  their recorded reason (this folder is the "look here" set).
- **Return path:** a command/step to move an item back to `backlog/` once the
  human has resolved the cause (`git mv needs-attention -> backlog`), so items do
  not rot. (Resolution itself is human; this just provides the clean re-queue.)

This subsumes the previously-parked "needs-attention surfacing" problem.

## Acceptance criteria

- [ ] A stuck claimed item is moved `in-progress -> needs-attention` (mkdir -p
      first) with the reason written into the file body, by the runner.
- [ ] The failure paths of `complete` (red gate, rebase conflict) end with the
      item in `needs-attention/` rather than dangling in `in-progress/`.
- [ ] `scan`/eligibility do NOT treat `needs-attention/` items as claimable.
- [ ] `status` lists `needs-attention/` items with their reason.
- [ ] A return step moves an item `needs-attention -> backlog` for re-claiming.
- [ ] No status/label FIELD is introduced — state remains the folder (contract
      rule 3); the reason is prose in the body, not a source-of-truth field.
- [ ] Tests cover the move (with reason), the not-claimable + surfaced behaviour,
      and the return path, against throwaway repos + a local `--bare` arbiter.

## Blocked by

- `verify` — the failed-gate outcome is the primary producer of needs-attention
  moves; this builds on the gate. (Conflict-producer paths land via the slices
  that own them — `complete` / `agent-workspaces`; this slice provides the shared
  move + surfacing they call.)

## Prompt

> Implement the `needs-attention` mechanism in `packages/agent-runner/`. READ
> FIRST: ADR §12 (and §10) in `docs/adr/execution-substrate-decisions.md`,
> and the `needs-attention/` section of `WORK-CONTRACT.md` (authoritative). Follow
> this repo's `AGENTS.md`.
>
> Build a runner-owned helper that, when a claimed item cannot complete (red
> `verify`, rebase/merge conflict, agent-reported ambiguity, timeout, rejected
> review), writes the reason (+ surfaced questions) into the item file and
> `git mv work/in-progress/<slug>.md work/needs-attention/<slug>.md` (mkdir -p
> first), committing it like the done-move. The build agent never does this. Wire
> `complete`'s failure paths (red gate, rebase conflict) to route here instead of
> dangling in `in-progress/`. Make `scan`/eligibility SKIP `needs-attention/` for
> claiming but have `status` LIST these with their reason. Add a return step that
> `git mv`s an item back to `backlog/` for re-claiming. Introduce NO status/label
> field — state stays the folder (contract rule 3); the reason is prose in the
> body.
>
> TDD with vitest against throwaway repos + a local `--bare` arbiter: the move
> (with reason recorded), not-claimable-but-surfaced, and the return path. "Done"
> = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r
> format:check` green.
