---
title: advance — the MIRROR-SIDE eligible-pool scan: enumerate eligible slices + sliceable PRDs from the BARE hub mirror's main (the isolated counterpart to do-autopick's in-place scan) — ONE reusable unit
slug: mirror-side-eligible-pool-scan
spec: advance-loop
blockedBy: []
covers: [25, 27]
---

> Folds in the DEFERRED part (b) of `work/observations/do-remote-no-arg-and-remote-autopick-for-isolated-conductor.md` (the mirror-side auto-pick), designed ONCE here so BOTH the `run` loop driver and the one-shot/CI `advance` driver consume the SAME scan (the PRD's explicit instruction). A standalone `do --remote -n` then falls out as a thin caller — do NOT let the scan be invented twice. File-orthogonal to the advance engine (a new enumeration module).

## What to build

A MIRROR-SIDE eligible-pool scan: enumerate eligible slices + sliceable PRDs from the BARE hub mirror's `main` (NOT an in-place checkout) — the isolated counterpart to `do-autopick`'s in-place pool scan. Deliver it as ONE reusable unit that BOTH the `run` loop driver and the one-shot/CI `advance` driver (the `advance-drivers- and-gates` slice) consume, so the `-n`/auto-pick rungs (both `do` and `advance`, both `run`-loop and one-shot) all call the SAME enumeration.

### Precise scope

- A scan that, given a BARE hub mirror, enumerates from its `main`: eligible slices (the `do-autopick`/`eligibility` predicate — not `needsAnswers`, not `humanOnly`, `blockedBy` satisfied, `allowAgents`) AND sliceable PRDs (the slicing-eligibility predicate — `sliceAfter` satisfied against `prd-sliced/`, not `humanOnly`/ `needsAnswers`, `autoSlice`). It MIRRORS `do-autopick`'s in-place scan but reads the BARE mirror, not a working checkout.
- It is the SHARED substrate the `-n`/auto-pick selection consumes: `run`'s isolated+parallel auto-pick AND the one-shot/CI `advance --remote -n` / the CI matrix BOTH call it (the drivers slice wires the callers).
- Replaces the existing inline `-n`×`--remote` REFUSAL placeholder in `cli.ts` — that refusal was an un-surfaced decision (now caught by the `agent-stop` Decisions channel); this scan is what it was a placeholder for. (Removing the refusal is the drivers/`do --remote -n` caller's job; this slice provides the scan it needs.)
- `-n` stays ALWAYS SEQUENTIAL (US #25) — this scan only ENUMERATES the pool; parallelism is `run` or the CI matrix, never a property of `-n`.

## Acceptance criteria

- [ ] A mirror-side scan enumerates eligible slices + sliceable PRDs from a BARE hub mirror's `main` (NOT a working checkout), using the SAME eligibility + slicing-eligibility predicates as the in-place `do-autopick` scan.
- [ ] It is ONE reusable unit (a single module/function) designed so both the `run` loop driver and the one-shot/CI `advance` driver consume it — proven by being called from a test harness with both shapes (no duplicated enumeration logic).
- [ ] The eligibility predicate matches in-place exactly (not `needsAnswers`, not `humanOnly`, `blockedBy`/`sliceAfter` satisfied against the right folders, `allowAgents`/`autoSlice`) — asserted against the existing predicate.
- [ ] Tests: a bare-mirror fixture with a mix of eligible/blocked/needsAnswers/ humanOnly slices + sliceable/non-sliceable PRDs → the scan returns exactly the eligible set; parity with the in-place scan on the same logical state. House throwaway-repo + `--bare` mirror style; no shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — a new enumeration module reading the bare mirror; file-orthogonal to the advance engine. The DRIVERS slice (`advance-drivers-and-gates`) and a thin `do --remote -n` caller consume it later.

## Prompt

> Build the MIRROR-SIDE eligible-pool scan: enumerate eligible slices + sliceable PRDs from a BARE hub mirror's `main` (NOT an in-place checkout) — the isolated counterpart to `do-autopick`'s in-place scan. Read the PRD `advance-loop` (in `work/spec-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/prd/`) (the "FOLD-IN: the mirror-side pool scan" note — design it ONCE so BOTH the `run` loop driver and the one-shot/CI `advance` driver consume the SAME scan; a standalone `do --remote -n` falls out as a thin caller; do NOT invent it twice) and US #25/27. `-n` stays ALWAYS SEQUENTIAL — this scan only ENUMERATES; parallelism is `run` or the CI matrix.
>
> Mirror the in-place pool scan but read the BARE mirror. READ FIRST: `packages/dorfl/src/do-autopick.ts` (the in-place pool scan to mirror), `packages/dorfl/src/eligibility.ts` + `slicing-eligibility.ts` (the predicates to REUSE — not re-derive), `packages/dorfl/src/repo-mirror.ts` (the bare hub mirror), and the existing inline `-n`×`--remote` REFUSAL in `cli.ts` (the placeholder this scan replaces — but REMOVING the refusal is the caller/drivers' job, not this slice).
>
> FIRST, check this slice against current reality (drift). `do-autopick`, the mirror, and the eligibility predicates are LANDED substrate. If they landed differently, reconcile or route to `needs-attention/`.
>
> TDD with vitest, house `--bare`-mirror style. "Done" = the scan exists as ONE reusable unit per the acceptance criteria and the gate is green.

---

### Claiming this slice

```sh
dorfl claim mirror-side-eligible-pool-scan --arbiter origin
git fetch origin && git switch -c work/mirror-side-eligible-pool-scan origin/main
git mv work/in-progress/mirror-side-eligible-pool-scan.md work/done/mirror-side-eligible-pool-scan.md
```
