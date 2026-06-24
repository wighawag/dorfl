# Working in this repo (agent guidance)

Repo-specific etiquette for any agent working in `dorfl`. This is local convenience guidance read by the harness; it is NOT part of the dorfl protocol and the protocol must not depend on it (see the note on git below).

## Formatting — run the writer, not the checker first

To fix formatting, run the **writer** directly:

```sh
pnpm format            # prettier --write . (fixes formatting)
```

Do NOT run `pnpm format:check` first expecting to hand-fix the diff — just run `pnpm format`, then the check passes. (`format:check` is the read-only gate used for verification, not the way to fix things.)

## Acceptance gate

A task is "green" / done-eligible when this passes (equivalent to `dorfl verify`):

```sh
pnpm -r build && pnpm -r test && pnpm format:check
```

Note: `format:check` is a ROOT-only script (`prettier --check .`), so it is `pnpm format:check`, NOT `pnpm -r format:check`. The `-r` form errors `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` because no package has that script, whereas `build`/`test` DO exist per-package so the `-r` form is correct for those. This matches the `verify` command in `.dorfl.json`.

So a normal finish is: `pnpm format` → confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Protocol docs — edit the SOURCE, never `work/protocol/`

This repo is special: it is both a **user** of the dorfl protocol (it has its own `work/` tree) AND the **author** of it. The protocol docs therefore exist in two places:

- **`skills/setup/protocol/*`** — the **SOURCE OF TRUTH**. `setup` copies these into every target repo's `work/protocol/`. Edit the protocol HERE.
- **`work/protocol/*`** — a **propagated COPY** for this repo's own use. Treat it as generated; do NOT edit it directly.

When you change a protocol doc (`WORK-CONTRACT.md`, `ADR-FORMAT.md`, `CLAIM-PROTOCOL.md`, the templates, `VERSION`), edit `skills/setup/protocol/` and mirror the same change into `work/protocol/` so the two stay byte-identical (`diff -r skills/setup/protocol work/protocol` should be clean apart from files that legitimately only live in one). Editing `work/protocol/` alone silently drifts the copy from the source, and the next `setup` run will propagate the OLD source text — losing your change everywhere else.

## Website (`website/`)

The `website/` folder holds the **Dorfl** marketing/landing site (Dorfl is the new name for this tool) plus the brand assets in `website/branding/`. It has its own scoped guidance in **`website/AGENTS.md`** — read it before working there.

The key rule, repeated here in case nested `AGENTS.md` files are not auto-loaded: the site is scaffolded from our house template `~/dev/github/wighawag/template-svelte-tailwind`, and **any decision/fix/dependency/config choice made while building it may be a general improvement worth backporting to that template.** Record every such deviation in `website/TEMPLATE-NOTES.md` (Dorfl-specific vs. backport-candidate) so template improvements are never silently lost. The site living directly under `website/` (not `website/web/`) is NOT a deviation — it is just a workspace member of this already-existing monorepo.

## Git transitions (reminder only — not the source of truth)

When you are dispatched to build a work task, you do NOT perform git operations on this repo: no stage/commit/push, and do not move files between `work/` folders. The runner/human owns every git-state transition (claim, done-move, commit, integration). Your tests MAY use their own throwaway git repos.

> This is only a local reminder. The authoritative statement is **in-band in the prompt** the runner hands you (and in `work/findings/execution-substrate-decisions.md` §9 + the PRD): the dorfl protocol states it in the prompt precisely so it does not rely on this file existing. Do not treat this `AGENTS.md` as the protocol's source of truth for the git rule.
