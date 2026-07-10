---
title: Goal-driven bounded loop — a self-reporting increment loop with stall detection + an agent-writable halt marker (inspired by Maestro's Auto Run / Goal-Driven mode)
slug: goal-driven-bounded-loop
type: idea
status: incubating
---

# Goal-driven bounded loop (pre-SPEC / incubating idea)

> Captured 2026-06-15 from a comparison pass against [Maestro](https://github.com/RunMaestro/Maestro) (its Auto Run + Goal-Driven docs). This is a **borrowed-mechanism** idea, recorded so the mechanism is not lost, NOT a committed direction.
>
> **FIT IS UNRESOLVED — read this caveat first.** The maintainer is not yet sure this belongs in dorfl at all. dorfl is deliberately **spec-first** (a slice is a pre-written tracer-bullet vertical slice; the spec IS the contract). A goal loop is the OPPOSITE shape: an open-ended objective with no slice authored up front. So this idea may turn out to be either (a) a genuinely missing complement to spec-first slices, or (b) a foreign body that fights the `work/` contract's "one buildable slice = one file, status = folder" model. The point of capturing it is to hold the mechanism and the open question, not to endorse building it.

## What Maestro does (the source material)

Maestro's automation has two modes; the borrowable one is **Goal-Driven**:

- A free-text **goal** (e.g. "migrate the settings store from Redux to Zustand, keep tests green") plus an **exit-criteria** hint and an **iteration limit** (finite or infinite).
- Each iteration spawns a **fresh** agent that makes ONE increment of progress, reports an honest `0-100` self-assessment **in-band on its own line**, and exits:
  `<!-- maestro:progress 45 | refactored auth, tests still pending -->`
- The engine reads that marker to drive a progress bar and to decide whether to run again.
- The loop STOPS on exactly four typed conditions: **completed** (progress 100 / explicit done marker), **deadlock** (the agent declares a true blocker it cannot work around), **max-iterations**, or **stalled** (progress did not increase for THREE iterations in a row).
- Separately, a **halt marker** the AGENT writes into the work doc (`<!-- maestro:halt: reason -->`) aborts the whole batch when it discovers a broken precondition, ambiguous spec, or a destructive change it refuses to make. A **stale halt marker blocks re-runs** until removed, so halted work is never silently replayed. (Distinct from one task merely failing, which does not halt.)

## The two mechanisms genuinely worth considering

Stripped of Maestro's GUI coupling (most of `maestro-cli` requires the desktop app running — irrelevant to a headless tool), TWO ideas survive as substrate-level mechanisms that could live entirely WITHIN dorfl's existing invariants:

### 1. Bounded increment loop with monotonic-stall detection

The valuable kernel is not "open-ended work" per se — it is the **cheap, model-agnostic way to BOUND an unbounded loop without trusting the agent to declare success**: a self-assessed progress number plus a monotonic-stall guard (no upward movement for N iterations ⇒ stop). That is philosophically aligned with dorfl's existing "deterministic trust boundary" stance (`verify` is the non-skippable gate), just applied to **liveness** instead of **correctness**. It answers a question the runner cannot answer today: *"this job RAN but went nowhere — how many times before we stop?"*

This exposes a real gap in the existing **failure-cause taxonomy** (CONTEXT.md): there is `gate-failed`, `rebase-conflict`, `review-blocked`, `agent-stopped`, `agent-failed`, `transient-infra`, `config-error`, `prepare-failed` — but NO "ran repeatedly, made no progress" cause. A stall would want a new cause (placeholder name `no-progress`) routed to `needs-attention/`, distinct from `agent-stopped` (deliberate stop) and `agent-failed` (bad/empty output). Whether that gap is worth filling depends entirely on whether goal-loops enter the model at all.

### 2. Agent-writable halt marker (an in-band, re-run-blocking stop signal)

dorfl already has the CONCEPT (an agent deliberately stopping → `agent-stopped`), but it is an out-of-band outcome inferred by the runner. Maestro's twist is an **in-band, persisted, re-run-blocking** marker the agent WRITES.

This fits dorfl's core invariant unusually well: **"the runner owns all git-state transitions; the build agent only writes code."** A halt marker is the agent *writing a file*, not performing a git transition — the runner READS it and owns the resulting route (`git mv` to `needs-attention/` with a reason). It is a clean signalling CHANNEL from agent to runner that respects the boundary, rather than letting the agent touch lifecycle state directly. The "stale marker blocks re-runs" property maps onto the existing needs-attention hygiene (a stuck item stays stuck until a human resolves it).

> Note this partially overlaps `work/ideas/advance-loop-question-answer-protocol.md`: the **deadlock / "this needs a human"** disposition there is already routed via an answered sidecar entry ⇒ `needs-attention`. A halt marker is the same destination via a different (agent-initiated, in-band file) channel. If the advance-loop lands first, a halt marker might be redundant with "agent surfaces a blocking question." Resolve the overlap before building either.

## How it maps onto the existing model (the honest stretch)

| Maestro concept | dorfl equivalent / required change |
| --- | --- |
| goal (free text) | NO equivalent. Would be a NEW work-item shape, OR a field on a slice. This is the part that fights "spec-first / status=folder". |
| iteration = fresh agent, one increment | Already native: a `job` is one fresh harnessed run; there is no long-lived agent identity (ADR §1). A loop of jobs is `run`-shaped. |
| progress 0-100 marker | NEW in-band convention the agent emits; the runner parses it (akin to the advance-loop sidecar being machine-owned). |
| completed (progress 100) | done-move (existing). |
| deadlock | `needs-attention/` with cause `agent-stopped` (existing). |
| max-iterations | NEW loop bound (config-resolved, fits the flag>env>repo>global>default ladder). |
| stalled (no progress N×) | `needs-attention/` with NEW cause `no-progress`. |
| halt marker | agent writes a file; runner routes to `needs-attention/` (respects the git-ownership invariant). |

## Why the fit is genuinely uncertain (the case AGAINST)

State this honestly so a future reader does not over-invest:

- **Spec-first is a deliberate stance, not an accident.** A slice is a contract precisely so the runner can verify against it. A goal has no pre-written acceptance contract beyond a fuzzy exit-criteria hint — which Maestro itself admits "guides the agent; it is not matched automatically." That is exactly the thing dorfl refuses to trust (it has a deterministic `verify` gate for a reason). A goal-loop's "done" is a self-report, not a gate. That tension is the crux.
- **`status = folder, never a field`** is a load-bearing invariant. A goal that mutates a progress number in place looks suspiciously like state-in-a-field (the same anti-pattern Maestro's `- [x]` checkboxes embody, and the reason its "Reset on Completion writes a working copy" workaround exists). Any goal-loop design must NOT smuggle mutable status into a file.
- **It may already be covered.** The combination of a `needsAnswers` slice + the advance-loop's surface-question rung arguably handles "open-ended, can't fully specify" by SURFACING the unknowns as questions rather than spinning an autonomous loop. If the answer to open-endedness is "ask the human," dorfl may not want an autonomous goal-loop at all.
- **The strongest standalone import is the stall guard + halt marker**, NOT the goal mode. Those two could be adopted to harden the EXISTING build/advance loops (bound them, give the agent a clean abort channel) WITHOUT ever introducing a "goal" work-item. That is the lower-risk extraction.

## Open questions to resolve before it becomes a SPEC

- **Does dorfl want open-ended goal items AT ALL,** or only the bounding mechanisms (stall guard + halt marker) applied to existing spec-first loops? (Strong lean: extract the mechanisms, NOT the goal-item, unless a concrete need for goal-items appears.)
- **If goal-items are wanted:** what is their work-item shape under "status = folder, one file per item"? Where does the progress live so it is not "status in a field"? (A goal-item's transient progress is arguably runner-internal loop state, NOT persisted item status — needs design.)
- **Overlap with advance-loop:** is the halt marker redundant with "agent surfaces a blocking question via the sidecar"? Is `deadlock` already `agent-stopped`? Resolve before building either.
- **New failure cause `no-progress`:** does the taxonomy actually want it, and is it distinct enough from `agent-stopped` / `agent-failed` to earn a name (the CONTEXT.md coherence rule: never duplicate an existing concept under a new name)?

## What to explicitly NOT borrow from Maestro

- The GUI coupling (`MAESTRO_NOT_RUNNING` everywhere) — antithetical to the headless thesis.
- Markdown-checkbox tasks as the work unit — weaker than `status = folder`; it IS the field-as-status anti-pattern.
- Cue / playbook exchange / themes / notifications — desktop-cockpit product surface, not infrastructure.

## Disposition

INCUBATING — captured for the mechanism, fit deliberately UNRESOLVED. Most likely useful as **two small hardening extractions** (a bounded-loop stall guard with a `no-progress` cause, and an agent-writable halt marker as a clean abort channel) applied to the existing spec-first loops — NOT as a new open-ended "goal" work-item, unless a concrete need for goal-items emerges. Do NOT promote to a SPEC until the overlap with `advance-loop-question-answer-protocol` is resolved and the maintainer decides whether goal-items belong in the model at all.
