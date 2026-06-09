---
title: intake per-outcome integration mode resolution (the KNOBS) — granular + aggregates, granular-overrides-aggregate, default propose
slug: intake-per-outcome-integration-modes
prd: issue-intake
blockedBy: [intake-decision-prompt-and-four-outcome-dispatch]
covers: [9]
---

## What to build

`intake` decides the artifact TYPE (slice vs PRD) at RUNTIME, so a single
`--merge`/`--propose` cannot express a type-conditional policy ("merge a PRD but
propose a slice"). This slice adds the **per-outcome integration mode KNOBS** and the
pure resolution logic, threading the resolved mode into `performIntegration`.

**Reuse, don't fork:** the canonical aggregate resolver already exists —
`resolveIntegrationMode({merge, propose})` in `src/complete.ts` returns the mode (or
`undefined`) and THROWS "--merge and --propose are mutually exclusive" on both. The
per-outcome resolver is a SUPERSET of it (it adds the slice/prd TYPE axis +
granular-overrides-aggregate), so COMPOSE/EXTEND that function for the aggregate axis
rather than re-deriving its mutual-exclusion + error message. The granular per-type
resolution + the override rule layer on top.

`intake` owns the KNOBS only — it is gate-free. WHICH knobs CI sets (from gate state +
author-trust) is CI's POLICY, authored in `runner-in-ci` (NOT here).

The flags + resolution (the canonical rule — see the PRD):

- **granular:** `--merge-prd` / `--propose-prd` (apply if the outcome is a PRD);
  `--merge-slice` / `--propose-slice` (apply if a slice).
- **aggregates:** `--merge` = both-merge; `--propose` = both-propose.
- **resolution:** GRANULAR OVERRIDES AGGREGATE (`--merge --propose-slice` ⇒ merge a
  PRD, propose a slice).
- **usage error:** same type + both modes (`--merge-prd --propose-prd`) is a usage
  ERROR.
- **default:** unset ⇒ propose for BOTH (conservative; matches `do`).
- **ask/bounce emit no artifact** ⇒ the flags are no-ops for them.

This is pure logic over the flag set + the runtime-decided artifact type; it sits in
front of the `performIntegration` call the dispatcher already makes (slices 1 + 2).

## Acceptance criteria

- [ ] Pure resolution function: given the flag set + the artifact type
      (`slice`/`prd`), returns the integration mode (`merge`/`propose`). Tested as a
      table:
      - unset ⇒ propose for both types;
      - `--merge` ⇒ merge both; `--propose` ⇒ propose both;
      - granular routes per type (`--merge-prd` merges a PRD, leaves a slice at
        default/aggregate);
      - granular OVERRIDES aggregate (`--merge --propose-slice` ⇒ PRD merge, slice
        propose);
      - same-type-both (`--merge-prd --propose-prd`, or `--merge-slice
        --propose-slice`) ⇒ usage ERROR (clear message).
- [ ] The resolved mode is threaded into `performIntegration` for the emitted
      artifact (assert via the integration harness: `intake <N> --merge-slice` on a
      stubbed `slice` verdict LANDS on `main`; default/`--propose-slice` opens a PR /
      leaves `main` untouched).
- [ ] ask/bounce verdicts ignore the flags (no-op) — no integrate happens regardless
      of the flags.
- [ ] The flags are wired into the `intake` command grammar (`cli.ts`) consistently
      with the rest of agent-runner's flag style.
- [ ] Tests STUB the seam + `gh`; mirror the repo's existing style.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `intake-decision-prompt-and-four-outcome-dispatch` — the full dispatcher must exist
  (both slice and PRD emit paths) for the per-TYPE resolution to route both. Touches
  the same dispatch/integrate call site + the `intake` command grammar, so serialise
  behind it.

## Prompt

> Add `intake`'s PER-OUTCOME integration mode KNOBS + pure resolution, threading the
> resolved mode into `performIntegration`. `intake` decides the artifact TYPE
> (slice/PRD) at runtime, so one `--merge`/`--propose` can't express a
> type-conditional policy — hence per-outcome flags (US #9). `intake` owns the KNOBS
> only; WHICH knobs CI sets is CI's POLICY (`runner-in-ci`), NOT here.
>
> THE CANONICAL RULE (from `work/prd-sliced/issue-intake.md`):
> - granular: `--merge-prd`/`--propose-prd` (if PRD), `--merge-slice`/`--propose-slice`
>   (if slice).
> - aggregates: `--merge` = both-merge, `--propose` = both-propose.
> - GRANULAR OVERRIDES AGGREGATE (`--merge --propose-slice` ⇒ merge PRD, propose
>   slice).
> - same type + both modes (`--merge-prd --propose-prd`) ⇒ usage ERROR.
> - unset ⇒ propose for both (default; matches `do`).
> - ask/bounce emit nothing ⇒ flags are no-ops.
>
> WHAT TO BUILD:
> 1. A PURE resolution function over the flag set + the runtime artifact type →
>    integration mode (`merge`/`propose`), with the override + usage-error rules
>    above. This is the unit-test target (a resolution table). COMPOSE/EXTEND the
>    EXISTING `resolveIntegrationMode` (`src/complete.ts`) for the aggregate
>    `--merge`/`--propose` axis (reuse its mutual-exclusion + error message); layer
>    the per-TYPE granular resolution + granular-overrides-aggregate on top — do NOT
>    fork a second mode resolver.
> 2. Flag wiring in the `intake` command grammar (`src/cli.ts`) for the four granular
>    + two aggregate flags, consistent with agent-runner's flag style.
> 3. Thread the resolved mode into the dispatcher's existing `performIntegration`
>    call (slices 1 + 2 already integrate at default propose — replace the hardcoded
>    default with the resolved mode).
>
> SEAM TO TEST AT: the PURE resolution function (the table above) + the throwaway-git
> integration harness for one end-to-end check (`--merge-slice` lands on `main`;
> default/`--propose-slice` opens a PR / no `main` touch). STUB `gh` via the injectable
> `ghBin` (the `GitHubProvider` test seam), as the PR-provider tests do.
>
> SCOPE FENCE: build ONLY the KNOBS + resolution. Do NOT build the POLICY that decides
> which knobs to pass (author-trust / gate-state-derived merge-vs-propose) — that is
> `runner-in-ci`. Do NOT touch the decision prompt, the lock, event-classification, or
> the "PRD complete?" query. Do NOT add CI/install.
>
> FIRST run the drift check: confirm the dispatcher (from
> `intake-decision-prompt-and-four-outcome-dispatch`) integrates both the slice and
> PRD emits via `performIntegration` at a default propose. If it landed differently,
> reconcile (replace the default with the resolved mode at the real call site); if a
> premise is broken, route to `needs-attention/` with the discrepancy.
>
> "Done" = the per-outcome modes resolve per the table (granular-overrides-aggregate,
> same-type-both errors, unset⇒propose), the resolved mode reaches
> `performIntegration`, ask/bounce ignore the flags, and
> `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.
