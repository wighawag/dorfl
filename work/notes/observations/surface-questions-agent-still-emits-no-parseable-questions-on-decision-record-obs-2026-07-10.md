# The surface-questions agent STILL emits no parseable `{questions}` on a pure decision-record observation — the `note`-field mitigation did not fully close the recurrence (2026-07-10)

## What happened

A CI `advance` run over one of THIS cutover's observation notes errored out:

```
Run dorfl advance "obs:rename-spec-4b-namespace-consumer-clause-noop-2026-07-10" --propose --watch --arbiter origin
>> LOCKED 'observation-rename-spec-4b-namespace-consumer-clause-noop-2026-07-10' for advancing on origin (unified lock).
>> RELEASED 'observation-rename-spec-4b-namespace-consumer-clause-noop-2026-07-10' advancing borrow on origin (item untouched).
error: surface observation:rename-spec-4b-namespace-consumer-clause-noop-2026-07-10: the surface-questions agent produced no usable emit (surface agent produced no parseable {questions} result).
Error: Process completed with exit code 1.
```

The observation it surfaced (`rename-spec-4b-namespace-consumer-clause-noop-2026-07-10.md`) is a pure DECISION RECORD ("Decision (PROCEED, recorded per the decision-bar rule)…", with an explicit "Alternatives considered" section). It has genuinely NO open questions — the honest surface result is `{questions: []}`.

## Why it matters (a recurrence of a known failure mode)

`surface-gate.ts`'s `parseSurfaceEmit` comment already names this exact failure and its supposed fix: an EMPTY `questions` list is VALID ("the honest 'no open judgement' result"), and a free-prose `note` field was added to give the agent's reasoning "a HOME inside the object so it never needs to write prose AROUND the JSON (the cause of the 'no parseable {questions}' trailing-chatter failure — observation `surface-rung-agent-emits-no-parseable-questions`)." The engine deliberately treats an unparseable emit as a HARD error, never a silent no-op (task `advance-surface-limbo-observation-loudly-instead-of-silent-no-op`, DONE) — so failing loudly is BY DESIGN.

But the `note`-field mitigation did NOT prevent the recurrence: on a decision-record observation with no questions, the agent still emitted output with no extractable `{questions:[…]}` object, so `extractJsonObjectSpan(output, 'questions')` returned undefined and CI exited 1. The loud-failure design is correct; the AGENT-RELIABILITY gap (the surface-questions skill not reliably emitting the trivial `{questions: []}` JSON, especially when there is nothing to ask) is the residual defect.

Two candidate angles (NOT decided here — for the human / a future surface-robustness task):
1. **Skill-side**: strengthen the `surface-questions` SKILL prompt so a "nothing to surface" outcome ALWAYS emits a bare `{"questions": []}` object (the empty-but-valid path), with any prose confined to `note`. This is the cheapest fix and matches the existing `note`-field intent.
2. **Engine-side**: consider whether a decision-record / already-triaged observation should even be routed to the surface agent — a note that records a closed decision (no `## Open questions`, no pending sidecar) arguably auto-triages to "no questions" WITHOUT a model round-trip (cf. `observation-triage-already-triaged-benign-skip`). That would make CI robust to the agent's flakiness rather than depending on it.

## Scope note

This is TANGENTIAL to the spec→spec cutover (it just happened to fire on a cutover observation). Captured, not acted on. It does not block the cutover: the observation body is fine; only the CI surface step over it failed, and the item was released untouched.

## Provenance

CI log pasted by the human (2026-07-10). Verified against `surface-gate.ts:102-146` (`parseSurfaceEmit` / `SurfaceParseError`, the "empty is valid, absence is not" rule) and the DONE tasks `advance-surface-limbo-observation-loudly-instead-of-silent-no-op` + the referenced `surface-rung-agent-emits-no-parseable-questions` observation @ main bd29e1ce.
