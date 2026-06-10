---
title: intake-closes-issue-on-bounce — a BOUNCE is terminal, so intake CLOSES the issue (not just comments): add closeIssue to the issue seam + close on bounce; supersedes the PRD's "intake never closes / leave open" lines for the bounce case
slug: intake-closes-issue-on-bounce
prd: issue-intake
blockedBy: []
covers: [5]
---

> Derives from the `issue-intake` PRD; it REVISES that PRD's BOUNCE decision (and the repeated "intake never closes the issue" statements) for the BOUNCE case ONLY. Source: the intake review session 2026-06-10 (maintainer decided bounce is terminal → an open issue is a dishonest signal → intake closes it).

## What to build

**The reversal (maintainer decision, 2026-06-10):** a BOUNCE is TERMINAL (intake is done with the issue — the asks are unrelated and must be re-filed separately). Leaving the issue OPEN after a bounce is a dishonest signal ("still in play") when intake is finished. So on BOUNCE, intake **CLOSES the issue** after posting the "file separate issues" comment.

This SUPERSEDES, for the BOUNCE case only, the PRD's stated invariant "intake never closes the issue; closing is CI's close-job" and the BOUNCE row's "leave the issue OPEN". Those remain true for SLICE / PRD outcomes (CI's merge-to-main close-job closes those via the `issue:` field; see `slice-level-issue-field-for-lone-issue-derived-slice`). The split is now:

- **bounce** → intake closes the issue DIRECTLY (it is terminal + needs no further work tracked in `work/`).
- **slice / prd** → intake does NOT close; the FUTURE CI close-job closes when the work lands (folder+field state). Intake's completion comment (`intake-posts-completion-comment-on-slice-prd-outcomes`) stays informational, never closing.
- **ask** → never closes (the loop continues).

Build:

- **Extend the issue seam with `closeIssue`** (`IssueProvider`): close an issue by number. GitHub adapter shells out (`gh issue close <N>` [+ an optional reason/comment]); the core never imports `gh` (same boundary as the other seam methods). It DEGRADES (never throws) on a missing/unauthenticated `gh` — same advisory discipline as `postIssueComment` (the bounce comment is the load-bearing user signal; the close is best-effort on top). The RUNNER calls it; the agent stays seam-free.
- **Bounce dispatch closes the issue** — in `dispatchComment` (the `outcome:'bounced'` path, `src/intake.ts`): after posting the bounce comment, call `closeIssue`. (The comment must be posted FIRST so the "file separate issues" guidance is visible on the closed issue.) A close degrade does not change the run's terminal outcome (still `bounced`, exit 0); it is surfaced honestly in the `note`/result.
- **Correct the `issue-intake` PRD** (`work/prd-sliced/issue-intake.md`): the BOUNCE decision-table row ("leave the issue OPEN"), the "Loop closure" / "intake never closes the issue" lines, and the Out-of-Scope `closeIssue`/CI-only framing \u2014 amend them to the settled split (bounce → intake closes directly; slice/prd → CI close-job; ask → never). `closeIssue` is no longer exclusively CI's: intake owns the bounce-close; CI owns the slice/prd close. Fix in place (the PRD is in `work/prd-sliced/`; this is a deliberate, recorded reversal).
- **Reconcile the in-code "never closes" statements** (`src/intake.ts`): the decision-table doc-comment (BOUNCE row), the `dispatchPrd`/`integrationToIntakeResult` "intake never closes the issue" comment, and the decision-prompt's BOUNCE line ("leaves the issue OPEN ... never closes") \u2014 update to "intake closes on BOUNCE; never on slice/prd/ask".

Relation to the other slices: `intake-self-awareness-resumption-tracking` classifies `bounced` as TERMINAL (its `already-terminal` triage branch) \u2014 this slice is the OTHER half of "bounce is terminal": the terminal CLASSIFICATION (C) + the terminal ACTION, closing the issue (this slice). They are independent (C governs re-trigger/skip; this governs the close side-effect) so neither blocks the other, but they express the same decision and should land together.

## Acceptance criteria

- [ ] The issue seam gains `closeIssue` (`IssueProvider`); the GitHub adapter is the only place that shells out (`gh issue close`); the core never imports `gh`. It DEGRADES (no throw) on a missing/unauthenticated `gh`, surfacing the reason \u2014 mirroring `postIssueComment`.
- [ ] On a BOUNCE, intake posts the "file separate issues" comment AND THEN closes the issue (comment first, then close), asserted at the stubbed seam (comment recorded; close recorded; order pinned).
- [ ] A close DEGRADE (gh missing/unauth) does NOT change the terminal outcome (`bounced`, exit 0) and is surfaced honestly; the bounce comment still posts.
- [ ] Intake does NOT close on `ask` / `slice` (`sliced`) / `prd` outcomes (tested) \u2014 only `bounce`. The slice/prd completion path stays comment-only (CI's close-job closes those later).
- [ ] The `issue-intake` PRD is amended to the settled split (bounce → intake closes; slice/prd → CI close-job; ask → never); the in-code "intake never closes the issue" / "leave the issue OPEN" statements are corrected to match.
- [ ] The RUNNER performs the close (the agent stays seam-free).
- [ ] Tests STUB `gh` via the injectable `ghBin` and the stubbed issue seam (no network); mirror the existing intake tests.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None \u2014 can start immediately. (Independent of the self-awareness + completion-comment + `issue:`-field slices; it touches the seam + the bounce dispatch. Expresses the same "bounce is terminal" decision as `intake-self-awareness-resumption-tracking` and should land together with it.)

## Prompt

> Make a BOUNCE close the issue. Maintainer decision (2026-06-10): a bounce is TERMINAL \u2014 the asks are unrelated and must be re-filed separately \u2014 so an OPEN issue is a dishonest \"still in play\" signal; intake CLOSES it. This REVERSES, for the BOUNCE case only, the `issue-intake` PRD's \"intake never closes the issue / leave the issue OPEN\". PRD: `work/prd-sliced/issue-intake.md`.
>
> DRIFT CHECK FIRST: confirm `closeIssue` is still NOT on the `IssueProvider` interface (`src/issue-provider.ts`), the bounce path (`dispatchComment`, `outcome:'bounced'`, `src/intake.ts`) still only posts a comment and leaves the issue open, and the \"never closes the issue\" / \"leave the issue OPEN\" statements still stand in the decision-table doc-comment + `integrationToIntakeResult` comment + the decision prompt. If `closeIssue`/bounce-close already exists, re-scope.
>
> WHAT TO BUILD: (1) add `closeIssue` to the issue seam (`IssueProvider`), implemented in the GitHub adapter via `gh issue close` (core never imports `gh`); it DEGRADES like `postIssueComment` (never throws, surfaces the reason); (2) in the bounce dispatch, POST the comment first, THEN `closeIssue`; a close degrade keeps the outcome `bounced`/exit 0; (3) intake closes ONLY on bounce \u2014 NOT on ask/slice/prd; (4) amend the PRD (BOUNCE row, Loop-closure, Out-of-Scope) to the split bounce\u2192intake-closes / slice-prd\u2192CI-close / ask\u2192never, and reconcile the in-code \"never closes\" statements.
>
> SCOPE FENCE: ONLY bounce closes. Do NOT close on slice/prd (that is the future CI close-job's via the `issue:` field). Do NOT build the CI close-job. The agent stays seam-free \u2014 the RUNNER closes. `closeIssue` degrades, never throws (the comment is the load-bearing signal; the close is best-effort on top).
>
> SEAM TO TEST AT: the stubbed issue seam (`postIssueComment` + `closeIssue` recorded, order pinned) + the GitHub adapter with a stubbed `ghBin` (`gh issue close` shelled, degrades on missing `gh`). Assert: bounce \u2192 comment-then-close; close degrade \u2192 still `bounced`/exit 0, surfaced; ask/slice/prd \u2192 no close. Mirror the existing intake tests.
>
> \"Done\" = a bounce closes the issue (comment first), slice/prd/ask never close, the close degrades cleanly, the PRD + in-code statements are reconciled, and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
