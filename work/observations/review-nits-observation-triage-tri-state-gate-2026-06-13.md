---
title: review-gate non-blocking nits for 'observation-triage-tri-state-gate' (Gate 2 approve)
date: 2026-06-13
status: open
slug: observation-triage-tri-state-gate
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'observation-triage-tri-state-gate' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: under `observationTriage: off` + an explicit `advance obs:<slug>` (which bypasses the selection gate), the triage rung runs in `ask`-mode (surfaces the question, never auto-disposes). Is that the intended behaviour?
  (This is an in-scope design decision the slice itself called out as needing confirmation ('DECISION to record: under off + explicit naming, does the rung run in ask-mode or auto-mode? Default: ask; confirm.'). The code implements `ask` via `context.observationTriage === 'auto'` being the sole auto-disposition trigger, and a test pins it. It is the conservative choice and mirrors `do <slug>` vs `autoBuild`, but it is a user-visible default worth a human ratifying. No '## Decisions' block was present in the PR description to ratify from.)
- Ratify: `--observation-triage` is added as a flag on `advance` only; the `run` daemon picks up the gate via resolved config (env/per-repo/global) rather than its own flag. Intended?
  (The slice said 'on `advance` (+ `run` as applicable)'. The implementation gives `advance` the flag and threads the resolved `config.observationTriage` into the run-tick builder (`buildAdvanceRunTick`) and its `lifecycleGates`. This is coherent (run is the unattended daemon, configured by repo/env, not ad-hoc flags) but is an in-scope choice about cross-command flag surface worth confirming.)
- Should a follow-up sweep update the protocol/ADR parentheticals that still name the now-deleted `autoTriage` config key?
  (The agent recorded this itself as work/observations/protocol-docs-name-old-autotriage.md, and I verified the claim is accurate: `docs/adr/methodology-and-skills.md:41`, `work/protocol/WORK-CONTRACT.md:163`, and its source `skills/setup/protocol/WORK-CONTRACT.md:163` still list the gate family as `(autoBuild/autoSlice/autoTriage)`. These are records/protocol contracts where the parenthetical is incidental to the `autoBuild` definition, so leaving them out of this engine slice is a defensible scope call (and the live CONTEXT.md glossary WAS updated). Flagging only so the human can schedule the doc sweep; not a defect in this diff.)
