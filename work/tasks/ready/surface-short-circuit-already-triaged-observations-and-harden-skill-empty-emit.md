---
promotedFrom: observation:surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10
---

## What to build

Two changes, in priority order. The ENGINE change is load-bearing; the SKILL change is defence-in-depth.

### 1. (Primary, load-bearing) Engine short-circuit for already-triaged / decision-record observations

In the surface path used by `dorfl advance` on `observation:*` items (the code path that ends in the `surface observation:…: the surface-questions agent produced no usable emit` error — see `surface-gate.ts` `parseSurfaceEmit` / `SurfaceParseError` at roughly `surface-gate.ts:102-146`, and the sibling triage helper `observation-triage-already-triaged-benign-skip`), detect the "nothing to surface" shape of the observation BEFORE dispatching to the surface-questions agent, and synthesise the honest `{questions: []}` result deterministically (no model round-trip).

The detector should be conservative — err on the side of STILL calling the agent when unsure. Concretely, treat an observation as auto-triaged to `{questions: []}` when ALL of the following hold:

- The frontmatter does NOT set `needsAnswers: true` (already-answered / never-asked notes).
- The body contains NO `## Open questions` section (or the section is empty / only whitespace / only a "none" marker).
- There is no pending question sidecar / open-question artifact associated with the item (same signal `observation-triage-already-triaged-benign-skip` uses; reuse that predicate if it already exists rather than reinventing it).
- Optionally (belt-and-braces for the decision-record case that triggered this): the body matches the decision-record shape — e.g. contains a `Decision (` line and/or an `Alternatives considered` section. This is a HINT, not required; the three conditions above are the load-bearing ones.

When the detector fires, skip the agent dispatch entirely and return `{questions: []}` as if the agent had emitted it. Log a short line so it is visible in CI that the short-circuit fired (e.g. `surface observation:<slug>: auto-triaged (no open questions, no sidecar) — skipped agent`).

The loud-failure design from `advance-surface-limbo-observation-loudly-instead-of-silent-no-op` MUST be preserved for the cases that DO reach the agent — this change only prevents observations that provably have nothing to ask from ever reaching the flaky path. It does not weaken the hard-error contract for genuine surface failures.

Add a test that exercises the exact reproducer from the source observation: a decision-record observation body (with `Decision (PROCEED…)` + `Alternatives considered`, no `## Open questions`, no `needsAnswers`) goes through `advance` and returns `{questions: []}` WITHOUT calling the surface-questions agent (mock/spy the agent dispatch and assert it was not invoked).

### 2. (Secondary, defence-in-depth) Harden the `surface-questions` skill prompt

In the `surface-questions` skill prompt, add an explicit, unmissable instruction that when there is nothing to surface, the agent MUST emit a bare `{"questions": []}` JSON object as its final output, with any reasoning/prose confined to the existing `note` field INSIDE that object (never around it). Reference the existing `note`-field rationale from `parseSurfaceEmit`'s comment ("empty is valid, absence is not") so the intent is captured in the prompt itself.

This is best-effort — even after the engine short-circuit, the agent will still be dispatched for observations that DO have open questions but where the honest answer for a given question turns out to be "nothing to ask further", so making the empty-but-valid path robust in the skill still has value. Do NOT rely on this half for correctness; the engine short-circuit is the guarantee.

### Acceptance

- `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- New test proves a decision-record observation short-circuits without dispatching the surface-questions agent.
- The loud-error path (`SurfaceParseError` / "produced no parseable {questions} result") is UNCHANGED for observations that legitimately reach the agent and get an unparseable emit — do not regress `advance-surface-limbo-observation-loudly-instead-of-silent-no-op`.
- Skill prompt update lands in the same task and is covered by whatever prompt-lint / snapshot the skill already has (if any).

## Prompt

> You are picking up a task in the `dorfl` repo. The `dorfl advance` surface step over an `observation:*` item can crash with `surface observation:<slug>: the surface-questions agent produced no usable emit (surface agent produced no parseable {questions} result)` when the observation is a pure decision record with no open questions — the surface-questions agent sometimes fails to emit the trivial `{"questions": []}` JSON. A prior mitigation added a `note` field to the emit shape (see `parseSurfaceEmit` in `surface-gate.ts` around lines 102-146, and the DONE task `advance-surface-limbo-observation-loudly-instead-of-silent-no-op` plus the earlier observation `surface-rung-agent-emits-no-parseable-questions`) but the recurrence shows it is not enough on its own.
>
> Do TWO things, in priority order:
>
> 1. **Primary (load-bearing): engine short-circuit.** In the surface path that dispatches to the surface-questions agent, detect "nothing to surface" observations BEFORE calling the agent and return `{questions: []}` deterministically. The detector fires when the frontmatter does not set `needsAnswers: true`, the body has no non-empty `## Open questions` section, and there is no pending open-question sidecar (reuse the predicate from `observation-triage-already-triaged-benign-skip` if it already exists — grep for it). Optionally use the decision-record shape (`Decision (…)` line, `Alternatives considered` section) as an additional hint, but do not require it. Log a one-liner when the short-circuit fires so CI shows why the agent was skipped. Preserve the loud-error contract for observations that DO reach the agent.
>
> 2. **Secondary (defence-in-depth): skill prompt hardening.** In the `surface-questions` skill prompt, add an explicit rule that when there is nothing to ask, the agent MUST emit `{"questions": []}` (empty array is valid; absence is not) with any prose confined to the `note` field inside that object. Reference the "empty is valid, absence is not" rationale already in `parseSurfaceEmit`'s comment.
>
> Add a test that reproduces the original failure shape — a decision-record observation body (contains `Decision (PROCEED…)` and `Alternatives considered`, no `## Open questions`, `needsAnswers` unset) — and asserts that `advance` on it returns `{questions: []}` WITHOUT invoking the surface-questions agent (spy/mock the dispatch). Confirm the existing loud-failure test for genuinely unparseable emits still passes.
>
> Finish by running `pnpm format` then verifying `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do not perform git operations — the runner owns commits.
>
> Provenance for context: source observation `observation:surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10`, human-answered 2026-07-10, direction: pursue BOTH angles, engine short-circuit is the primary/load-bearing half.
