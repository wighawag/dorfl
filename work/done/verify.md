---
title: verify — run the per-repo acceptance gate (the shared test boundary)
slug: verify
prd: agent-runner
afk: false
blocked_by: [scan]
covers: [12]
created: 2026-06-03
claimed_by: wighawag
claimed_at: 2026-06-03T15:42:28Z
---

## What to build

The acceptance **gate** as a first-class, configurable, per-repo command:
`agent-runner verify`. It runs whatever deterministic check the repo declares
(build + tests + format, etc.) and exits 0 iff the work is acceptable. This is
the single shared mechanism that both the human `complete` command and the
autonomous `run-once`/`watch` use — see ADR §8 in
`docs/adr/execution-substrate-decisions.md`.

End-to-end:

- **Per-repo gate config**: a `verify` command (or ordered list of commands) in
  the agent-runner config, e.g. `"verify": "pnpm -r build && pnpm -r test && pnpm
  -r format:check"`. Sensible default if unset (the repo's `pnpm -r` build/test/
  format). The gate is **declared config**, NOT interpreted from each slice
  (per-repo, not per-slice — deterministic, auditable, no model in the loop).
- `agent-runner verify` runs it in the repo, streams output, exits with its
  status (0 = pass). Read-only with respect to `work/` (it runs tests; it does
  not move or commit anything).
- It is a plain shell gate: no LLM/model interaction is needed to know or run the
  gate (it is config, not prose).

Authority note (for consumers, not this slice): the gate is **authoritative and
non-skippable** for the autonomous runner (the trust boundary that keeps bad work
out of `done/` — PRD story 12), and a **default-on, skippable** safety-net for the
human `complete` (`--skip-verify`). `verify` itself just runs the gate; callers
decide authority.

## Acceptance criteria

- [ ] `agent-runner verify` runs the repo's configured gate command(s) and exits
      with their status (0 = pass, non-zero = fail), streaming output.
- [ ] The gate command is read from per-repo config (`verify`), with a sensible
      `pnpm -r` default when unset.
- [ ] No model/LLM interaction is involved; the gate is declared config run as a
      shell command.
- [ ] `verify` does not modify or move anything under `work/` (it only runs the
      check).
- [ ] Tests cover: pass → exit 0, fail → non-zero, default-when-unset, and custom
      configured command.

## Blocked by

- `scan` — needs the package/core + config plumbing; independent of the substrate.

## Prompt

> Implement `agent-runner verify` in `packages/agent-runner/`: run the repo's
> declared acceptance gate and exit with its status. READ FIRST: ADR §8 in
> `docs/adr/execution-substrate-decisions.md` (the shared gate seam;
> per-repo not per-slice; authority differs by caller) and the existing config
> module.
>
> Add a per-repo `verify` config key (string command or ordered list), with a
> sensible default (`pnpm -r build && pnpm -r test && pnpm -r format:check`).
> `verify` runs it in the repo, streams output, exits 0 iff it passes. It is a
> deterministic shell gate \u2014 NO model interaction to determine or run it. It must
> not move/commit anything under `work/`. This same mechanism will be consumed by
> the human `complete` command (skippable via --skip-verify) and by the
> autonomous run-once/watch (authoritative, non-skippable) \u2014 but `verify` itself
> just runs the gate; callers decide authority.
>
> TDD with vitest: pass/fail exit propagation, default-when-unset, custom command.
> Match house style; `commander`. \"Done\" = acceptance criteria met and `pnpm -r
> build && pnpm -r test && pnpm -r format:check` green.
