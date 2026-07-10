---
title: advance — the pure one-item TICK classifier + the deterministic per-type state machine (two signals only, read-only, no model, no lock)
slug: advance-tick-classifier
spec: advance-loop
blockedBy: [advance-sidecar-contract]
covers: [7, 12, 13, 14, 18, 31]
---

## What to build

The substrate-agnostic **TICK** classifier: given an item (`needsAnswers` + the sidecar's answered-state + the item type), decide the CLASSIFIED rung — purely by file inspection, NO model, NO lock. This is the highest-value, cheapest seam (mirrors `categorise.ts`/`eligibility.ts`) and the contract both drivers later wrap. This slice delivers the classifier + the per-type transition state machine as a PURE function with exhaustive table tests. It does NOT take the lock or execute any rung (those are later slices) — it returns "which rung, on which item", and the two invariants must hold.

### The per-item state machine (the deterministic trigger — two signals only)

```
needsAnswers: true?
├─ NO  → ANALYSE (state-appropriate rung: build a ready slice / slice a ready SPEC /
│        triage an untriaged observation). Analysis MAY advance, OR SURFACE questions.
└─ YES → sidecar exists?
         ├─ NO  → ANALYSE (first pass: generate questions → write the sidecar)
         │        [transitional — surfacing normally writes the sidecar atomically]
         └─ YES → all entries answered?
                  ├─ YES → ANALYSE: apply the answers + advance. May APPEND new Qs
                  │        (→ stays needsAnswers:true, re-pauses) OR resolve fully.
                  └─ NO  → NO-OP (awaiting human).
```

Two invariants the classifier + downstream must preserve:

1. `needsAnswers:false` ⟺ NO active sidecar (clear-flag and delete-sidecar are the SAME atomic step — enforced in `advance-sidecar-contract`, asserted here).
2. A PENDING (not-all-answered) sidecar makes the tick a clean **NO-OP** (so a `run` daemon never spins hot re-surfacing the same question).

"ANALYSE" ≠ "always advance" — surface-and-pause is itself a rung. A SUBSET of answered entries → SKIP (NO-OP). Append, never overwrite.

### What the classifier returns (the rung kinds — execution comes later)

A discriminated union naming the classified rung WITHOUT executing it:

- `build-slice` (ready slice) / `slice-spec` (ready SPEC) / `triage-observation` (untriaged observation) — the ANALYSE rungs;
- `surface` (first-pass question generation when `needsAnswers` but no sidecar) — transitional;
- `apply` (all answered → apply + advance);
- `no-op` (pending sidecar, or nothing eligible).

The state machine is per-item-TYPE (slice / SPEC / observation) — encode the per-type transition table from the SPEC's "Per-item-type transitions" section as the source of the cells, but the EXECUTION of each cell is a later slice; this slice asserts the CLASSIFICATION of each cell.

## Acceptance criteria

- [ ] A pure `classifyTick(item)` returns the classified rung from EXACTLY two signals (`needsAnswers` + sidecar answered-state) plus the item type — no model, no lock, no file mutation (read-only).
- [ ] Table tests drive every cell of the per-type (slice / SPEC / observation) transition tables: surface / pending-NO-OP / subset-SKIP / all-answered → apply / append-re-pause / clear+delete / terminal-cleanup.
- [ ] The two invariants are asserted: `needsAnswers:false ⟺ no active sidecar`, and a pending sidecar ⇒ NO-OP.
- [ ] A pending-sidecar pool classifies as STABLE/NO-OP (no thrash) and the candidate pool shrinks monotonically as answers arrive (convergence test, at the classifier level — read-only).
- [ ] Tests mirror the existing `categorise.ts`/`eligibility.ts` pure-function table-test style; no shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-sidecar-contract` — the classifier reads the sidecar's answered-state, so the sidecar model must exist first.

## Prompt

> Build the pure `advance` TICK classifier + the deterministic per-type state machine. Read the SPEC `advance-loop` (in `work/spec-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/spec/`) ("The advance TICK", "The per-item state machine — two signals only", "Per-item-type transitions"). The classifier is `classify (cheap, read-only, NO model, no lock)` — it returns WHICH rung on WHICH item; it does NOT take the lock or execute (later slices). Mirror the existing pure-function seams `categorise.ts` and `eligibility.ts` (same test style).
>
> Two signals only: the `needsAnswers` flag + the sidecar's answered-state (from `advance-sidecar-contract`). Two invariants: (1) `needsAnswers:false ⟺ no active sidecar`; (2) a pending (not-all-answered) sidecar ⇒ clean NO-OP (a `run` daemon must never spin hot). A subset of answered entries → SKIP. The state machine is per-item-TYPE (slice / SPEC / observation); encode the transition-table CELLS, but only CLASSIFY them here — execution is later.
>
> READ FIRST: `packages/dorfl/src/categorise.ts` and `packages/dorfl/src/eligibility.ts` (the pure classify + table-test pattern to mirror); the sidecar model from `advance-sidecar-contract` (its `allAnswered`/`pendingEntries`); `packages/dorfl/src/frontmatter.ts` (reading `needsAnswers`).
>
> FIRST, check this slice against current reality (drift). If `advance-sidecar-contract` landed with a different model shape than assumed, reconcile (or route to `needs-attention/`) rather than building on a stale premise.
>
> TDD with vitest. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

---

### Claiming this slice

```sh
dorfl claim advance-tick-classifier --arbiter origin
git fetch origin && git switch -c work/advance-tick-classifier origin/main
git mv work/in-progress/advance-tick-classifier.md work/done/advance-tick-classifier.md
```
