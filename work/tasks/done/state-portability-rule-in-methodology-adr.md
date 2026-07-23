---
title: 'Refine methodology-and-skills ADR §6 + state the standing rule "no spawned-agent prompt may name a skill that is not resolvable in-band"'
slug: state-portability-rule-in-methodology-adr
brief: runner-invoked-disciplines-into-protocol
blockedBy: [slicing-protocol-doc-and-vocabulary-fix]
covers: [9]
---

## What to build

Capture the DURABLE rationale this brief established, so the next runner-invoked discipline is born as a protocol doc rather than as a fourth instance of this same bug.

End-to-end path:

- **Refine `docs/adr/methodology-and-skills.md` §6** to the de-overloaded dividing line: ORCHESTRATION skills remain human-facing and uncopied (`orchestrate`, `drive-backlog`, `to-brief`, `setup`, `triage-observations`, `capture-signal`, the `work` router); but any DISCIPLINE the autonomous runner INVOKES BY NAME is a PROTOCOL concern and travels in-band via `work/protocol/`. The protocol owns the full quality contract: authoring (templates, `WORK-CONTRACT.md`), build+claim (`CLAIM-PROTOCOL.md`, Gate-1 `verify`), judgement-before-landing (`REVIEW-PROTOCOL.md`), question-surfacing (`SURFACE-PROTOCOL.md`), and slicing (`SLICING-PROTOCOL.md`).
- **State the standing rule** in the same §: _"No spawned-agent prompt may name a skill that is not resolvable in-band."_ Briefly justify (the prompt's gate parses JSON and never errors on a missing skill → silent degradation; the runtime's blast radius is the skill-named prompts; this rule closes that class).
- **Cross-link** the new protocol docs from §6 (one-line each: `REVIEW-PROTOCOL.md`, `SURFACE-PROTOCOL.md`, `SLICING-PROTOCOL.md`) so a reader following §6 reaches them.
- Note the `capture-signal` boundary: it is model-invoked but the runner does NOT spawn an agent against it by name, so it stays out of this class — IF that ever changes, it joins (mention this so the next contributor doesn't miss the rule's trigger).

## Acceptance criteria

- [ ] `docs/adr/methodology-and-skills.md` §6 carries the de-overloaded dividing line (orchestration skill vs runner-invoked discipline) and the standing rule, stated explicitly.
- [ ] §6 cross-links the three new protocol docs in `work/protocol/`.
- [ ] The `capture-signal` boundary is noted (model-invoked ≠ runner-spawned-by-name; if a future runner spawns it by name, the rule kicks in).
- [ ] No content in §6 contradicts the prior sections of the ADR (the refinement extends the rule; it does not retract anything).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green (docs-only change but the gate still runs).

## Blocked by

- `slicing-protocol-doc-and-vocabulary-fix` — the rule references the three protocol docs as concrete examples; they must exist before the ADR points at them. Transitively also depends on the keystone and surface slices.

## Prompt

> FIRST, check this task against current reality: do all three protocol docs (`REVIEW-PROTOCOL.md`, `SURFACE-PROTOCOL.md`, `SLICING-PROTOCOL.md`) exist in `work/protocol/` of this repo (the upstream blockers should have landed)? If any is missing, do not synthesise references to non-existent files — route to needs-attention.
>
> Read the brief `work/briefs/ready/runner-invoked-disciplines-into-protocol.md` (especially the Solution section and US #9). Read the CURRENT `docs/adr/methodology-and-skills.md` (especially §6) before editing — the refinement extends §6's dividing line; it does NOT retract the orchestration-skills-stay-human rule. The brief states the refined wording verbatim.
>
> This is a small, doc-only slice. The point is durable rationale capture: a future contributor reading §6 must come away knowing (a) the rule, (b) why the rule exists (silent degradation, no compile-time check on prompt-named skills), and (c) where the three current discipline docs live.
>
> Definition of done: `pnpm format` → `pnpm -r build && pnpm -r test && pnpm format:check` green. Do NOT commit or push — the runner owns git transitions.
