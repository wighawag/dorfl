---
title: wire the PRODUCTION intake decision verdict-parse — the agent's emitted output → IntakeVerdict (close US #6's "run LOCALLY one-shot"; the dispatcher is already built)
slug: intake-production-verdict-parse
spec: issue-intake
blockedBy: [intake-decision-prompt-and-four-outcome-dispatch]
covers: [6]
---

## What to build

Close the ONE gap that stops a REAL `intake <N>` from working today: the serialization seam between the decision agent's emitted output and the already-built dispatcher. Right now `runDecision` (`src/intake.ts`) launches the harness with the decision prompt, captures its output, and then **throws** `"the production intake decision parse is not wired yet"` — because nothing turns the agent's text into the `IntakeVerdict` object the dispatcher consumes. The TESTED path injects a canned `decide`; PRODUCTION has no parser. So `intake 40` on a real repo reads the issue, builds the prompt, runs the agent — then errors instead of emitting a slice/PRD.

This is NOT the model's judgement (that is the agent at runtime, untested by design) and NOT the dispatcher (fully built + tested across PRs #50–#52). It is purely the WIRE between them, in three small parts, modeled 1:1 on the review gate's existing `parseReviewVerdict` twin:

1. **Output contract on the prompt.** Append to `buildIntakeDecisionBrief` an explicit output-format instruction: the agent must emit its verdict as a single fenced ```json block whose keys map onto `IntakeVerdict`—`{ "outcome": "ask"|"slice"|"prd"|"bounce", … per-outcome fields … }`:
   - `slice` → `sliceSlug?`, `sliceTitle`, `sliceBody` (the markdown after the frontmatter);
   - `prd` → `prdSlug?`, `prdTitle`, `prdBody`, `prdHumanOnly?`, `prdNeedsAnswers?`;
   - `ask` → `question`;
   - `bounce` → `bounceMessage`. (Exactly the fields the `IntakeVerdict` interface already declares — see `src/intake.ts`. The prompt already explains the four verdicts + decision aids; this only adds HOW to hand the verdict back, the way the review prompt tells the agent to emit `{verdict, findings}`.)

2. **`parseIntakeVerdict(output: string): IntakeVerdict`.** Reuse the review gate's machinery (`extractVerdictJsonSpan` / the `JSON.parse` + validate shape in `src/review-gate.ts:122` `parseReviewVerdict`): pull the first JSON object out of the (possibly prose-wrapped / fenced) agent output, validate `outcome ∈ {ask,slice,prd,bounce}`, map the per-outcome fields onto `IntakeVerdict` (tolerating missing optionals — the dispatcher already has fallbacks, e.g. slug-from-title), and THROW a clear parse error on malformed/absent JSON. Factor out / share the JSON-span extractor rather than copy-pasting it if that is the cleaner seam (it is the SAME "first JSON object in agent prose" need — coherence, not a second extractor).

3. **One-line swap in `runDecision`.** Replace the `throw "not wired yet"` with `return parseIntakeVerdict(readOutput(launched.output))` (using the same `readOutput` normalisation the review gate uses on `launched.output`). The existing `decideAndDispatch` try/catch already maps a thrown parse error onto the `agent-failed` outcome (exit 1) — so a malformed verdict degrades honestly, no new error plumbing needed.

End-to-end behaviour after this slice: a real `intake <N> --propose --harness <h>` with NO injected `decide` reads the issue, runs the agent, PARSES its emitted verdict, and DISPATCHES it (slice → backlog PR with `Fixes #N`; prd → `work/prd/` PR with `issue: N`; ask/bounce → posted comment) — US #6's "run LOCALLY one-shot" is finally true.

## Why this slice exists (the slicing miss it closes)

The original `issue-intake` cut built the dispatcher against a STUBBED verdict (the correct testing discipline: "test the DISPATCH, not the model") but no slice owned the PRODUCTION verdict-parse that connects a launched agent's output to that dispatcher — a destination-check gap (every engine slice green, yet a real `intake` still throws). The decision PROMPT (PRD deliverable #3) and the dispatcher (deliverable #4) both landed; this is the missing wire between them. Captured in `work/observations/intake-tracer-slice-outcome`'s gate nit (PR #50, nit 2) and ratified there as "the next slice's job" — this is that slice.

## Acceptance criteria

- [ ] `buildIntakeDecisionBrief` instructs the agent to emit its verdict as a single fenced ```json block with `outcome`+ the per-outcome fields that map onto    `IntakeVerdict`. (Prose-level; not unit-tested for judgement — see below.)
- [ ] `parseIntakeVerdict(output)` parses each of the four outcomes out of realistic agent output (prose-wrapped + fenced), producing the right `IntakeVerdict`: `slice` → sliceSlug/sliceTitle/sliceBody; `prd` → prdSlug/prdTitle/prdBody/prdHumanOnly/prdNeedsAnswers; `ask` → question; `bounce` → bounceMessage. Asserted as a parse table.
- [ ] `parseIntakeVerdict` THROWS a clear error on: no JSON object present; invalid JSON; an `outcome` not in `{ask,slice,prd,bounce}`. (Tested.)
- [ ] `runDecision` no longer throws "not wired yet": with NO injected `decide`, a harness launch whose output carries a valid verdict block DISPATCHES correctly. Assert with a STUBBED harness (inject `launched.output` text — no real model) that a real-path `slice` verdict produces the backlog slice + `Fixes #N` + propose PR (reuse the throwaway-git integration harness), and that a malformed output degrades to `agent-failed` (exit 1), not a crash.
- [ ] The JSON-span extractor is SHARED with / consistent with the review gate's (not a forked second "extract first JSON object" implementation) — coherence.
- [ ] The agent still does NO git/seam ops (it only emits text); the runner parses + dispatches. The model's JUDGEMENT is NOT unit-tested (only the parse + dispatch are), exactly as the review prompt's judgement is not.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `intake-decision-prompt-and-four-outcome-dispatch` (in `work/done/`) — it built `buildIntakeDecisionBrief`, the `IntakeVerdict` shape, and the full four-outcome dispatcher this slice wires the production input into. Touches the same `src/intake.ts` (`runDecision`, the prompt builder) so serialise behind it (it is already done).

## Prompt

> Close the ONE gap stopping a real `intake <N>` from working: wire the PRODUCTION decision verdict-parse (US #6 — "run LOCALLY one-shot"). Today `runDecision` (`src/intake.ts`) launches the harness with the decision prompt, captures its output, then THROWS "the production intake decision parse is not wired yet" — the tested path injects a canned `decide`; production has no parser. The MODEL's judgement is out of scope (untested by design); the DISPATCHER is already built (PRs #50–#52). This is purely the WIRE between the agent's emitted text and the `IntakeVerdict` the dispatcher consumes.
>
> REUSE THE TWIN (do not reinvent): the review gate already does exactly this for its agent — `parseReviewVerdict` (`src/review-gate.ts:122`) pulls the first JSON object out of prose-wrapped/fenced agent output via `extractVerdictJsonSpan`, `JSON.parse`s it, and validates the shape. Model `parseIntakeVerdict` on it, and SHARE the JSON-span extractor rather than forking a second "first JSON object in agent prose" implementation (it is the same need — coherence, like the `resolveIntegrationMode` reuse in `intake-per-outcome-integration-modes`).
>
> WHAT TO BUILD (three small parts):
>
> 1. Append an OUTPUT CONTRACT to `buildIntakeDecisionBrief`: the agent emits a single fenced ```json block whose keys map 1:1 onto the EXISTING `IntakeVerdict` interface (`src/intake.ts`): `outcome`+`slice`→sliceSlug?/sliceTitle/sliceBody, `prd`→prdSlug?/prdTitle/prdBody/prdHumanOnly?/prdNeedsAnswers?, `ask`→question, `bounce`→bounceMessage. The prompt already explains the four verdicts + decision aids — add only HOW to hand the verdict back.
> 2. `parseIntakeVerdict(output: string): IntakeVerdict` — extract + parse + validate (`outcome ∈ {ask,slice,prd,bounce}`; tolerate missing optionals, the dispatcher has fallbacks; throw a clear error on absent/invalid JSON or a bad outcome).
> 3. In `runDecision`, replace the `throw "not wired yet"` with `return parseIntakeVerdict(readOutput(launched.output))` (the same `readOutput` the review gate uses). `decideAndDispatch`'s existing try/catch already maps a thrown parse error onto `agent-failed` (exit 1) — no new error plumbing.
>
> SEAM TO TEST AT: `parseIntakeVerdict` as a parse table (the four outcomes out of prose-wrapped+fenced output; the three throw cases) + a STUBBED-harness end-to-end (inject `launched.output` text, no real model — assert a real-path `slice` verdict emits the backlog slice + `Fixes #N` + propose PR via the throwaway-git harness; a malformed output → `agent-failed` exit 1). Do NOT unit-test the model's judgement (only the parse + dispatch), exactly as the review prompt's judgement is not tested.
>
> SCOPE FENCE: do NOT touch the dispatcher's outcome branches, the per-outcome modes, the lock, or event-classification (all built). Do NOT change the `IntakeVerdict` shape (it already declares every field). Do NOT build any CI/policy (`runner-in-ci`). Do NOT add a slice-level `issue:` field. Keep the agent git/seam-free.
>
> FIRST run the drift check: confirm `runDecision` still throws "not wired yet" and still launches the harness + captures `launched.output`; confirm `buildIntakeDecisionBrief` + the `IntakeVerdict` interface + `decideAndDispatch`'s try/catch→`agent-failed` are as described; confirm `parseReviewVerdict` / `extractVerdictJsonSpan` are still the reusable twin in `src/review-gate.ts`. If the production parse already landed, or the seam moved, route to `needs-attention/` with the discrepancy rather than building on a stale premise.
>
> "Done" = a real `intake <N>` with no injected `decide` parses the agent's emitted verdict and dispatches it (slice/prd/ask/bounce), a malformed output degrades to `agent-failed`, the JSON extractor is shared with the review gate, the agent stays git/seam-free, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.
