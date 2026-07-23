---
title: 'autoslice-gate — autoSlice policy + slicing-eligibility predicate (pure)'
slug: autoslice-gate
spec: auto-slice
blockedBy: [config-env-layer]
covers: [2, 3]
---

## What to build

The pure decision layer for auto-slicing, one level up from the build gate:

- A new per-repo policy key **`autoSlice`** in config/repo-config — _may an agent auto-slice undeclared PRDs in this repo?_ Default `false`, resolved through the full chain (now including the landed env layer): **flag > `DORFL_*` env > per-repo `dorfl.json` > global > built-in default `false`** — exactly mirroring `allowAgents`/`integration`. (So `autoSlice` gets env support for free.)
- The pure **slicing-eligibility predicate**: a SPEC is agent-sliceable iff `needsAnswers !== true && humanOnly !== true && autoSlice` (the same shape as the build gate, applied to the SPEC's two axes + the repo policy). A human is never bound by it.
- The pure **`sliceAfter` resolution**: given a SPEC's `sliceAfter: [other-spec]` list, resolve it against the **`sliced:` marker** of those PRDs (NOT `done/`) — agent-sliceable only when every listed SPEC is already sliced. (A human may override.)

All pure functions + config plumbing — no harness, no git, no lock. This is the substrate the command (a later slice) consumes.

## Acceptance criteria

- [ ] `autoSlice` resolves flag > env (`DORFL_AUTO_SLICE`) > per-repo > global > default `false`, like `allowAgents` (with typed coercion + loud rejection of an invalid value, per the env layer's conventions).
- [ ] The slicing-eligibility predicate is a pure function: sliceable iff `needsAnswers !== true && humanOnly !== true && autoSlice`.
- [ ] `sliceAfter` resolution is a pure function against the `sliced:` marker of the listed PRDs (not `done/`); unsliced blocker ⇒ not yet sliceable.
- [ ] Tests cover the resolution precedence, the predicate's truth table (all four humanOnly×needsAnswers states × autoSlice on/off), and `sliceAfter` resolved against sliced-vs-unsliced fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `config-env-layer` — `autoSlice` slots into the config-resolution chain it established (and reuses its env-coercion). Same files (`config.ts`/ `repo-config.ts`), so serialized to avoid a conflict. (In `done/`.)

## Prompt

> Add the pure decision layer for auto-slicing (the `do prd:<slug>` slicing path is a LATER slice — this one is config + pure predicates only; do NOT build the command or the lock here).
>
> READ FIRST: `work/spec/auto-slice.md` (the gate + `sliceAfter` semantics), `src/config.ts` + `src/repo-config.ts` + `src/env-config.ts` (the resolution chain `flag > DORFL_* env > per-repo > global > default`, and how `allowAgents` is wired — mirror it), `src/eligibility.ts` (the build-gate predicate shape to mirror one level up), and how the `sliced:` marker is read (`frontmatter.ts`; the ledger/scan readers).
>
> Implement: (1) the `autoSlice` per-repo policy key resolving like `allowAgents` through the full chain incl. the env layer (typed coercion, loud reject on bad input); (2) the pure slicing-eligibility predicate (`needsAnswers !== true && humanOnly !== true && autoSlice`); (3) pure `sliceAfter` resolution against the `sliced:` marker (NOT `done/`). No harness, no git, no lock, no command.
>
> TDD with vitest, house style: resolution precedence, the predicate truth table, and `sliceAfter` against sliced/unsliced fixtures. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim autoslice-gate --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/autoslice-gate <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/autoslice-gate.md work/done/autoslice-gate.md
```
