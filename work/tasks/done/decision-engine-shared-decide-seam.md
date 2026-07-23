---
title: 'Shared decision engine — decide(input, allowedOutcomes) → verdict'
slug: decision-engine-shared-decide-seam
spec: agentic-question-resolution-retire-disposition-vocabulary
blockedBy: []
covers: [9]
---

## What to build

Introduce the GENERALISED decision-engine core the question-resolution feature is
built on: a single `decide(input, allowedOutcomes) → verdict` function,
parameterised by an INPUT-ADAPTER and an ALLOWED-OUTCOME SET, mirroring the
`prompt → verdict → dispatch` shape intake already has.

A thin vertical slice through every layer:

- **Verdict shape.** A SUPERSET verdict union `{task | spec | adr | delete | ask}`
  carrying the drafted content for the chosen outcome (the analogue of intake's
  verdict object). Each caller passes its allowed SUBSET; the engine is
  outcome-AGNOSTIC (it never hard-codes which outcomes a caller permits).
- **Stubbable decider seam.** The decision step is an INJECTED seam exactly like
  intake's `IntakeDecider`: production wires a harness/agent, tests inject a CANNED
  verdict (no model, no network). The engine VALIDATES that a returned verdict is
  within the caller's `allowedOutcomes` and rejects (loudly) one that is not.
- **No wiring yet.** This task ONLY lands the pure engine + its types + its tests.
  It does NOT modify the apply rung, the sidecar, or intake. The keystone
  apply task consumes it next; intake stays on its own `{task | spec | ask | bounce}`
  set and is NOT refactored here (decision 13: extract only where natural).

Keep it a NEW module so it is file-orthogonal to the hot files (`sidecar.ts`,
`apply-persist.ts`) the sibling tasks edit.

## Acceptance criteria

- [ ] A `decide(input, allowedOutcomes) → verdict` core exists with the superset
      verdict union `{task | spec | adr | delete | ask}`, parameterised by an
      input-adapter and an allowed-outcome set.
- [ ] The decider is an INJECTED seam (tests drive it with a canned verdict, no
      model/network), mirroring intake's stubbable dispatcher.
- [ ] An allowed-outcome guard: a verdict outside the caller's `allowedOutcomes`
      is rejected loudly; a caller that does NOT allow `adr` can never receive it.
- [ ] No behaviour change to intake (its verdict set is untouched); no edit to
      `sidecar.ts` / `apply-persist.ts` in this task.
- [ ] Tests cover one stubbed verdict PER outcome plus the allowed-outcome
      rejection, in the repo's existing test style (prior art: intake's
      stubbed-verdict dispatcher tests).

## Blocked by

- None — can start immediately.

## Prompt

> Build the shared decision engine for dorfl's question-resolution feature: a
> `decide(input, allowedOutcomes) → verdict` core parameterised by an
> input-adapter and an allowed-outcome SET. The verdict is the SUPERSET union
> `{task | spec | adr | delete | ask}`; each caller passes its allowed subset and
> the engine stays outcome-AGNOSTIC (it never hard-codes a caller's outcomes).
>
> Domain vocabulary: a "verdict" is what an agent decides to DO with an input
> (mint a task / mint a spec / mint an adr / delete the source / ask a follow-up) —
> the same shape intake already has (`prompt → verdict → dispatch`). The decision
> STEP is a stubbable, injected seam: production wires a harness/agent; tests
> inject a CANNED verdict (no model, no network). Study how `intake` does this —
> the `IntakeDecider` injected seam, the `IntakeVerdict`/`IntakeOutcome` types,
> and `buildIntakeDecisionPrd` — and mirror that pattern. The engine must VALIDATE
> a returned verdict against the caller's `allowedOutcomes` and reject one outside
> the set loudly (never silently coerce).
>
> Scope discipline (decision 13/14 of the source SPEC): do NOT refactor intake
> onto this engine and do NOT change intake's verdict set (`{task|spec|ask|bounce}`
> stays exactly as is). This task lands the pure engine + types + tests ONLY — no
> edits to `sidecar.ts`, `apply-persist.ts`, or `intake.ts`. Keep it in a NEW
> module so it is file-orthogonal to the sibling tasks that edit the hot files.
> The keystone apply task (`agentic-apply-retire-disposition-vocabulary`) consumes
> this engine; intake adopting `adr` is explicitly out of scope (the engine being
> agnostic means it CAN be added later by a separate decision).
>
> "Done": the core + verdict union + injected decider seam + allowed-outcome guard
> exist, with tests covering one stubbed verdict per outcome and the
> allowed-outcome rejection, matching the repo's existing test style. Acceptance:
> `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs,
> and the tasks it depends on? In particular confirm intake's `prompt → verdict →
> dispatch` seam (the injected `IntakeDecider`, the `IntakeVerdict` shape) is still
> the pattern to mirror. If a dependency landed differently than this task assumes,
> do NOT build on the stale premise — route the task to needs-attention with the
> discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building (the verdict
> type's exact shape, how the allowed-outcome guard rejects, where the input-adapter
> boundary sits). If a choice meets the ADR gate (hard to reverse + surprising
> without context + a real trade-off), write the WHY as an ADR in `docs/adr/`;
> otherwise note it briefly in the done record / PR description. An un-recorded
> in-scope decision is a review FINDING, not a silent default.

---

### Claiming this task

```sh
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/<slug>.md work/tasks/done/<slug>.md
```
