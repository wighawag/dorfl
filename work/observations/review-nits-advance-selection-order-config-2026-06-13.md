---
title: review-gate non-blocking nits for 'advance-selection-order-config' (Gate 2 approve)
date: 2026-06-13
status: open
slug: advance-selection-order-config
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-selection-order-config' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: naming `apply` in selectionOrder is a LOUD usage error (throws), not silently ignored. The slice left this open and leaned toward usage-error; the build chose usage-error. Confirm this is the wanted behaviour.
  (select-order.ts throws `'apply' is pinned FIRST and is not orderable` when `apply` appears in an explicit list. Slice '## Decisions' bullet 2.)
- Ratify: the preset SET is kept to exactly {drain, groom}; no third preset (e.g. balanced) was added. Confirm small-set stance.
  (SELECTION_ORDER_PRESETS = {drain, groom} only, per the minimize-head-space stance. Slice '## Decisions' bullet 1.)
- Ratify: the env single-element-list-that-is-a-preset case (`AGENT_RUNNER_SELECTION_ORDER=drain` ⇒ `['drain']` ⇒ resolver expands the lone preset). Confirm the `'list'` coercion + resolver compose as intended.
  (env-config yields `['drain']`; resolveSelectionOrder expands a single-token list whose token is a preset. Tested at both layers. Slice '## Decisions' bullet 3.)
- Ratify: a partial explicit list (e.g. `[build, slice]`) is honoured verbatim with NO padding of the omitted pools. If `surface`/`triage` pools ARE present in an advance tick, an omitted pool's items would never be selected. Confirm this verbatim/no-pad semantics is the intended user contract (vs. appending omitted pools at the end).
  (resolveSelectionOrder takes the list verbatim and `selectPrioritised` only iterates the named order, so a present-but-unnamed pool contributes nothing. Documented as deliberate ('no implicit padding') in select-order.ts; tested as `['build','slice'] ⇒ ['build','slice']`. Harmless for `do` (only two pools) but load-bearing for `advance` if a user writes a partial list.)
