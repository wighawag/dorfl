---
title: CI config policy reuses the existing per-action gate family (no autoAdvance gate); CI-vs-laptop divergence is the workflow env block
status: accepted
created: 2026-06-12
decided: 2026-06-12
supersedes:
superseded_by:
---

# ADR: CI config policy and the per-action gate family

## Context

`runner-in-ci` (`work/prd/runner-in-ci.md`) makes CI run the autonomous rungs
headless. The question arose: should CI get a new "enable advanced features"
config gate, something like `autoAdvance`, paralleling `autoBuild` / `autoSlice`
/ `autoTriage`? We decided NO, and recorded why, because the alternative would
re-introduce exactly the slice-by-slice incoherence the command-surface ADR was
written to remove.

## Decision

**1. No `autoAdvance` gate. The advance lifecycle decomposes fully into the
existing flat per-action gate family.** Each autonomous rung is already gated,
and there is no ungated advance rung left for a new flag to guard:

| rung | gate | with the gate OFF |
| --- | --- | --- |
| build an undeclared slice | `autoBuild` | the rung does not run autonomously |
| slice an undeclared PRD | `autoSlice` | the rung does not run autonomously |
| triage an observation | `autoTriage` | the triage rung STILL runs, but it **surfaces a question** every time instead of auto-dispositioning the obvious cases |
| surface a question / apply a committed answer | (always allowed) | n/a, these never auto-decide a judgement call |

The subtlety on `autoTriage`: it does NOT gate "whether triage happens" but
"whether the no-question cases are decided silently." Off ⇒ every untriaged
observation surfaces a promote/keep/delete question and waits; on ⇒ only the
unambiguous cases are auto-dispositioned (it still never auto-deletes a
non-duplicate or auto-promotes a judgement call). So "auto-advance the lifecycle"
is already expressible as a combination of these three plus the always-on
surface/apply rungs. A fourth `autoAdvance` name would be a redundant alias over a
set already fully covered.

**2. "Enable the advance loop at all" is CAPABILITY SELECTION, not a gate.** The
genuinely advance-specific behaviour (the triage / surface / apply rungs + the
`on: push work/questions/**` answer trigger) is selected by WHETHER `install-ci`
emits the advance-loop workflow, not by a config field. A repo opts in by having
that workflow generated; the three gates above then tune what it does. (Whether a
given CI workflow invokes `do` vs `advance` is a related verb-selection question;
for now CI workflows use `advance` + the gate family, and a finer `do`-vs-`advance`
knob can be considered later if a need appears.)

**3. CI-vs-laptop gate DIVERGENCE is expressed via the workflow ENV block, NOT a
new config axis.** The gates resolve `flag > ENV (AGENT_RUNNER_*) > per-repo >
global > default` (`env-config.ts`). The env layer exists precisely as "the
per-machine source CI has without committing a file." So a repo that wants, say,
"on my laptop I auto-build nothing (I drive it), but in CI auto-build + auto-slice
are on" does NOT need a CI-specific config field: the generated workflow sets

```yaml
env:
  AGENT_RUNNER_AUTO_BUILD: 'true'
  AGENT_RUNNER_AUTO_SLICE: 'true'
  AGENT_RUNNER_AUTO_TRIAGE: 'false'
```

and the committed `.agent-runner.json` keeps the laptop-strict defaults. `install-ci`
writes that env block from the wizard's per-capability answers. The single
"enable advanced/lifecycle CI?" UX, if wanted, is a WIZARD PRESET that expands to
(emit the advance workflow + the answer trigger + the env block), never a new
`Config` field.

## Consequences

- The gate family stays at three coherent members; no redundant fourth name.
- CI policy is fully expressible today: capability selection (which workflow
  `install-ci` emits) + the gate family resolved through the workflow env block +
  the per-capability merge-vs-propose policy (the `runner-in-ci` policy table).
- A future `do`-vs-`advance` per-workflow knob remains open but unbuilt; the
  default is `advance` + the env block.
- Cross-refs: `command-surface-and-journeys.md` (the gate family + the autonomous
  face), `work/prd/runner-in-ci.md` ("Config & gate model in CI"), `config.ts`
  (the `autoBuild`/`autoSlice`/`autoTriage` definitions), `env-config.ts` (the
  `AGENT_RUNNER_*` per-machine layer).
