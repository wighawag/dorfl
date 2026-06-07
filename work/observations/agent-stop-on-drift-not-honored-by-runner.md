---
title: A build agent's deliberate STOP-on-drift is not honored by the runner — it runs the full gate+Gate-2 on a no-op result and mislabels it a "review block"
date: 2026-06-07
kind: observation
area: packages/agent-runner/src/do.ts (+ run.ts) ↔ skills/to-slices/CLAIM-PROTOCOL.md
severity: medium
status: open
---

## What happened (live, on `do-run-share-isolation-seam`)

The build agent for `do-run-share-isolation-seam` did exactly what the
CLAIM-PROTOCOL wrapper instructs for a drifted slice: it ran the slice's own
drift-check, found THREE load-bearing premises factually false against current
`src/` (the `run`/`do --remote` convergence the slice asks for ALREADY landed in
`run-daemon-reframe` + `do-remote` + integration-core), recorded
`work/observations/do-run-share-isolation-seam-premise-drifted.md`, made NO source
change, and STOPPED — reporting specifically what had drifted and a suggested
re-scope.

That is the CORRECT behaviour. The CLAIM-PROTOCOL wrapper
(`skills/to-slices/CLAIM-PROTOCOL.md`) literally says:

> "If the SLICE ITSELF is the problem — it is ambiguous … rests on a premise that
> no longer matches the code/ADRs (it has DRIFTED) … do NOT guess and build on it.
> STOP and report specifically what is unclear or contradicted (and where), so a
> human can resolve it **(the runner routes the item to needs-attention)**."

## The defect

**That promise — "the runner routes the item to needs-attention" — is unfulfilled,
and there is no STOP signal protocol for the agent to raise.** The runner
(`performDo` in `do.ts`, mirrored by `run.ts`'s `runOneItem`) recognises only TWO
agent outcomes:

1. `agent.ok === false` (the agent crashed/errored) → `saveAgentFailure` → route to
   needs-attention, NO gate. ✓
2. `agent.ok === true` → assume it BUILT → run the acceptance gate, then Gate-2
   review, then done-move.

There is no THIRD state: "the agent exited cleanly (`ok === true`) but DELIBERATELY
chose not to build and recorded a STOP reason." A drift-STOP is indistinguishable
from a successful build that happened to change nothing, so the runner:

- ran the full acceptance gate (passed — nothing changed),
- ran the full Gate-2 review (~an expensive extra agent round),
- the Gate-2 reviewer then noticed "the branch delivers no code; criteria unmet"
  and BLOCKED it,
- so it reached needs-attention via the WRONG door — mislabeled as a
  *Gate-2 review block* rather than an *agent-declared drift STOP*, after wasting
  the gate + review.

The only reason the drift was caught at all is that the Gate-2 reviewer's PROMPT
tells it to check the diff vs. criteria — an LLM judgement, not a deterministic
runner check. A drift-STOP on a populated slice (where the gate is slower) wastes
even more, and a less-careful reviewer could conceivably mis-route it.

## Why it matters

- **Wasted work + cost**: a clean STOP should short-circuit BEFORE the gate and the
  Gate-2 review agent, not after both.
- **Wrong signal to the human**: "PR/code review (Gate 2) blocked this" buries the
  real, more valuable signal ("the agent says this slice has drifted; here are the
  three false premises + a re-scope"). The needs-attention reason should be the
  agent's drift report, verbatim.
- **The protocol claims a behaviour the code doesn't implement** — exactly the kind
  of doc-vs-code drift the protocol itself warns against.

## Proposed fix (for human sign-off — not yet implemented)

Two halves, mirroring the existing "claim vs work" / "agent edits, runner does git"
in-band discipline:

1. **A machine-readable STOP signal the agent raises in-band.** Extend the
   CLAIM-PROTOCOL wrapper so "STOP and report" has a concrete, parseable form the
   runner can detect — e.g. the agent emits a sentinel in its final output
   (`LaunchResult.output`, already captured as `agent.output`) such as a leading
   `STOP: <reason>` / a fenced `=== SLICE-DRIFT-STOP ===` block, AND/OR writes a
   conventional `work/observations/<slug>-premise-drifted.md` the runner looks for.
   The output sentinel is cleaner (it already flows back through the harness seam).
2. **Runner detects the STOP between agent-return and the gate.** In `performDo`
   (and `runOneItem`), AFTER `agent.ok` is true but BEFORE `performComplete`, check
   for the STOP signal. If present → route to needs-attention via the SAME
   `saveAgentFailure` / needs-attention seam, with the agent's STOP reason as the
   recorded reason, and SKIP the gate + Gate-2 entirely. A new `DoOutcome`
   (e.g. `agent-stopped` / `drift`) distinct from `needs-attention`(red gate) and
   `review-blocked`, so `status` and the report name it honestly.

Consider also a cheap deterministic backstop: if `agent.ok` and the work-branch
diff vs. `<arbiter>/main` is EMPTY (no source change at all), that is never a
successful build — treat it as an implicit STOP/no-op and route to needs-attention
without paying for Gate-2. (The drift-STOP is the principled case; the empty diff
is the observable symptom.)

This wants its own slice (it changes the agent↔runner contract + the wrapper). It
is the natural sibling of the "agent edits, runner owns git" rules already in-band.

## Cross-link

The slice that triggered this (`do-run-share-isolation-seam`) is ALSO genuinely
drifted and needs re-scoping per the agent's report — see
`work/observations/do-run-share-isolation-seam-premise-drifted.md` (on the
preserved `work/do-run-share-isolation-seam` branch). That re-scope and THIS
runner-fix are two separate follow-ups.
