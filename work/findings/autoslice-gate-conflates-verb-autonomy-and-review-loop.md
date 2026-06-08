---
title: the auto-slice gate conflates THREE separate concerns — the VERB (do prd: = slice), the AUTONOMY policy (may an unsupervised agent PICK a PRD to slice), and the REVIEW→EDIT loop (a quality pass) — corrected model from a 2026-06-08 grilling
date: 2026-06-08
status: open
---

# `do prd:` slicing: one gate is doing three different jobs

A maintainer grilling pass (2026-06-08, prompted by "why is enabling auto-slice an
ENV VAR? is there an arg? and `do prd:<slug>` is OBVIOUSLY an auto-slice — that's
what the command DOES") surfaced that the current `autoSlice` gate **conflates three
concerns that should be independent.** This finding records the corrected model to
pin down BEFORE slicing it (it reconciles code + two PRDs + the ADR; slicing without
the written reconciliation would re-introduce the same muddle). It extends the
adjacent finding `work/findings/review-gate-vs-slicer-edit-loop.md` (the review-loop
half) with the new VERB-vs-AUTONOMY axis.

## What the code does today (verified 2026-06-08)

- `do prd:<slug>` ALWAYS runs with `doer: 'agent'` — the CLI has NO way to pass
  `doer: 'human'` (`grep doer` in `cli.ts` → nothing). The `doer: 'human'` path
  EXISTS in `src/slicing.ts` (skips the gate, the lock, AND the review loop) but is
  DEAD from the CLI.
- The `doer === 'agent'` path gates THREE things together:
  1. **Refuses to slice** unless `needsAnswers !== true && humanOnly !== true &&
     autoSlice && sliceAfter-satisfied` (`resolveAgentGate`, `slicing.ts:515`).
  2. Takes the CAS slicing **lock**.
  3. Runs the **review→edit→converge loop** (`slicing.ts:288`, fenced behind
     `doer === 'agent'`; wired unconditionally for `do prd:` at `cli.ts:1373`).
- `autoSlice` resolves `flag > AGENT_RUNNER_AUTO_SLICE env > per-repo > global >
  default false` — but **the `--auto-slice` FLAG layer was never registered** (no
  CLI option; the `autoslice-gate` review-nit already noted this). So today a human
  can only enable it via env or a committed config file — which is why the Q-D
  test-drive had to use `AGENT_RUNNER_AUTO_SLICE=1`.

## The conflation (the bug)

The gate gates the **VERB** (the act of slicing) even when a human EXPLICITLY typed
`do prd:<named-slug>`. But the gate's ORIGINAL purpose (auto-slice PRD, lines 34-36:
"human-first by default... an agent only auto-slices when the repo opts in") was to
gate the **AUTONOMOUS SELECTION** — `run`/`do`'s auto-pick drawing a PRD NOBODY NAMED
into the work pool. Gating the explicit, named invocation is wrong: **naming the PRD
IS the request.** Refusing "please slice foo" because a policy flag is off is absurd.

The review→edit loop is ALSO mis-coupled: it is fenced behind `doer === 'agent'`,
implying it is an autonomy concern — but it is an ORTHOGONAL QUALITY pass that has
nothing to do with WHO asked or WHETHER selection was autonomous.

## The corrected model (THREE independent concerns)

> **Key constraint (the maintainer's decisive point): the runner CANNOT distinguish
> a human from an agent at the `do prd:` call site** — both are "someone invoked the
> command". So consent / override can NEVER be inferred from WHO; it can only come
> from an EXPLICIT SIGNAL in the invocation (naming the PRD, or a loud flag).

| concern | gate | named `do prd:<slug>` | autonomous pick / `run` tick / CI-workflow generation |
|---|---|---|---|
| **AUTONOMY** — may an UNSUPERVISED agent PICK a PRD nobody named? | `autoSlice` (config/env; the autonomous-path policy) | **NOT checked** — naming the PRD is consent | **checked** |
| **CORRECTNESS** — `humanOnly` / `needsAnswers` / `sliceAfter`-unsatisfied (PRD-intrinsic "this would produce bad slices / is a judgement call") | PRD frontmatter | **checked, but OVERRIDABLE by an explicit loud flag** (`--force` / `--ignore-not-ready`, the existing precedent) — because we can't tell human from agent, the flag is the only "yes I really mean it" signal | checked (an autonomous picker NEVER overrides) |
| **QUALITY** — the review→edit→converge loop over the produced slices | `--review` / `--no-review` | **ON by default, SAME for human and agent** | on by default |

### Concern 1 — AUTONOMY (`autoSlice`): keep the name, FIX the meaning + check-site
- **KEEP the name `autoSlice`** (maintainer decision B) — it sits symmetrically
  beside **`autoBuild`** (currently `allowAgents`; the autonomous pick-a-SLICE-to-
  build gate, rename already planned in `work/prd/advance-loop.md` US #36). The name
  "auto-slice" is CORRECT for "autonomously pick-and-slice"; it was only ever WRONG
  because it was checked on the explicit VERB. No byte churn to config/env keys.
- **MOVE the check** from `performSlicing`'s agent path to the AUTO-PICK / selection
  step (the helper that decides whether a PRD enters the unsupervised pool — sibling
  to `do-autopick`'s pool scan). The explicit named `do prd:<slug>` path stops
  consulting `autoSlice` entirely.
- The config/env layers STAY — they are exactly for the autonomous paths: `do`
  auto-pick (bare / `-n`), `run`'s tick, and what an **`install-ci` workflow
  generator** consults to decide whether to EMIT PRD-slicing steps. (CI itself, once
  generated, drives slicing by NAMING the PRD — `do prd:<slug>`, explicit, never
  bare — so the running CI job is on the consent path, not the gate.)

### Concern 2 — CORRECTNESS (PRD-intrinsic refusals): stay on the named path, loud-overridable
- `humanOnly`, `needsAnswers`, `sliceAfter`-unsatisfied are NOT autonomy policy —
  they are "slicing this now produces wrong/half-baked slices" or "a human must
  judge this". They MUST still fire on the explicit named path (maintainer decision
  A: **even `humanOnly` blocks the named path** — because there's no way to tell a
  human invoker from an agent invoker, so the frontmatter intent must hold unless
  explicitly overridden).
- **Overridable by a loud explicit flag** — reuse the EXISTING `--ignore-not-ready`
  precedent (`cli.ts:738`: "override the readiness guard... silence the needsAnswers
  warning (loud, never default)"), extended to cover the slicing-path refusals
  (incl. `humanOnly`). The flag is the explicit "yes, I — whoever I am — really mean
  it" signal the call-site otherwise can't carry. An autonomous picker NEVER passes
  it.

### Concern 3 — QUALITY (review→edit loop): orthogonal, default-on, doer-agnostic
- **Remove the `doer === 'agent'` fence** (`slicing.ts:288`) — the loop runs the
  SAME regardless of who invoked. (Maintainer decision B/Q2: be consistent with the
  build path.)
- **ON by default with a `--no-review`-family disable** — consistent with the build
  path's `--review` / `--no-review` (Gate 2). Rationale: auto-slicing has NO `verify`
  floor, so the review→edit loop is the ONLY quality gate — losing it silently
  commits unreviewed slices. So default-on, explicit flag to disable.
- This aligns with `work/findings/review-gate-vs-slicer-edit-loop.md` concept #3
  (the loop is its own thing, distinct from the one-shot gate and the orphaned
  `maxRounds`).

## Consistency check (why this is RIGHT, not just different)

It makes slicing mirror the BUILD path exactly:
- `do <slug>` (named) BUILDS unconditionally; `allowAgents`/`autoBuild` gates only
  AUTONOMOUS build-selection; `--review`/`--no-review` controls Gate 2 for all.
- `do prd:<slug>` (named) SLICES unconditionally (mod correctness guards);
  `autoSlice` gates only AUTONOMOUS slice-selection; `--review`/`--no-review`
  controls the review loop for all.

Same three-layer shape (verb / autonomy-selection / quality), same names, same
override precedent.

## What this reconciles (the spread that must move together)

- **CODE:** move the `autoSlice` check from `performSlicing` (verb) to the auto-pick
  selection step; drop it from the named `do prd:` path; keep `humanOnly`/
  `needsAnswers`/`sliceAfter` as named-path correctness guards with an
  `--ignore-not-ready`-style loud override (now also covering `humanOnly`); unfence
  the review loop from `doer === 'agent'` and give it `--review`/`--no-review`
  (default on). (The dead `doer: 'human'` branch in `slicing.ts` likely collapses —
  there is no longer a human/agent distinction at this seam.)
- **`work/prd/auto-slice.md`** (sliced, mostly done): its "Autonomy gate (the two
  axes, at the PRD level)" section describes the OLD conflation (gate fires on the
  verb). Update its framing to the three-concern model (autonomy = selection only).
- **`work/prd/advance-loop.md`** per-action gate table: keeps `autoSlice` (good) but
  should note it gates SELECTION (the advance tick's "pick a ready PRD" rung), not
  the `do prd:` verb — already consistent with the tick design; just make the
  scoping explicit so the slicer doesn't re-encode the verb-gate.
- **`docs/adr/command-surface-and-journeys.md`:** the slicing-gate framing (and the
  `autoslice-confidence` slice, still in backlog?) should reflect verb-vs-selection.
  Maintainer-owned ADR edit.

## Open micro-questions for the eventual slice

- The exact flag name for the correctness override on the slicing path: reuse
  `--ignore-not-ready` verbatim (it already exists + reads right), or a slicing-
  specific `--force`? (Lean: reuse `--ignore-not-ready` — one concept, less surface.)
- The `--no-review` spelling for the slicer loop vs the existing build `--no-review`
  (same flag, both paths? almost certainly yes — one `--review`/`--no-review` for
  both Gate 2 and the slicer loop, resolved per-path).
- Does removing the dead `doer: 'human'` path break any test that injected it? (It
  was CLI-unreachable, but `slicing.ts` tests may exercise it directly — check.)

## Disposition

Finding-first (maintainer decision C(i)). When the maintainer is ready, slice this
as a command-surface correction: likely ONE slice (it is internally coherent — move
the gate, unfence+flag the loop, extend the override), possibly with the ADR/PRD
note edits as the human's reconciliation. Do NOT slice before the auto-slice PRD's
gate section + the ADR are reconciled to this model (or the slicer will re-derive the
old conflation from the stale spec).
