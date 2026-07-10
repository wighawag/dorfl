---
title: intake-closes-issue-on-bounce — a BOUNCE is terminal, so intake CLOSES the issue (atomically, with the bounce text as the closing comment + reason "not planned"); supersedes the SPEC's "intake never closes / leave open" lines for the bounce case
slug: intake-closes-issue-on-bounce
spec: issue-intake
blockedBy: []
covers: [5]
---

> Derives from the `issue-intake` SPEC; it REVISES that SPEC's BOUNCE decision (and the repeated "intake never closes the issue" statements) for the BOUNCE case ONLY. Source: the intake review session 2026-06-10 (maintainer: bounce is terminal → an open issue is a dishonest signal → intake closes it, atomically, as "not planned").

## What to build

**The reversal (maintainer decision, 2026-06-10):** a BOUNCE is TERMINAL (intake is done — the asks are unrelated and must be re-filed separately). Leaving the issue OPEN after a bounce is a dishonest "still in play" signal, so on BOUNCE intake **CLOSES the issue** \u2014 atomically carrying the "file separate issues" text as the CLOSING COMMENT and `reason: not planned` (a bounce is precisely _not planned_ \u2014 the honest GitHub-native signal, rendered distinct from a "completed" close).

This SUPERSEDES, for the BOUNCE case only, the SPEC's invariant "intake never closes the issue" + the BOUNCE row's "leave the issue OPEN". It stays true for SLICE / SPEC (CI's close-job closes those via the `issue:` field) and ASK (never closes). The settled split:

- **bounce** \u2192 intake closes the issue DIRECTLY (atomic: comment + `not planned` + close).
- **slice / spec** \u2192 intake does NOT close; the FUTURE CI close-job closes via the `issue:` field. Intake's completion comment (`intake-posts-completion-comment-on-slice-prd-outcomes`) stays informational, never closing.
- **ask** \u2192 never closes (the loop continues).

Build:

- **Extend the issue seam with an ATOMIC `closeIssue`** (`IssueProvider`): `closeIssue({issueNumber, comment?, reason?})` \u2014 close an issue, OPTIONALLY posting a closing comment and setting a close reason IN THE SAME operation. GitHub adapter shells out `gh issue close <N> [--comment <body>] [--reason "not planned"]` (verified: `gh issue close` supports `--comment` + `--reason {completed|not planned|duplicate}`). Doing it in ONE call is the point: a separate post-then-close has a partial-failure window (comment posts, close fails \u2192 the dishonest open-with-bounce-comment state we are closing TO AVOID); the atomic close has no such window. `comment`/`reason` are GitHub-isms \u2014 the INTERFACE carries them provider-neutrally; a non-GitHub adapter maps/ignores `reason`. Core never imports `gh`.
- **DEGRADE on the REAL cause (not a hard-coded guess).** `closeIssue` NEVER throws on a missing/unauthenticated `gh`; it surfaces the ACTUAL `gh` stderr via the existing **`ghFailureReason(result)`** helper (`issue-provider.ts`) \u2014 NOT a copy of `postIssueComment`'s hard-coded "`gh` is unavailable or unauthenticated" string. (That hard-coded string is the SAME misattribution bug already fixed in `mutateLabel` \u2014 commit on 2026-06-10; do NOT propagate it into new code. See `work/observations/issue-provider-hardcoded-gh-unauth-string-survives-in-comment-and-comment-paths.md`.)
- **Bounce closes via the atomic call.** `dispatchComment` (`src/intake.ts`) is SHARED by `ask` and `bounce`. CONDITIONALLY, when `outcome === 'bounced'`, replace the `postIssueComment`-then-leave-open path with a single `closeIssue({issueNumber, comment: <bounce text>, reason: 'not planned'})`. The `ask` branch is UNCHANGED (still `postIssueComment`, issue stays open). A close DEGRADE does not change the terminal outcome (still `bounced`, exit 0); it is surfaced honestly.
- **Surface the close on the result.** Add an additive `closed?: boolean` to `IntakeResult` (mirroring the existing `commented?`), set true iff the issue was closed \u2014 so CI / callers can observe it.
- **Correct the `issue-intake` SPEC** (`work/spec-sliced/issue-intake.md`): the BOUNCE decision-table row ("leave the issue OPEN"), the "Loop closure" / "intake never closes the issue" lines, and the Out-of-Scope `closeIssue`/CI-only framing \u2014 amend to the settled split (bounce \u2192 intake closes directly as "not planned"; slice/spec \u2192 CI close-job; ask \u2192 never). `closeIssue` is no longer exclusively CI's. Fix in place (SPEC is in `work/spec-sliced/`; a deliberate, recorded reversal).
- **Reconcile the in-code "never closes" statements** (`src/intake.ts`): (i) the `dispatchComment` DOC-COMMENT ("The issue is left OPEN in BOTH cases ... closing the issue is NEVER `intake`'s") \u2014 the bluntest contradiction, it sits on the function this slice changes; (ii) the decision-table doc-comment BOUNCE bullet ("leave the issue OPEN ... never `intake`'s"); (iii) the `integrationToIntakeResult` "intake never closes the issue" comment; (iv) the decision-prompt BOUNCE line ("leaves the issue OPEN ... never closes the issue"). Update all four to "intake closes on BOUNCE (as not planned); never on slice/spec/ask".

Relation to the other slices: `intake-self-awareness-resumption-tracking` classifies `bounced` as TERMINAL (its `already-terminal` skip branch) \u2014 this slice is the OTHER half of "bounce is terminal": the terminal CLASSIFICATION (C, the skip side) + the terminal ACTION, closing the issue (this slice). Independent (C governs re-trigger/skip; this governs the close side-effect), so neither blocks the other, but they express ONE decision and should land together.

## Acceptance criteria

- [ ] The issue seam gains `closeIssue({issueNumber, comment?, reason?})` (`IssueProvider`); the GitHub adapter is the only place that shells out (`gh issue close <N> [--comment] [--reason "not planned"]`); the core never imports `gh`. ONE atomic call \u2014 no separate post-then-close.
- [ ] `closeIssue` DEGRADES (no throw) on a missing/unauthenticated `gh`, surfacing the REAL `gh` stderr via `ghFailureReason` \u2014 NOT a hard-coded "unavailable or unauthenticated" string. A test asserts the surfaced reason is the real cause, not the hard-coded guess.
- [ ] On a BOUNCE, intake makes ONE `closeIssue` call carrying the "file separate issues" text as `comment` and `reason: 'not planned'`, asserted at the stubbed seam (close recorded with comment + reason). No separate `postIssueComment` on the bounce path.
- [ ] The close is conditional on `outcome === 'bounced'` INSIDE the shared `dispatchComment`; the `ask` branch is UNCHANGED (still `postIssueComment`, issue left open). A test pins: `ask` \u2192 no close; `bounce` \u2192 close.
- [ ] A close DEGRADE (gh missing/unauth) does NOT change the terminal outcome (`bounced`, exit 0) and is surfaced honestly.
- [ ] Intake does NOT close on `ask` / `slice` (`sliced`) / `spec` (tested) \u2014 only `bounce`.
- [ ] `IntakeResult` gains an additive `closed?: boolean` (mirroring `commented?`), true iff the issue was closed; set on the bounce path.
- [ ] The `issue-intake` SPEC is amended to the settled split; ALL FOUR in-code "never closes" / "leave the issue OPEN" statements (the `dispatchComment` doc-comment, the decision-table doc, the `integrationToIntakeResult` comment, the decision prompt) are corrected to match.
- [ ] The RUNNER performs the close (the agent stays seam-free).
- [ ] Tests STUB `gh` via the injectable `ghBin` and the stubbed issue seam (no network); mirror the existing intake tests.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None \u2014 can start immediately. (Independent of the self-awareness + completion-comment + `issue:`-field slices; it touches the seam + the bounce branch of the shared `dispatchComment`. Expresses the same "bounce is terminal" decision as `intake-self-awareness-resumption-tracking` and should land together with it.)

## Prompt

> Make a BOUNCE close the issue ATOMICALLY. Maintainer decision (2026-06-10): a bounce is TERMINAL \u2014 the asks are unrelated and must be re-filed \u2014 so an OPEN issue is a dishonest "still in play" signal; intake CLOSES it, carrying the bounce text as the closing comment and `reason: not planned` (the honest GitHub-native signal). This REVERSES, for BOUNCE only, the SPEC's "intake never closes / leave the issue OPEN". SPEC: `work/spec-sliced/issue-intake.md`.
>
> DRIFT CHECK FIRST: confirm `closeIssue` is still NOT on `IssueProvider` (`src/issue-provider.ts`), the bounce path (`dispatchComment`, `outcome:'bounced'`, `src/intake.ts`) still only posts a comment + leaves the issue open, and the "never closes" / "leave OPEN" statements still stand in (i) the `dispatchComment` doc-comment, (ii) the decision-table doc, (iii) `integrationToIntakeResult`, (iv) the decision prompt. If `closeIssue`/bounce-close already exists, re-scope.
>
> WHAT TO BUILD: (1) add `closeIssue({issueNumber, comment?, reason?})` to the issue seam, GitHub adapter via `gh issue close <N> [--comment <body>] [--reason "not planned"]` (ONE atomic call \u2014 NOT post-then-close; the atomicity removes the comment-posted-but-close-failed window); core never imports `gh`; (2) DEGRADE via `ghFailureReason` surfacing the REAL `gh` stderr \u2014 do NOT copy `postIssueComment`'s hard-coded "unavailable or unauthenticated" string (that is the misattribution bug already fixed in `mutateLabel`); (3) in the SHARED `dispatchComment`, conditionally on `outcome === 'bounced'` call `closeIssue` with the bounce text + `reason: 'not planned'` \u2014 leave the `ask` branch unchanged; (4) add additive `closed?: boolean` to `IntakeResult`; (5) amend the SPEC + reconcile ALL FOUR in-code "never closes"/"leave open" statements.
>
> SCOPE FENCE: ONLY bounce closes. Do NOT close on ask/slice/spec (slice/spec is the future CI close-job's via the `issue:` field). Do NOT build the CI close-job. The agent stays seam-free \u2014 the RUNNER closes. `closeIssue` degrades (real-cause surfaced), never throws. Do NOT copy `postIssueComment`'s hard-coded gh-unauth string.
>
> SEAM TO TEST AT: the stubbed issue seam (`closeIssue` recorded with comment + reason; `postIssueComment` NOT called on bounce) + the GitHub adapter with a stubbed `ghBin` (`gh issue close --comment --reason` shelled; degrades on missing `gh` surfacing the real stderr). Assert: bounce \u2192 one atomic close (comment + not-planned); close degrade \u2192 still `bounced`/exit 0, real cause surfaced; ask \u2192 no close, comment only; slice/spec \u2192 no close. Mirror the existing intake tests.
>
> "Done" = a bounce atomically closes the issue (bounce text as closing comment, reason not planned), slice/spec/ask never close, the close degrades on the REAL cause (no hard-coded guess), the SPEC + all four in-code statements are reconciled, and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
