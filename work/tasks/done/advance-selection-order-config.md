---
title: 'configurable advance selection ORDER across the action pools (apply pinned first; a preset string OR an explicit pool-order list), generalizing the prdsFirst boolean'
slug: advance-selection-order-config
blockedBy: [advance-autopick-lifecycle-pools]
covers: []
---

> Self-contained ENGINE slice (`covers: []`, no `prd:`). Source: design conversation 2026-06-12 (once auto-pick has FOUR pools, a single `prdsFirst` boolean can no longer order them). Decision ADR `docs/adr/ci-config-policy-and-gate-family.md` (selection-order section). `blockedBy` `advance-autopick-lifecycle-pools` because that slice introduces the observation + needsAnswers-blocked pools this order must rank.

## The gap this fixes

Today `selectPrioritised` (`select-priority.ts`) orders exactly TWO pools (eligible slices, sliceable PRDs) via a single boolean `prdsFirst` (slices-first default, or flipped). Once `advance-autopick-lifecycle-pools` adds the observation pool and the `needsAnswers`-blocked pool, there are effectively FIVE actions to order and a boolean cannot express it:

- **apply** (consume a human's committed answer on an answered-sidecar item),
- **build** (build an eligible slice),
- **slice** (slice a sliceable SPEC),
- **surface** (render a `needsAnswers` blocker into a sidecar),
- **triage** (triage an untriaged observation).

## What to build

A single per-repo `Config` field, **`selectionOrder`**, that controls the order `selectPrioritised` interleaves the pools, with TWO load-bearing rules:

1. **`apply` is PINNED FIRST and is NOT configurable.** Consuming a human's committed answer is the highest-value, cheapest (the consume part needs no model) action and a human is waiting on it, deprioritizing it is never a real want (the create-vs-consume principle: consume always wins). So `selectionOrder` ranks only the OTHER FOUR (`build` / `slice` / `surface` / `triage`); `apply` is always prepended.

2. **The field accepts a PRESET STRING or an explicit ORDER LIST (preset is sugar over a list).** The canonical internal form is an ordered list of pool names; a recognized preset KEYWORD expands to a list:
   - `drain` (default) ⇒ `[build, slice, surface, triage]` (drain ready work, then create, then ask, generalizing today's slices-first "drain before create").
   - `groom` ⇒ `[surface, triage, build, slice]` (ask/groom first, build later).
   - (more presets only if a real need appears, keep the set small.)
   - an explicit list (`[build, slice, surface, triage]`, or the env comma form `build,slice,surface,triage`) is taken verbatim.

   So a user writes EITHER `selectionOrder: drain` (preset) OR `selectionOrder: [surface, build, slice, triage]` (explicit). Resolution: if the value is a single recognized preset keyword, expand it; otherwise treat it as an explicit pool-name list (validating each name is a known pool, an unknown name FAILS LOUDLY).

`prdsFirst` is SUBSUMED and removed: "slices before PRDs" is just `build` before `slice` in the order; `prdsFirst: true` ⇒ `slice` before `build`. Migrate it out (no alias, no external users yet, same stance as `remove-deprecated-config-aliases`); the `drain` default preserves today's default behaviour (`build` before `slice`).

Gates compose cleanly + ORTHOGONALLY: a pool gated OFF (`observationTriage: off` ⇒ no observation pool; `surfaceBlockers: off` ⇒ no blocked pool; `autoBuild: false` ⇒ no slice pool; `autoSlice: false` ⇒ no SPEC pool) is simply absent from enumeration, so it drops out of the order regardless of its rank. `selectionOrder` ranks what is PRESENT; the gates decide what is present. A pool named in the order but gated off is a no-op, not an error.

## Acceptance criteria

- [ ] `selectionOrder` is a `Config` field threading the full gate-family chain (`config.ts` default, `repo-config.ts` `REPO_ALLOWED_KEYS`, `env-config.ts` `KEY_COERCIONS` via the existing `'list'` coercion so `DORFL_SELECTION_ORDER=build,slice,surface,triage` works, and a CLI flag), resolving `flag > env > per-repo > global > default`.
- [ ] PRESET-OR-LIST resolution (pure, unit-tested as a table): a single recognized keyword (`drain`/`groom`) expands to its list; anything else is parsed as an explicit pool-name list; an unknown pool name or unknown single keyword FAILS LOUDLY naming the offending value. (For the env `'list'` form, a single-element list whose one element is a preset keyword also expands, decide + test that case.)
- [ ] `apply` is ALWAYS first and is NOT nameable in `selectionOrder` (naming it is ignored or a usage error, decide + test). `selectPrioritised` prepends the apply pool ahead of the configured four.
- [ ] `selectPrioritised` orders the (up to) five pools per the resolved order + `apply`-first, then truncates to `count` (the existing count semantics unchanged). Tested: each preset produces its documented order; an explicit list is honoured; `count` truncation respects the order.
- [ ] `prdsFirst` is REMOVED (field, `REPO_ALLOWED_KEYS`, env coercion, any CLI flag, the `selectPrioritised` param); the `drain` default reproduces today's slices-before-PRDs behaviour, and `selectionOrder: [slice, build, ...]` reproduces the old `prdsFirst: true`. No alias (no external users). A test asserts the `drain` default == today's default ordering for the two original pools.
- [ ] A pool gated OFF is absent from the order (no error); a test asserts `observationTriage: off` + `selectionOrder` naming `triage` simply yields no triage items.
- [ ] Tests in the repo's vitest style; no shared/global location written outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-autopick-lifecycle-pools`: it introduces the observation + needsAnswers-blocked pools (and the four-pool `selectPrioritised` shape) that this order ranks. Without it there are only two pools and only `prdsFirst` to subsume. (That slice should leave a SIMPLE interim order; this slice generalizes it to the configurable field. If they land together, fold this in.)

## Decisions (to record while building)

- The exact preset SET (`drain`, `groom`, and whether a third like `balanced` earns its place, default NO, keep it small per the minimize-head-space stance).
- Whether naming `apply` in `selectionOrder` is silently ignored vs a usage error (lean: usage error, it signals a misunderstanding).
- The env single-element-list-that-is-a-preset case (`DORFL_SELECTION_ORDER=drain` ⇒ a one-element list `['drain']` ⇒ expand the preset). Confirm the `'list'` coercion + the resolver compose correctly.
- Interaction with `count` across five pools + apply-first (apply items first, then the ordered remainder, truncated): confirm this reads sensibly for `-n` and matches the create-vs-consume intent.

## Prompt

> Make the advance selection ORDER configurable across the action pools, generalizing the `prdsFirst` boolean once auto-pick has more than two pools. Source: design 2026-06-12; ADR `docs/adr/ci-config-policy-and-gate-family.md` (selection-order section). `blockedBy` `advance-autopick-lifecycle-pools` (it adds the observation + needsAnswers-blocked pools).
>
> FIRST, drift-check: confirm `advance-autopick-lifecycle-pools` landed (the four-pool `selectPrioritised`). Today `select-priority.ts` `selectPrioritised` orders two pools via `prdsFirst` (slices-first default); confirm that shape + that `prdsFirst` is a `Config` field threaded through repo-config/env. If different, reconcile or route to `needs-attention/`.
>
> DESIGN (settled):
>   - `apply` is PINNED FIRST, NOT configurable (consume-always-wins; a human is waiting on their answer). `selectionOrder` ranks only `build`/`slice`/`surface`/`triage`.
>   - `selectionOrder` accepts a PRESET STRING or an explicit pool-name LIST (preset = sugar over a list). Canonical form: ordered list of pool names. `drain` (default) ⇒ `[build, slice, surface, triage]`; `groom` ⇒ `[surface, triage, build, slice]`. An explicit list is verbatim. Single recognized keyword expands; else parse as a list; unknown name/keyword FAILS LOUDLY.
>   - REMOVE `prdsFirst` (no alias, no external users); `drain` reproduces its default, `[slice, build, ...]` reproduces `prdsFirst: true`.
>   - Gates compose ORTHOGONALLY: a gated-off pool is absent from enumeration, so it drops out of the order (a no-op, not an error). `selectionOrder` ranks what is PRESENT.
>
> BUILD: the `Config` field + full chain (REPO_ALLOWED_KEYS, the existing `'list'` env coercion so `DORFL_SELECTION_ORDER` works, a CLI flag); the pure preset-or-list resolver (unit-tested as a table); `selectPrioritised` applying apply-first + the resolved order + `count`; remove `prdsFirst` everywhere.
>
> TEST (TDD, vitest, house style): the resolver table (preset expansion, explicit list, unknown-name loud failure, the env single-keyword case); each preset's order; apply-always-first; `count` truncation respects order; a gated-off pool drops out without error; the `drain` default == today's two-pool default. Isolate shared/global locations.
>
> "Done" = `selectionOrder` resolves (preset or list) through the full chain, `apply` is pinned first, the five pools order per config, `prdsFirst` is gone with the default preserved, gated-off pools drop out cleanly, and the gate is green.
