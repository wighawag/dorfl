---
title: setup skill scaffolded only the work/ folders it populated — skipped the empty status folders (slicing/prd-sliced/in-progress/needs-attention/done/out-of-scope) despite being instructed to create ALL of them with .gitkeep
date: 2026-06-10
kind: observation
area: skills/setup/SKILL.md (Phase A / A1 / A5 scaffold) vs. observed run output
severity: low
status: open
---

## The signal

A `setup` run on the rocketh repo produced a `work/` skeleton with only the folders it actually wrote items into:

```
work/{prd, backlog, ideas, observations, findings, protocol}/   ← present
work/{slicing, prd-sliced, in-progress, needs-attention, done, out-of-scope}/  ← MISSING
```

But the skill **instructs creating ALL of them** (Phase A "What it scaffolds" / A1 / A5 list the full set: `work/prd/ work/slicing/ work/prd-sliced/ work/backlog/ work/in-progress/ work/needs-attention/ work/done/ work/out-of-scope/ work/ideas/ work/observations/ work/findings/`, each with a `.gitkeep` so git tracks the empty ones). So the run did NOT follow the instruction for the EMPTY folders \u2014 it created a folder only when it had something to put in it.

## Two things tangled here (both worth recording)

1. **The skill did not do what it says.** Whatever the right end-state is, a run that silently creates a subset of an explicitly-enumerated list is a fidelity gap \u2014 the same class as the dotfolder-miss and the cleanup-skip: a step described but not reliably executed. This is a candidate eval invariant ("after setup, the full status-folder set exists" \u2014 OR, if we decide empty folders are not wanted, the inverse).

2. **But maybe the instruction itself is wrong (the maintainer's view, 2026-06-10):** the empty status folders are **not necessary** \u2014 they can be **created on demand** when the first item flows into them (e.g. the runner/`git mv` creates `done/` when it first moves an item there). Pre-creating empty folders with `.gitkeep` is a convention, not a requirement; an absent folder is not a broken contract.

   If that view holds, the FIX is to the SKILL TEXT, not the run: stop instructing the creation of empty status folders + `.gitkeep`s, and instead say folders are created lazily on first use (the consumer \u2014 runner or skill \u2014 makes a folder when it first writes/moves into it). That would also make this run's output CORRECT rather than a bug.

## Open question (for a human to decide)

Which is the intended contract?

- **(A) Eager:** setup creates ALL status folders up front (+ `.gitkeep`). Then this run is a skill-fidelity bug to fix (make the run actually create them), and the eval gets a "full skeleton present" invariant.
- **(B) Lazy:** status folders are created on demand by whoever first writes/moves into them. Then the SKILL TEXT is what's wrong (it over-specifies eager creation) and should be relaxed; this run's partial skeleton is fine.

The maintainer leans (B) ("not necessary, can be created on demand"). Need to confirm that nothing in the runner/lifecycle assumes a folder pre-exists (e.g. does a `git mv` into `work/done/` fail if `done/` is absent? \u2014 git creates the dir on `mv`, so likely fine, but verify), then update the skill text accordingly.

## Provenance

Spotted 2026-06-10 while reviewing the rocketh repo's `setup` output for readiness to test the `intake` command: `ls work/` showed 6 of the 12 contract folders missing, all of them the empty status folders.
