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

The subtlety on `autoTriage` (verified in `advance.ts` `triageRung`): it does NOT
gate "whether triage happens" but "whether the no-question cases are decided
silently." The classifier (`advance-classify.ts`) is gate-free and always picks
`triage-observation` for an untriaged observation; the gate is consulted only
INSIDE the rung. So:

- **OFF (default):** every untriaged observation surfaces a promote/keep/delete
  question and waits. The agent never disposes of a signal autonomously.
- **ON:** the rung first asks the triage gate "is this a no-question case?" An
  exact-duplicate (recommend delete) or unambiguous-map is auto-dispositioned
  WITHOUT a question; everything else (`auto: false`) falls through to surfacing
  the question. It never auto-deletes a non-duplicate or auto-promotes a
  judgement call.

**The counterintuitive consequence (accepted, recorded on purpose):** OFF
produces MORE human questions than ON, because OFF surfaces a question even for
the exact-duplicates that ON would silently clear. `autoTriage` is therefore NOT
"off = quieter"; it trades human questions against autonomous action. OFF
maximises human control (the human decides EVERY observation's fate, so more
questions); ON spends some autonomy to remove the obvious questions. This is
consistent under the reading "the gate governs autonomous DISPOSITION, not whether
the rung runs", but it is admittedly a naming trap (see "Naming" below).

So "auto-advance the lifecycle" is already expressible as a combination of these
three gates plus the always-on surface/apply rungs. A fourth `autoAdvance` name
would be a redundant alias over a set already fully covered.

**Three rest states for observations (the off-switch is the VERB, not a gate).**
Because surface is always-allowed, no `autoTriage` value gives "silent, no
questions". The three actual rest states are:

| want | how | observations are |
| --- | --- | --- |
| agent makes the obvious calls, asks about the rest | `advance`, `autoTriage: on` | auto-disposed (obvious) / questioned (judgement) |
| human decides every observation, agent acts on none | `advance`, `autoTriage: off` | always questioned (noisier) |
| observations are never looked at at all | use **`do`** (not `advance`) | untouched, zero questions |

So the true "no observation triage at all / zero questions" switch is **verb
selection** (`do` has no triage/surface/apply rungs), NOT a setting of
`autoTriage`. This is the `do`-vs-`advance` knob (point 2 below): it doubles as
the lifecycle on/off switch.

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

## Naming (an acknowledged trap)

`autoTriage` READS like "is triage on?" so an outside reader reasonably expects
`autoTriage: off` to mean "no triage happens, so no questions." It does NOT: off
still runs the triage rung and surfaces a question for every observation. The name
describes the AUTO-disposition exception (auto-act on the obvious), not the rung.
This mirrors the earlier `allowAgents -> autoBuild` rename (a gate named for a
master switch but only gating one selection). A clearer name might be
`autoDisposeObservations` / `autoResolveObvious`, but a rename is a deprecation-
window cost (`config-alias.ts`), so it is NOT done here; this ADR records the trap
so the docs/help text can lead with "off = surface a question for everything; it
does not stop triage."

## Open question (NOT decided here)

There is a fourth conceivable rest state the current gates cannot express: "run
`advance` for slices/PRDs, and do NOT pester me with questions about trivial
observations either (leave duplicates for me to find), without auto-acting." Today
that is impossible because surface is ALWAYS allowed by design (so a repo with all
gates off still gets the question loop). Achieving it would need either a new
"suppress no-question-case questions" knob or an "advance over slices/PRDs only,
skip the observation pool" selection filter, both of which cut against the
"surface is always allowed" intent. RECORDED as open; the current escape for
"zero observation noise" is to use `do` (the verb has no triage rung at all).

## Consequences

- The gate family stays at three coherent members; no redundant fourth name.
- CI policy is fully expressible today: capability selection (which workflow
  `install-ci` emits) + the gate family resolved through the workflow env block +
  the per-capability merge-vs-propose policy (the `runner-in-ci` policy table).
- `do`-vs-`advance` is the lifecycle on/off switch: `do` = no observation triage
  / zero questions; `advance` = the full lifecycle, tuned by the gates. A future
  per-workflow knob exposing this is open but unbuilt; the default is `advance`.
- Cross-refs: `command-surface-and-journeys.md` (the gate family + the autonomous
  face), `work/prd/runner-in-ci.md` ("Config & gate model in CI"), `config.ts`
  (the `autoBuild`/`autoSlice`/`autoTriage` definitions), `env-config.ts` (the
  `AGENT_RUNNER_*` per-machine layer).
