---
title: intake-self-awareness-resumption-tracking — a deterministic pre-decision triage gate (read intake's own MARKER on the thread) so intake skips when it has the last word or the issue is already terminal, and only runs the prompt on genuine new human input
slug: intake-self-awareness-resumption-tracking
prd: issue-intake
blockedBy: []
covers: [2, 10]
---

> Derives from the `issue-intake` PRD (the ASK loop "resumes from the updated thread"; US #2 = ask-until-clear via conversation; US #10 = serialise concurrent runs). Surfaced 2026-06-10 while specifying the completion-comment slice: intake has NO concept of its own prior turns, which is a latent loop hazard for the ASK loop TODAY (not just for the new completion comment).

## What to build

Intake is stateless per run: the decision prompt (`buildIntakeDecisionBrief`, `src/intake.ts`) is handed the WHOLE comment thread with **no idea which comments are intake's own**. There is **no marker, no bot-identity, no cursor** anywhere in intake (verified 2026-06-10). Consequence: every comment intake POSTS (ask, bounce, and the proposed completion comment) is itself a new thread comment, so under a comment-trigger a naive re-run reads its OWN comment as a new turn → a re-process loop.

The TRIAGE GATE below is the COMPLETE fix for this (intake is safe even if a run IS scheduled). NOTE on scope: a separate CI-side "don't even SCHEDULE a run for intake's own comment" optimisation is deliberately NOT built here — it belongs to `runner-in-ci`, which owns the trigger/event policy. In particular this slice does NOT touch `classifyIntakeEvent` (`src/intake-event.ts`): that classifier is DELIBERATELY minimal (`IntakeEvent` carries `{kind}` only — "no author, no CI trigger policy, that is `runner-in-ci`'s"), and a marker self-filter would require widening it with the comment body, breaking that contract for a non-load-bearing optimisation. The triage gate makes it unnecessary.

The fix is a **deterministic PRE-DECISION TRIAGE GATE** in the runner (inside the processing lock, BEFORE `decideAndDispatch`), built on ONE primitive: a machine-readable **MARKER** stamped on every comment intake posts. The marker records ONLY a neutral **kind** (a fact about what intake did) — it does NOT encode policy:

- `kind=ask` — intake asked a clarifying question.
- `kind=bounced` — intake bounced the issue.
- `kind=created slug=<slug>` — intake created a slice/PRD.

**Whether a kind is TERMINAL is the TRIAGE's interpretation, NOT data in the marker** (decided 2026-06-10). The marker is a neutral record ("intake did X"); the triage maps `ask → non-terminal` and `bounced`/`created → terminal`. Do NOT bake a `terminal=…` field into the marker — if a kind's terminal-ness ever changes (e.g. making `bounced` re-openable later), that is a change to the TRIAGE only, and old markers stay valid.

The marker ALSO records **which comments intake had SEEN** when it decided — by their **ids** (`seen=<id>,<id>,…`). This closes a RACE (a comment landing between intake's READ and its POST) AND lets intake notice a previously-seen comment was DELETED (see the triage). Ids (not a count) because a count cannot tell "a new comment appeared" from "an old one was deleted"; ids distinguish both directions exactly.

**Seam change (REQUIRED, additive):** `IssueComment` (`issue-provider.ts`) today carries only `author?` + `body` (verified 2026-06-10). Add **`id`** (and `createdAt` for ordering robustness) — both are in `gh issue view --json comments` already; `normaliseComments` must surface them; the stub seam seeds them. Additive, so no existing reader breaks.

**Marker stores the per-run DELTA, not the whole set (the CHAIN model).** Each marker records ONLY the ids intake newly read THIS run; the full `seenSet` = the UNION of every intake marker's id-list already in the thread (the triage scans all intake markers anyway). So a marker stays bounded by per-run new comments rather than growing with the whole thread, and the total information is the same.

Marker shape (DECIDED): a hidden HTML comment whose namespace is built from `brand.base` (today `agent-runner`, exactly like `PROCESSING_LOCK_LABEL` = `${brand.base}:processing`), so a rebrand updates it automatically:

- `<!-- ${brand.base}:intake kind=ask seen=412,418 -->`
- `<!-- ${brand.base}:intake kind=bounced seen=503 -->`
- `<!-- ${brand.base}:intake kind=created slug=<slug> seen=601,602 -->`

(`seen=` lists the comment ids intake READ this run — the per-run delta.) Hidden HTML comments render as NOTHING on GitHub (clean thread) but are present in the raw markdown `listComments` returns, in each comment's `body` — so the triage detects + parses the marker out of `IssueComment.body` (it is body text, NOT a separate field). The marker is provider-PORTABLE and is the SOLE recovery signal (no sidecar/cursor).

### The triage (deterministic; runs under the lock, before the prompt)

Given the issue + full thread:

1. **Last comment is INTAKE's** (the last comment carries a marker). Build `seenSet` = the UNION of every intake marker's `seen=` id-list in the thread, then:
   - **PRIMARY CHECK — is there an UNSEEN comment?** Take the comments before intake's last marker; if ANY has an id NOT in `seenSet` (a comment that landed after intake read but before it posted) → **do NOT skip → PROCEED**. The raced comment(s) are given to the prompt WITH their ordering known: they PRE-DATE intake's last turn (possibly concurrent), so treat them as possibly-already-addressed context for a PRIOR state — NOT necessarily a direct answer to intake's latest `ask`.
     - **DELETION ENRICHMENT (only on this proceed path):** ALSO compute `seenSet − currentThreadIds`; if non-empty, a comment intake PREVIOUSLY SAW has been deleted → tell the prompt "N previously-seen comment(s) were deleted; do not assume your prior reasoning's premises still hold" (a FLAG + COUNT — the deleted bodies are gone and not recoverable; do not try to name them). This is NOT a standalone wake trigger — it is computed ONLY because we are already proceeding for an unseen comment.
   - **otherwise** (every comment before intake's marker is in `seenSet`) → **SKIP** with outcome **`no-new-input`**. Intake has the last word and saw everything up to it. We do NOT hunt for deletions here — a deletion with no NEW comment is not a turn worth waking for (it resolves naturally whenever the user next comments). This makes intake SELF-TRIGGERING a no-op BY CONSTRUCTION (intake's own freshly-posted comment is the last, and its own `seen` covers what it just read).
2. **Last comment is someone ELSE's** (no marker on the last comment) →
   - **the thread already contains a TERMINAL intake marker** (`bounced` / `created`) → **SKIP** with outcome **`already-terminal`**. The issue was already transformed; a later human comment does NOT re-open it (a future feature may; for now, skip).
   - **otherwise** (no terminal marker — fresh issue, or mid-`ask`-loop) → **PROCEED** to the decision: everything AFTER intake's last marker (there may be several human comments) is the new material; the prompt re-reads the FULL thread for context and judges.

Two NEW named terminal outcomes (siblings of `locked` — "ran, deliberately did nothing", distinct from "didn't run"): **`no-new-input`** (intake has the last word) and **`already-terminal`** (the issue was already transformed). Both exit 0, observable by CI + a human.

### Self-recognition is MARKER-ONLY (DECIDED 2026-06-10)

Intake recognises its own comments by the MARKER ALONE — it does NOT resolve its own author identity. The marker already does everything (it is provider-portable and survives intake posting under a human's token), so author-identity would be redundant weight + a GitHub-ism. Resolving "who is intake" by author login is a CI SCHEDULING concern, NOT part of the `intake` command — explicitly out of scope here.

This stands alone (it fixes the existing ASK/BOUNCE self-loop) and is the foundation the completion-comment slice depends on (that slice just stamps a `created` marker, which this gate's `already-terminal` branch then consumes).

## Acceptance criteria

- [ ] `IssueComment` gains `id` (+ `createdAt`) and `normaliseComments` surfaces them from `gh issue view --json comments` (additive — no existing reader breaks); the stub seam seeds ids. A test pins ids are parsed.
- [ ] Every comment intake posts (ask, bounce) carries the intake MARKER (hidden HTML comment, namespace `${brand.base}:intake`) recording its `kind` (`ask` / `bounced`) AND `seen=<id>,<id>,…` (the ids intake newly READ this run — the per-run delta), asserted at the stubbed seam. The marker stores `kind` + `seen` only — NOT a `terminal` flag.
- [ ] The terminal/non-terminal split lives in the TRIAGE (not the marker): `ask` non-terminal, `bounced`/`created` terminal. A test exercises the mapping via the triage outcomes, not a marker field.
- [ ] `seenSet` is the UNION of every intake marker's `seen=` id-list in the thread (the chain model — markers store per-run deltas, the triage unions them). A test with two prior intake markers pins the union.
- [ ] TRIAGE — last comment is intake's AND every comment before it is in `seenSet` (nothing unseen) → SKIP, outcome `no-new-input` (exit 0); the prompt does NOT run; nothing emitted/posted; NO deletion hunt. Test pins it (incl. the self-trigger case: intake's own just-posted comment).
- [ ] RACE — last comment is intake's BUT a comment before its marker has an id NOT in `seenSet` (read-then-someone-commented-then-posted) → PROCEED; the prompt receives the raced comment(s) flagged as PRE-DATING intake's last turn (context for a prior state, not a fresh answer). Test pins it.
- [ ] DELETION (enrichment, only on the race/proceed path) — when proceeding for an unseen comment, if `seenSet − currentThreadIds` is non-empty (a previously-seen comment was deleted) the prompt is told "N previously-seen comment(s) were deleted; reassess" (flag + count, no naming gone bodies). A deletion ALONE (no unseen comment) does NOT wake intake (still `no-new-input`). Test pins both: deletion+unseen → proceed-with-flag; deletion-only → skip.
- [ ] TRIAGE — last comment is a human AND a TERMINAL marker (`bounced`/`created`) exists earlier in the thread → SKIP, outcome `already-terminal` (exit 0); decision does NOT run. Test pins it.
- [ ] TRIAGE — last comment is a human AND no terminal marker (fresh, or mid-`ask`) → PROCEED: the decision runs and dispatches (the existing four-outcome behaviour). Test pins it (a human reply after an `ask` marker resumes).
- [ ] `no-new-input` and `already-terminal` are distinct named outcomes on `IntakeRunOutcome` (siblings of `locked`), surfaced in the result message; CLI maps them to a clean exit 0.
- [ ] The marker is detected + parsed out of `IssueComment.body` (body text, not a separate field); a test pins marker parsing from a body.
- [ ] Self-recognition is MARKER-ONLY: the slice resolves NO author identity (no `gh api user`, no bot-login config) AND does NOT touch `classifyIntakeEvent` (no marker self-filter — the triage gate is the complete safety mechanism; CI-side scheduling is `runner-in-ci`'s).
- [ ] No persisted state / cursor file — recovery is from the thread MARKER only (status = the thread, not a sidecar; the contract's "no shared index" spirit).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — can start immediately (it fixes existing intake; it does not depend on the `issue:`-field or completion-comment slices).

## Decisions (resolved 2026-06-10 — no open questions)

- **Self-recognition is MARKER-ONLY.** Intake does NOT resolve its own author identity; the marker is sufficient (provider-portable, survives posting under a human's token). Author-based recognition is a CI SCHEDULING concern, not part of the `intake` command — explicitly out of scope here.
- **Marker = hidden HTML comment, namespace from `brand.base`.** `<!-- ${brand.base}:intake kind=ask|bounced|created [slug=<slug>] seen=<id>,<id>,… -->` (today `agent-runner:intake`), built from `brand.base` exactly like `PROCESSING_LOCK_LABEL`, so a rebrand updates it. Hidden (invisible in rendered GitHub), parseable from raw markdown.
- **`kind` vocabulary = `ask` / `bounced` / `created` (complete).** The marker records the kind as a NEUTRAL FACT; the TRIAGE owns whether a kind is terminal (`ask` non-terminal; `bounced`/`created` terminal). No `terminal` field in the marker — re-classifying a kind later is a triage change, old markers stay valid.
- **The marker carries `seen=<id>,…` (comment IDS, per-run delta) to close BOTH the raced-comment race AND deletion detection.** Ids, not a count, because a count cannot distinguish "a new comment appeared" from "an old one was deleted"; ids do both via set arithmetic. Requires an ADDITIVE seam change: `IssueComment` gains `id` (+ `createdAt`), surfaced by `normaliseComments`.
- **CHAIN model:** each marker stores ONLY the ids read that run; `seenSet` = union of all intake markers' id-lists. Keeps each marker bounded by per-run new comments (not the whole thread) while preserving full information.
- **Deletion is an ENRICHMENT, never a wake trigger.** The PRIMARY check is "is there an unseen comment?" (thread − seenSet). Only WHEN already proceeding for an unseen comment does the triage also compute deleted-seen (seenSet − thread) to flag "reassess" to the prompt. A bare deletion (no new comment) does NOT wake intake — it resolves whenever the user next comments. Deleted bodies are gone; the prompt gets a flag + count, not the content.

## Prompt

> Give intake a DETERMINISTIC pre-decision TRIAGE GATE built on a MARKER stamped on every comment intake posts, so it skips when it has the last word or the issue is already terminal, and runs the prompt ONLY on genuine new human input. PRD: `work/prd-sliced/issue-intake.md`. This also fixes a PRE-EXISTING hazard: intake's own comments are new thread comments, so a naive re-run reads its OWN comment as a new turn → intake re-triggers itself. The TRIAGE GATE is the COMPLETE fix (do NOT add a `classifyIntakeEvent` self-filter — that classifier is deliberately `{kind}`-only; CI-side scheduling is `runner-in-ci`'s).
>
> DRIFT CHECK FIRST: confirm there is still NO marker / bot-identity / cursor in `src/intake.ts`. If a triage gate / marker already exists, re-scope.
>
> The DECISIONS are settled (see the slice's Decisions block): marker-only self-recognition (NO author identity, and do NOT touch `classifyIntakeEvent` — the triage gate is the complete guard, CI scheduling is `runner-in-ci`'s); marker = hidden HTML comment `<!-- ${brand.base}:intake kind=ask|bounced|created [slug=<slug>] seen=<id>,… -->`; `kind` is a neutral fact, the TRIAGE owns terminal-ness (no `terminal` field in the marker).
>
> WHAT TO BUILD: (0) ADDITIVE seam change — `IssueComment` gains `id` (+ `createdAt`), surfaced by `normaliseComments` from `gh issue view --json comments`; stub seeds ids; (1) stamp the MARKER (recording `kind` + `seen=<id>,…` = the ids read THIS run — the per-run delta, namespace from `brand.base`) on every comment intake posts; (2) a deterministic TRIAGE under the lock BEFORE `decideAndDispatch` — build `seenSet` = UNION of all intake markers' `seen=` lists, then: last comment is intake's → PRIMARY: any comment before its marker NOT in `seenSet` (raced-in) → PROCEED (feed it flagged as PRE-DATING; AND if `seenSet − thread` non-empty, flag "N previously-seen comments deleted; reassess"), else SKIP `no-new-input` (no deletion hunt); last comment is a human + a terminal marker (`bounced`/`created`) → SKIP `already-terminal`; else PROCEED; (3) the two new named outcomes (`no-new-input`, `already-terminal`) on `IntakeRunOutcome` + CLI exit-0 mapping. Resolve terminal-ness in the TRIAGE, never in the marker. Deletion is ENRICHMENT on the proceed path only, never a wake trigger. Do NOT touch `classifyIntakeEvent` — the triage gate is the complete guard.
>
> SCOPE FENCE: no persisted cursor/sidecar (recover from the thread/marker only); MARKER-ONLY self-recognition — resolve NO author identity (no `gh api user` / bot-login); core never imports `gh`. Do NOT touch `classifyIntakeEvent` / `IntakeEvent` (a marker self-filter would break its deliberate `{kind}`-only contract for a non-load-bearing optimisation; CI-side scheduling is `runner-in-ci`'s). Do NOT build the completion comment here (dependent slice) — but make the marker mechanism reusable (a shared stamp/parse helper producing the FULL grammar incl. `seen=`) so that slice just adds a `created` marker, which the `already-terminal` branch then consumes. Do NOT put terminal-ness in the marker — the triage owns it.
>
> SEAM TO TEST AT: the stubbed issue seam (`postIssueComment` records the marker; `listComments` seeds threads with ids, markers, raced-in and deleted comments) + the triage branches (`no-new-input` / race-proceed / deletion-enrichment / `already-terminal` / proceed) + the `seenSet` union across two markers + marker parse-from-`body`. The prompt JUDGEMENT is not unit-tested (PRD); only the triage + dispatch. Mirror the existing intake tests.
>
> "Done" = intake skips (`no-new-input`) when it has the last word, skips (`already-terminal`) when the issue was already transformed, proceeds only on genuine new human input, cannot self-trigger, recovers from the thread marker (no sidecar), and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
