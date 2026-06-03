---
title: complete integration flag — choose merge/propose per invocation; switch to main on both
slug: complete-integration-flag
prd: agent-runner
afk: false
blocked_by: [complete]
covers: [7, 8]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

Let the human choose the integration mode **at `complete` time** (the moment it
actually applies), via flags, falling back to config. Integration mode is decided
at completion/integration time — NOT at `start` time (that would force stamping
runtime policy into slice frontmatter, which is rejected for the same reason
per-slice gates are: it puts non-source-of-truth runtime state into declarative
slice content). A `complete`-time flag is per-invocation and stateless — no
carry-forward, no advisory field.

End-to-end:

- `agent-runner complete` gains mutually-exclusive **`--merge`** / **`--propose`**
  flags.
- **Resolution precedence** (highest first):
  1. `--merge` / `--propose` flag (this invocation)
  2. per-repo config integration override (see the `per-repo-config` slice; if not
     yet available, this level is simply skipped)
  3. global config `integration`
  4. built-in default `propose`
- The autonomous runner (`run-once`/`watch`) stays **config-only** (no per-tick
  flag — it batches many items): it resolves per-repo override > global > default.
  Both paths therefore resolve the same underlying order; only the human path adds
  the top-priority flag.

**Also fix: `complete` switches the human back to `main` in BOTH modes.** Today
`complete` switches to local `main` only in `merge` mode; in `propose` mode it
leaves the human on `work/<slug>`. Make it switch to `main` in propose mode too,
for a consistent "land back on main, ready for the next thing" finish — but the
behaviour differs per mode (the work's location differs):

- **merge:** switch to `main` AND fast-forward it to the just-pushed `<arbiter>/main`
  (the work landed there) — unchanged.
- **propose:** the work is on a pushed branch awaiting review, NOT on main, so
  **just `git switch main`** — do NOT ff (arbiter main hasn't moved; nothing to
  ff) and do NOT delete the `work/<slug>` branch (the PR is built from it; keep it
  local + remote intact, merely switch off it).
- **`--no-switch`** opt-out (both modes): leave the human on `work/<slug>` (for
  "I'll keep iterating on this branch, e.g. address review feedback").

## Acceptance criteria

- [ ] `complete --merge` integrates in merge mode; `complete --propose` in propose
      mode, regardless of config.
- [ ] `--merge` and `--propose` are mutually exclusive (error if both given).
- [ ] With no flag, mode comes from config (per-repo override if present, else
      global, else `propose`).
- [ ] Precedence is exactly: flag > per-repo > global > `propose`.
- [ ] The autonomous runner resolves mode from config only (no flag); shares the
      same per-repo > global > default order.
- [ ] `complete` switches the human back to local `main` in BOTH modes by
      default: merge = switch + ff to the new main; propose = `git switch main`
      only (no ff, and the `work/<slug>` branch is kept intact local + remote).
- [ ] `--no-switch` leaves the human on `work/<slug>` in either mode.
- [ ] Tests cover each precedence level, the mutually-exclusive error, the
      switch-to-main behaviour in both modes, and `--no-switch`.

## Blocked by

- `complete` — adds the flag + resolution to it.

## Prompt

> Add `--merge`/`--propose` to `agent-runner complete` in `packages/agent-runner/`,
> resolving the integration mode at completion time. Read `complete.ts` and
> `config.ts`. The flags are mutually exclusive (error if both). Resolution
> precedence, highest first: the flag (this invocation) > per-repo config override
> (from the `per-repo-config` slice — if that layer isn't present yet, skip it) >
> global config `integration` > built-in default `propose`. Do NOT let integration
> mode be chosen at `start` time or stamped into slice frontmatter — it is resolved
> only where it applies (complete/integrate). Keep the autonomous runner
> (`run-once`/`watch`) config-only (no per-tick flag), resolving the same per-repo >
> global > default order so human and autonomous paths agree.
>
> ALSO fold in this fix: `complete` must switch the human back to local `main` in
> BOTH modes (today it only does in merge). merge = switch + ff to the new main
> (unchanged); propose = `git switch main` ONLY (the work is on a pushed branch
> awaiting review, not on main — do not ff, and keep the `work/<slug>` branch
> intact local + remote). Add `--no-switch` to leave the human on the work branch
> in either mode.
>
> TDD with vitest: each precedence level; the mutually-exclusive flag error; the
> autonomous config-only path; switch-to-main in both modes; `--no-switch`. Follow
> `AGENTS.md` (format with `pnpm format`; gate is check-only). Match house style;
> `commander`. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test
> && pnpm -r format:check` green.
