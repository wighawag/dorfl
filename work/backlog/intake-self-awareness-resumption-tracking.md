---
title: intake-self-awareness-resumption-tracking — a deterministic pre-decision triage gate (read intake's own MARKER on the thread) so intake skips when it has the last word or the issue is already terminal, and only runs the prompt on genuine new human input
slug: intake-self-awareness-resumption-tracking
prd: issue-intake
blockedBy: []
covers: [2, 10]
---

> Derives from the `issue-intake` PRD (the ASK loop "resumes from the updated thread"; US #2 = ask-until-clear via conversation; US #10 = serialise concurrent runs). Surfaced 2026-06-10 while specifying the completion-comment slice: intake has NO concept of its own prior turns, which is a latent loop hazard for the ASK loop TODAY (not just for the new completion comment).

## What to build

Intake is stateless per run: the decision prompt (`buildIntakeDecisionBrief`, `src/intake.ts`) is handed the WHOLE comment thread with **no idea which comments are intake's own**. There is **no marker, no bot-identity, no cursor** anywhere in intake (verified 2026-06-10), and `classifyIntakeEvent` (`src/intake-event.ts`) maps EVERY `issue-comment-created` to `re-evaluate` with NO self-filter. Consequence: every comment intake POSTS (ask, bounce, and the proposed completion comment) is itself an `issue-comment-created`, so under a comment-trigger intake's OWN comment re-triggers intake → a re-process loop.

The fix is a **deterministic PRE-DECISION TRIAGE GATE** in the runner (inside the processing lock, BEFORE `decideAndDispatch`), built on ONE primitive: a machine-readable **MARKER** stamped on every comment intake posts. The marker carries a **kind**:

- **`ask`** — NON-terminal (the loop is mid-conversation; a human answer should resume it).
- **`bounced`** / **`created`** (slug=…) — **TERMINAL** (the issue was already transformed/decided; intake is done with it).

Marker shape: a hidden HTML comment, e.g. `<!-- agent-runner:intake kind=ask -->` / `<!-- agent-runner:intake kind=bounced -->` / `<!-- agent-runner:intake kind=created slug=<slug> -->`. It is provider-PORTABLE (survives even if intake posts under a human's token, where author-identity alone fails) and is the SOLE recovery signal (no sidecar/cursor).

### The triage (deterministic; runs under the lock, before the prompt)

Given the issue + full thread:

1. **Last comment is INTAKE's** (the last comment carries a marker) → **SKIP** with outcome **`no-new-input`**. Intake has the last word — whether it is a pending `ask` awaiting an answer or a terminal turn, there is nothing new to act on. (Under the lock, a run only ever comments as its LAST action, so "last comment is intake's `ask`" always means "already asked, no human reply yet".) This makes intake SELF-TRIGGERING a no-op BY CONSTRUCTION — intake's own freshly-posted comment is always the last comment.
2. **Last comment is someone ELSE's** (no marker on the last comment) →
   - **the thread already contains a TERMINAL intake marker** (`bounced` / `created`) → **SKIP** with outcome **`already-terminal`**. The issue was already transformed; a later human comment does NOT re-open it (a future feature may; for now, skip).
   - **otherwise** (no terminal marker — fresh issue, or mid-`ask`-loop) → **PROCEED** to the decision: everything AFTER intake's last marker (there may be several human comments) is the new material; the prompt re-reads the FULL thread for context and judges.

Two NEW named terminal outcomes (siblings of `locked` — "ran, deliberately did nothing", distinct from "didn't run"): **`no-new-input`** (intake has the last word) and **`already-terminal`** (the issue was already transformed). Both exit 0, observable by CI + a human.

### Secondary (optimisation, NOT the safety mechanism)

The MARKER + triage gate is what makes intake non-self-triggering. The `classifyIntakeEvent` author/marker self-filter (ignore a new comment that is intake's own) is a SECONDARY optimisation — it lets CI skip even _scheduling_ a run for intake's own comment — but the triage gate is the real guard (intake is safe even if a run IS scheduled). Add the self-filter, but framed as the optimisation it is, not the load-bearing fix.

This stands alone (it fixes the existing ASK/BOUNCE self-loop) and is the foundation the completion-comment slice depends on (that slice just stamps a `created` marker, which this gate's `already-terminal` branch then consumes).

## Acceptance criteria

- [ ] Every comment intake posts (ask, bounce) carries the intake MARKER with its `kind` (`ask` non-terminal; `bounced` terminal), asserted at the stubbed issue seam.
- [ ] TRIAGE — last comment is intake's (any marker) → SKIP, outcome `no-new-input` (exit 0); the decision prompt does NOT run; nothing is emitted/posted. Test pins it (incl. the self-trigger case: intake's own just-posted comment).
- [ ] TRIAGE — last comment is a human AND a TERMINAL marker (`bounced`/`created`) exists earlier in the thread → SKIP, outcome `already-terminal` (exit 0); decision does NOT run. Test pins it.
- [ ] TRIAGE — last comment is a human AND no terminal marker (fresh, or mid-`ask`) → PROCEED: the decision runs and dispatches (the existing four-outcome behaviour). Test pins it (a human reply after an `ask` marker resumes).
- [ ] `no-new-input` and `already-terminal` are distinct named outcomes on `IntakeRunOutcome` (siblings of `locked`), surfaced in the result message; CLI maps them to a clean exit 0.
- [ ] `classifyIntakeEvent` `ignore`s a new comment that is intake's own (by marker, optionally by author) — framed as the scheduling OPTIMISATION; a test pins it. (The triage gate, not this, is the safety mechanism.)
- [ ] No persisted state / cursor file — recovery is from the thread MARKER only (status = the thread, not a sidecar; the contract's "no shared index" spirit).
- [ ] Author-identity resolution (if used) is provider-pluggable through the issue seam (no `gh` import in core); a non-identifying provider still gets full triage via the marker alone.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — can start immediately (it fixes existing intake; it does not depend on the `issue:`-field or completion-comment slices).

## Open questions (needsAnswers — resolve before building)

The mechanism is DECIDED (marker + deterministic triage gate; the two skip outcomes). These shape it:

- **Identity source for the secondary self-filter:** rely on the MARKER alone (simplest, fully provider-portable), or also resolve intake's own identity (authenticated `gh` user / a configured bot login) through the seam? Lean: marker-first; author-identity optional/best-effort. Confirm before adding any identity resolution.
- **Marker placement/format:** a trailing hidden `<!-- agent-runner:intake kind=… [slug=…] -->` HTML comment (invisible in rendered GitHub, parseable). Confirm vs a visible footer line, and confirm the `kind` vocabulary (`ask` / `bounced` / `created`).

(Both small; flagged so the builder does not guess the identity model or the marker grammar.)

## Prompt

> Give intake a DETERMINISTIC pre-decision TRIAGE GATE built on a MARKER stamped on every comment intake posts, so it skips when it has the last word or the issue is already terminal, and runs the prompt ONLY on genuine new human input. PRD: `work/prd-sliced/issue-intake.md`. This also fixes a PRE-EXISTING hazard: intake's own comments are `issue-comment-created` events that `classifyIntakeEvent` re-evaluates with no self-filter → intake can re-trigger itself.
>
> DRIFT CHECK FIRST: confirm there is still NO marker / bot-identity / cursor in `src/intake.ts` + `src/intake-event.ts`, and `classifyIntakeEvent` maps `issue-comment-created` → `re-evaluate` unconditionally. If a triage gate / marker already exists, re-scope.
>
> RESOLVE THE OPEN QUESTIONS FIRST (identity source; marker format/`kind` vocabulary) — they are in the slice body; do not guess.
>
> WHAT TO BUILD: (1) stamp the MARKER (with `kind`: `ask` non-terminal / `bounced` terminal) on every comment intake posts; (2) a deterministic TRIAGE in the runner, under the lock, BEFORE `decideAndDispatch`: last comment is intake's (any marker) → SKIP `no-new-input`; else if a terminal marker (`bounced`/`created`) exists → SKIP `already-terminal`; else PROCEED to the decision (new human comments after the last marker are the material; the prompt re-reads the full thread); (3) the two new named outcomes (`no-new-input`, `already-terminal`) on `IntakeRunOutcome` + CLI exit-0 mapping; (4) the `classifyIntakeEvent` self-filter as a SECONDARY scheduling optimisation (the triage gate is the real guard).
>
> SCOPE FENCE: no persisted cursor/sidecar (recover from the thread/marker only); core never imports `gh` (any identity resolves through the issue seam). Do NOT build the completion comment here (dependent slice) — but make the marker mechanism reusable so that slice just adds a `created` marker, which the `already-terminal` branch then consumes. Do NOT make the `classifyIntakeEvent` filter the safety mechanism — the triage gate is.
>
> SEAM TO TEST AT: the stubbed issue seam (`postIssueComment` records the marker; `listComments` seeds threads with/without markers) + the triage's three branches (`no-new-input` / `already-terminal` / proceed) + `classifyIntakeEvent` (own-comment → ignore). The prompt JUDGEMENT is not unit-tested (PRD); only the triage + dispatch. Mirror the existing intake + intake-event tests.
>
> "Done" = intake skips (`no-new-input`) when it has the last word, skips (`already-terminal`) when the issue was already transformed, proceeds only on genuine new human input, cannot self-trigger, recovers from the thread marker (no sidecar), and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
