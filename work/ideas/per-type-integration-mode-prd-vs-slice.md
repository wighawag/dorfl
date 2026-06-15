---
title: standing PER-TYPE integration mode (e.g. PRD ⇒ merge, slice ⇒ propose) as repo config — promote intake's per-outcome merge/propose split into a policy the auto-slice/auto-build path also honours, so existing PRDs can be sliced straight to main while their slices land as reviewable PRs
slug: per-type-integration-mode-prd-vs-slice
type: idea
status: incubating
---

# per-type integration mode: slice a PRD straight to main, but PR its slices

> Captured 2026-06-15 from the same `install-ci` dogfooding conversation. NOT built. Motivated by a concrete need on THIS repo: existing PRDs in `work/prd/` the maintainer would rather auto-slice DIRECTLY to main (the PRD is already trusted/human), while the resulting slices land as reviewable PRs (and, later, their builds as PR-or-merge as needed). Related to `intake-prd-provenance-defers-checkpoint-to-slices` (which needs the same primitive) and depends conceptually on `remove-automerge-merge-means-auto-on-gate-pass` settling what `merge`/`propose` mean.

## The gap

`integration` (`propose` | `merge`) is a SINGLE repo-wide value today. It cannot say "merge PRDs, propose slices." The per-TYPE split DOES exist — but ONLY as `intake`'s per-outcome FLAGS (`--merge-prd` / `--propose-prd` / `--merge-slice` / `--propose-slice`), decided at runtime per issue at the issue-intake front door. It is NOT available as a standing repo policy that the AUTO-SLICE / AUTO-BUILD path honours.

So the maintainer cannot express, as config: "when `autoSlice` slices a ready PRD, land the slicing transition on main directly (the PRD is trusted), but cut the emitted slices as `propose` so a human reviews each before `autoBuild` builds it."

## Why it would be nice

- **The checkpoint lands where the risk is.** A PRD on main is low-risk if a human wrote it; slicing it is mechanical. The risk is the SLICES becoming built code. Per-type integration lets the PRD→slices transition be frictionless (merge) while the slice→backlog (and slice→build) transition keeps the human PR checkpoint.
- **It matches the existing intake mental model.** Intake ALREADY reasons per-outcome (PRD vs slice get different modes). Promoting that to standing config makes the auto-slice/auto-build path consistent with the front door, instead of two different mechanisms for the same decision.
- **It unblocks the provenance idea.** `intake-prd-provenance-defers-checkpoint-to-slices` needs exactly "merge the inert PRD, propose its slices" — per-type integration is the primitive that expresses it.

## Open design questions (resolve at PRD/`to-slices` time — this is why it is an idea, not a slice)

- **Config shape.** Does `integration` accept either a string OR an object: `"propose" | "merge" | { prd: "merge", slice: "propose" }`? Or new sibling keys `prdIntegration` / `sliceIntegration` (build-output integration)? The object form keeps one key but complicates the type; the sibling-keys form is flatter but multiplies keys.
- **What are the "types"?** At least PRD-slicing-output vs slice-build-output. Is there a third (intake output) or does intake keep its own per-outcome flags and just DEFAULT from this config? Reconcile with intake's existing `--merge-prd`/`--propose-slice` so there is ONE model, not two.
- **Resolution precedence.** How does a per-type config compose with the existing precedence (`flag > env > per-repo > global > default`)? A `--propose`/`--merge` flag is type-agnostic — does it override BOTH types, or is there a per-type flag too? Env-var shape (`AGENT_RUNNER_PRD_INTEGRATION`?).
- **Where it is read.** `slicing.ts` (the PRD→slices transition's integration mode) and `do.ts`/`integration-core.ts` (the slice build-output integration mode) must read the type-appropriate value. Confirm the slicing transition's integration is separable from the built-slice integration.
- **Interaction with `remove-automerge-merge-means-auto-on-gate-pass`.** That slice settles that `merge` = auto-land, `propose` = human-merge. Per-type integration is cleaner ON TOP of that resolution (no `autoMerge` to also vary per type). Likely sequence AFTER it.
- **Default.** The default stays the single repo-wide value (back-compat); per-type is opt-in.

## Sketch (placeholder, not a decision)

```jsonc
// .agent-runner.json
"integration": { "prd": "merge", "slice": "propose" }
// or
"integration": "propose",        // type-agnostic default
"prdSlicingIntegration": "merge"  // override just the PRD→slices transition
```

Either is plausible; picking one is the first PRD/`to-slices` decision.
