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

The fix is a **deterministic PRE-DECISION TRIAGE GATE** in the runner (inside the processing lock, BEFORE `decideAndDispatch`), built on ONE primitive: a machine-readable **MARKER** stamped on every comment intake posts. The marker records ONLY a neutral **kind** (a fact about what intake did) — it does NOT encode policy:

- `kind=ask` — intake asked a clarifying question.
- `kind=bounced` — intake bounced the issue.
- `kind=created slug=<slug>` — intake created a slice/PRD.

**Whether a kind is TERMINAL is the TRIAGE's interpretation, NOT data in the marker** (decided 2026-06-10). The marker is a neutral record ("intake did X"); the triage maps `ask → non-terminal` and `bounced`/`created → terminal`. Do NOT bake a `terminal=…` field into the marker — if a kind's terminal-ness ever changes (e.g. making `bounced` re-openable later), that is a change to the TRIAGE only, and old markers stay valid.

Marker shape (DECIDED): a hidden HTML comment whose namespace is built from `brand.base` (today `agent-runner`, exactly like `PROCESSING_LOCK_LABEL` = `${brand.base}:processing`), so a rebrand updates it automatically:

- `<!-- ${brand.base}:intake kind=ask -->`
- `<!-- ${brand.base}:intake kind=bounced -->`
- `<!-- ${brand.base}:intake kind=created slug=<slug> -->`

Hidden HTML comments render as NOTHING on GitHub (clean thread) but are present in the raw markdown `listComments` returns, so the triage parses them. The marker is provider-PORTABLE and is the SOLE recovery signal (no sidecar/cursor).

### The triage (deterministic; runs under the lock, before the prompt)

Given the issue + full thread:

1. **Last comment is INTAKE's** (the last comment carries a marker) → **SKIP** with outcome **`no-new-input`**. Intake has the last word — whether it is a pending `ask` awaiting an answer or a terminal turn, there is nothing new to act on. (Under the lock, a run only ever comments as its LAST action, so "last comment is intake's `ask`" always means "already asked, no human reply yet".) This makes intake SELF-TRIGGERING a no-op BY CONSTRUCTION — intake's own freshly-posted comment is always the last comment.
2. **Last comment is someone ELSE's** (no marker on the last comment) →
   - **the thread already contains a TERMINAL intake marker** (`bounced` / `created`) → **SKIP** with outcome **`already-terminal`**. The issue was already transformed; a later human comment does NOT re-open it (a future feature may; for now, skip).
   - **otherwise** (no terminal marker — fresh issue, or mid-`ask`-loop) → **PROCEED** to the decision: everything AFTER intake's last marker (there may be several human comments) is the new material; the prompt re-reads the FULL thread for context and judges.

Two NEW named terminal outcomes (siblings of `locked` — "ran, deliberately did nothing", distinct from "didn't run"): **`no-new-input`** (intake has the last word) and **`already-terminal`** (the issue was already transformed). Both exit 0, observable by CI + a human.

### Self-recognition is MARKER-ONLY (DECIDED 2026-06-10)

Intake recognises its own comments by the MARKER ALONE — it does NOT resolve its own author identity. The marker already does everything (it is provider-portable and survives intake posting under a human's token), so author-identity would be redundant weight + a GitHub-ism. Resolving "who is intake" by author login is a CI SCHEDULING concern (CI may use it to decide whether to even schedule a run) — a SEPARATE thing, NOT part of the `intake` command. So the triage gate and any `classifyIntakeEvent` self-filter key on the MARKER, never on author identity: no `gh api user`, no bot-login config, no identity resolution through the seam in THIS slice.

The `classifyIntakeEvent` marker self-filter (ignore a new comment bearing the intake marker) is a SECONDARY optimisation — it lets a marker-aware CI skip even _scheduling_ a run for intake's own comment — but the triage gate is the real guard (intake is safe even if a run IS scheduled). Add it framed as the optimisation it is, not the load-bearing fix.

This stands alone (it fixes the existing ASK/BOUNCE self-loop) and is the foundation the completion-comment slice depends on (that slice just stamps a `created` marker, which this gate's `already-terminal` branch then consumes).

## Acceptance criteria

- [ ] Every comment intake posts (ask, bounce) carries the intake MARKER (hidden HTML comment, namespace `${brand.base}:intake`) recording its `kind` (`ask` / `bounced`), asserted at the stubbed issue seam. The marker stores the kind only — NOT a `terminal` flag.
- [ ] The terminal/non-terminal split lives in the TRIAGE (not the marker): `ask` non-terminal, `bounced`/`created` terminal. A test exercises the mapping via the triage outcomes, not a marker field.
- [ ] TRIAGE — last comment is intake's (any marker) → SKIP, outcome `no-new-input` (exit 0); the decision prompt does NOT run; nothing is emitted/posted. Test pins it (incl. the self-trigger case: intake's own just-posted comment).
- [ ] TRIAGE — last comment is a human AND a TERMINAL marker (`bounced`/`created`) exists earlier in the thread → SKIP, outcome `already-terminal` (exit 0); decision does NOT run. Test pins it.
- [ ] TRIAGE — last comment is a human AND no terminal marker (fresh, or mid-`ask`) → PROCEED: the decision runs and dispatches (the existing four-outcome behaviour). Test pins it (a human reply after an `ask` marker resumes).
- [ ] `no-new-input` and `already-terminal` are distinct named outcomes on `IntakeRunOutcome` (siblings of `locked`), surfaced in the result message; CLI maps them to a clean exit 0.
- [ ] `classifyIntakeEvent` `ignore`s a new comment bearing the intake MARKER — framed as the scheduling OPTIMISATION; a test pins it. (The triage gate, not this, is the safety mechanism.) Keyed on the MARKER, NOT author identity.
- [ ] Self-recognition is MARKER-ONLY: the slice resolves NO author identity (no `gh api user`, no bot-login config, no identity through the seam) — author-based recognition is a CI concern, out of scope here.
- [ ] No persisted state / cursor file — recovery is from the thread MARKER only (status = the thread, not a sidecar; the contract's "no shared index" spirit).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — can start immediately (it fixes existing intake; it does not depend on the `issue:`-field or completion-comment slices).

## Decisions (resolved 2026-06-10 — no open questions)

- **Self-recognition is MARKER-ONLY.** Intake does NOT resolve its own author identity; the marker is sufficient (provider-portable, survives posting under a human's token). Author-based recognition is a CI SCHEDULING concern, not part of the `intake` command — explicitly out of scope here.
- **Marker = hidden HTML comment, namespace from `brand.base`.** `<!-- ${brand.base}:intake kind=ask|bounced|created [slug=<slug>] -->` (today `agent-runner:intake`), built from `brand.base` exactly like `PROCESSING_LOCK_LABEL`, so a rebrand updates it. Hidden (invisible in rendered GitHub), parseable from raw markdown.
- **`kind` vocabulary = `ask` / `bounced` / `created` (complete).** The marker records the kind as a NEUTRAL FACT; the TRIAGE owns whether a kind is terminal (`ask` non-terminal; `bounced`/`created` terminal). No `terminal` field in the marker — re-classifying a kind later is a triage change, old markers stay valid.

## Prompt

> Give intake a DETERMINISTIC pre-decision TRIAGE GATE built on a MARKER stamped on every comment intake posts, so it skips when it has the last word or the issue is already terminal, and runs the prompt ONLY on genuine new human input. PRD: `work/prd-sliced/issue-intake.md`. This also fixes a PRE-EXISTING hazard: intake's own comments are `issue-comment-created` events that `classifyIntakeEvent` re-evaluates with no self-filter → intake can re-trigger itself.
>
> DRIFT CHECK FIRST: confirm there is still NO marker / bot-identity / cursor in `src/intake.ts` + `src/intake-event.ts`, and `classifyIntakeEvent` maps `issue-comment-created` → `re-evaluate` unconditionally. If a triage gate / marker already exists, re-scope.
>
> The DECISIONS are settled (see the slice's Decisions block): marker-only self-recognition (NO author identity — that is CI's concern); marker = hidden HTML comment `<!-- ${brand.base}:intake kind=ask|bounced|created [slug=<slug>] -->`; `kind` is a neutral fact, the TRIAGE owns terminal-ness (no `terminal` field in the marker).
>
> WHAT TO BUILD: (1) stamp the MARKER (recording `kind`, namespace from `brand.base`) on every comment intake posts; (2) a deterministic TRIAGE in the runner, under the lock, BEFORE `decideAndDispatch`: last comment is intake's (any marker) → SKIP `no-new-input`; else if a terminal marker (`bounced`/`created`) exists → SKIP `already-terminal`; else PROCEED to the decision (new human comments after the last marker are the material; the prompt re-reads the full thread); (3) the two new named outcomes (`no-new-input`, `already-terminal`) on `IntakeRunOutcome` + CLI exit-0 mapping; (4) the `classifyIntakeEvent` marker self-filter as a SECONDARY scheduling optimisation (the triage gate is the real guard). Resolve terminal-ness in the TRIAGE, never in the marker.
>
> SCOPE FENCE: no persisted cursor/sidecar (recover from the thread/marker only); MARKER-ONLY self-recognition — resolve NO author identity (no `gh api user` / bot-login / identity through the seam); core never imports `gh`. Do NOT build the completion comment here (dependent slice) — but make the marker mechanism reusable so that slice just adds a `created` marker, which the `already-terminal` branch then consumes. Do NOT make the `classifyIntakeEvent` filter the safety mechanism — the triage gate is. Do NOT put terminal-ness in the marker — the triage owns it.
>
> SEAM TO TEST AT: the stubbed issue seam (`postIssueComment` records the marker; `listComments` seeds threads with/without markers) + the triage's three branches (`no-new-input` / `already-terminal` / proceed) + `classifyIntakeEvent` (own-comment → ignore). The prompt JUDGEMENT is not unit-tested (PRD); only the triage + dispatch. Mirror the existing intake + intake-event tests.
>
> "Done" = intake skips (`no-new-input`) when it has the last word, skips (`already-terminal`) when the issue was already transformed, proceeds only on genuine new human input, cannot self-trigger, recovers from the thread marker (no sidecar), and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
