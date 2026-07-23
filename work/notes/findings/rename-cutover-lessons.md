---
title: 'Rename / cutover lessons — surface classes, sub-batch routing, and atomic-symbol scope'
date: 2026-07-12
status: open
---

Lessons collected across the `prd` → `spec` rename cutover and the D6 surface-class
work. Future rename/cutover tasks (namespace-ish renames, alias removals, atomic
symbol renames) should consult this note before scoping their sub-batches.

## Lesson 1 — the three-surface distinction for a namespace-ish rename

When a token like `prd` → `spec` is being renamed across the codebase, three
DIFFERENT surfaces all look identical at a naive `x === 'spec'` (or `x === 'prd'`)
grep, but they belong to different sub-batches and must NOT be edited as one lump.
The distinguishing feature is which UNION the LHS of the comparison is typed as.

### 1. Resolver namespace — the routing surface

- Type: `SlugNamespace`, produced by `resolveSlug` / `resolveAdvanceArg`.
- Load-bearing sites: `do.ts:711`, `do.ts:1893`, `advance.ts sidecarTypeFor`, and
  the rest of the router/dispatch layer.
- Rename policy: **widen these in the routing sub-batch.** The router is the
  entry point that turns a user token into a namespace; if it doesn't recognise
  the new name, nothing downstream ever sees it.

### 2. Selection namespace — the selection layer's OWN union

- Type: `SelectedNamespace` in `select-priority.ts`, typically
  `'task' | 'spec' | 'observation'` — a DISTINCT union from `SlugNamespace`.
- Consumers: `argForSelectedItem`, `argForSelected`, `remoteArgFor`,
  `runSelectedInSequence` — everything that switches on `item.namespace` where
  `item` is a selected item.
- Rename policy: **cannot be widened until the selection union itself migrates.**
  Adding a new branch early is both:
  - a TS2367 no-overlap error under strict (`'foo' === 'newname'` where
    `'newname'` is not in the union type), AND
  - dead code, because the selection layer itself never emits the new value
    until its own producer migrates.
- Heuristic: if the LHS is a `SelectedItem`-shaped `item.namespace`, the edit
  belongs to the selection-layer sub-batch, NOT the routing sub-batch.

### 3. Artifact-type / promote-alias surface

- Type: e.g. `verdict.outcome: DecisionOutcome` in `decision-engine.ts`
  (consumed by `triage-persist.ts` via `artifact === 'spec'`), and the
  locally-typed `PromotableItem` fields in `needs-attention.ts`.
- These are ALIAS surfaces downstream of the artifact-type / promote alias —
  they are NOT resolver-namespace consumers, even though they compare to the
  same string literal.
- Rename policy: **migrate with the alias-removal / contract task.** Touching
  them requires editing the alias source (`decision-engine.ts` / promote
  alias) as well; that is a different sub-batch from routing.

### Checklist heuristic

For every `xxx === 'oldname'` (or `=== 'newname'`) grep hit:

1. Look up the type of `xxx`.
2. Identify which union that type is (`SlugNamespace` /
   `SelectedNamespace` / `DecisionOutcome` / a local `PromotableItem` field /
   something else).
3. Route the edit to whichever sub-batch OWNS that union.

A single grep hit is not a single edit — it is a routing question.

## Lesson 2 — atomic symbol renames authorise editing the defining file

A sub-batch's SYMBOL assignment (e.g. "`renderPrdBody` / `PrdTask` belong to
sub-batch 4c") implicitly authorises editing whichever file DEFINES that symbol,
even if the task's explicit file list only names a sibling (e.g. lists
`spec-complete.ts` but the symbol actually lives in `buildable-body.ts`).

Reasoning: renaming an exported symbol requires editing its definition site or
the build breaks. You cannot split "rename the export" from "rename the
import" across two sub-batches without leaving a broken commit between them.

Therefore:

- The task's file list is an **under-approximation** of its symbol assignment,
  not an over-approximation.
- If a symbol you were told to rename is defined in a file the task didn't
  list, edit the definition file anyway — that is inside scope, not scope
  creep.
- Conversely, do not stop and open a clarification for a needless
  "am I allowed to touch buildable-body.ts?" question when the symbol
  assignment already answers it.

This is INHERENT to atomic renames — no WORK-CONTRACT change is needed —
but recording the lesson prevents future agents from either (a) splitting
the rename across sub-batches and breaking the build, or (b) stalling on a
clarification the symbol assignment already answered.

---

Provenance: promoted from observation `spec-migrate-4c-scope-decisions`
(the answered scope-decision notes taken during the `spec` migration
sub-batch 4c).
