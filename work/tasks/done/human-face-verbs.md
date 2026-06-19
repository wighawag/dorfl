---
title: human-face-verbs — resume verb + work-on cd-by-default
slug: human-face-verbs
prd: command-surface-phase-2
blockedBy: [slug-namespace-resolution]
covers: [13, 15]
---

## What to build

The human-face additions of ADR §4 that are ready to build now — the in-place `resume` verb and `work-on` cd-by-default. (`--agent` interactive launch is split out into its own slice `agent-interactive-launch`, gated on an open seam question — see Out of Scope.)

- **`resume <slug>` verb** — re-engage an already-in-progress item in the current checkout: switch to its `work/<slug>` branch WITHOUT claiming (the item is already `in-progress/`). This is its own documented verb; **`start --resume` becomes a hidden alias** (kept for muscle memory). The documented surface: `start` = begin work here, `resume` = continue here. (The behaviour already exists as `start --resume`/`performStart({resume})`; this slice promotes it to a verb + hides the alias.)
- **`work-on` `cd`s you in by default** — the human parallel verb should drop the human into the new worktree. A binary cannot `cd` its parent shell, so this is via the documented shell wrapper (`work-on(){ cd "$(agent-runner work-on "$@" --print-dir)"; }`); make `--print-dir` the wrapper's plumbing (already exists) and ensure the default human-facing output guides the cd (the wrapper does the actual cd). Document the wrapper as the headline path; `--print-dir` is advanced/plumbing.
- **Migrate `work-on`'s remote form from POSITIONAL to the `--remote` FLAG.** Today `work-on` is `work-on <remoteOrSlug> [slug]` — positional disambiguation (one arg = in-repo slug; two args = `<remote> <slug>`). The ADR §4 surface is **`work-on --remote <r> <slug>`** (a flag), matching `do --remote`. Migrate the command to the `--remote` flag form (`work-on <slug>` in-repo; `work-on --remote <r> <slug>` remote) so the two verbs read consistently (`do ↔ work-on`, same target resolution: bare = current repo, `--remote` = anywhere). The underlying `performWorkOn({slug, remote})` already takes a `remote` separately from the slug — this is a CLI-surface change (how the two args are parsed), not a rewrite of `work-on.ts`'s logic.

Both honour `slug-namespace-resolution`: `resume`/`work-on` are slice-only (accept bare + `slice:`, reject `prd:`).

## Acceptance criteria

- [ ] `resume <slug>` switches to an in-progress item's `work/<slug>` branch without claiming; `start --resume` still works as a HIDDEN alias (not in the headline help).
- [ ] `work-on` `cd`s the human in by default via the documented shell wrapper; `--print-dir` remains the wrapper's plumbing (emits only the path).
- [ ] `work-on`'s remote form is the `--remote` FLAG (`work-on --remote <r> <slug>`), not the old positional `<remote> <slug>` — consistent with `do --remote` and ADR §4; the in-repo form stays `work-on <slug>`.
- [ ] `resume`/`work-on` accept bare + `slice:` and reject `prd:` (via `slug-namespace-resolution`).
- [ ] Tests: `resume` switches without claiming; `start --resume` aliases it; `--print-dir` unchanged; `prd:` rejected.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `slug-namespace-resolution` — `resume`/`work-on` are slice-only commands that must reject `prd:` and accept bare/`slice:` via the resolver. Must exist first.

## Prompt

> Build the ready-now human-face additions per `docs/adr/command-surface-and- journeys.md` §4: a `resume` verb (re-engage an in-progress item in the current checkout without claiming; `start --resume` becomes a HIDDEN alias) and `work-on` cd-by-default (via the documented shell wrapper; `--print-dir` is the wrapper's plumbing). `resume`/`work-on` are slice-only (reject `prd:`). NOTE: `--agent` interactive launch is explicitly NOT part of this slice (it is the separate, seam-gated `agent-interactive-launch` slice) — do not add it here.
>
> FIRST run the drift check: confirm `start.ts`/`performStart` still has the `resume` behaviour to promote to a verb (it does — `performStart({resume})` / the `resumed` outcome); confirm `work-on.ts`'s `--print-dir` + the shell-wrapper convention; confirm `slug-namespace-resolution` (in `done/`) exposes the slice-only `prd:`-rejection seam. Route to needs-attention on any discrepancy.
>
> READ FIRST: ADR `command-surface-and-journeys` §4 (the human verbs + `work-on --remote <r> <slug>` as a FLAG) + §7 (advanced/plumbing tier), `src/start.ts` (the existing `resume` behaviour to promote), `src/work-on.ts` (the `--print-dir` + shell-wrapper cd; `performWorkOn({slug, remote})`), `src/cli.ts` (the CURRENT positional `<remoteOrSlug> [slug]` parsing to migrate to `--remote`), and the `slug-namespace-resolution` done file (slice-only rejection of `prd:`).
>
> Implement the `resume` verb (+ hidden `start --resume` alias), `work-on` cd-by-default (wrapper + `--print-dir` plumbing), and migrate `work-on`'s remote form from the current POSITIONAL `<remote> <slug>` to the `--remote` FLAG (`work-on --remote <r> <slug>`; in-repo stays `work-on <slug>`) — consistent with `do --remote` + ADR §4 (the underlying `performWorkOn({slug, remote})` already separates them, so this is a CLI-parse change). Wire `resume`/`work-on` through the slice-only resolver.
>
> TDD with vitest, house style: `resume` switches without claiming; alias works; `--print-dir` unchanged; `prd:` rejected. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim human-face-verbs --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/human-face-verbs <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/human-face-verbs.md work/done/human-face-verbs.md
```
