---
title: issue-provider must surface the REAL `gh` failure cause in createLabel + postIssueComment (no more hard-coded "not found" / "unavailable or unauthenticated" misattribution)
slug: issue-provider-surface-real-gh-cause
blockedBy: []
covers: []
---

## What to build

Finish the `ghFailureReason` treatment across `src/issue-provider.ts` (on the `GitHubIssueProvider` class) so EVERY `gh` failure is reported as its REAL cause, not a hard-coded guess. The label ops + comment poster are `private` methods on that class (`createLabel`, `mutateLabel`, `postIssueComment`, `closeIssue`); `ghFailureReason`/`isLabelNotFound` are module-level helpers. Two sibling paths still misattribute:

1. **`createLabel`** (the `private` method, returns `boolean`) discards the real `gh` stderr: on a non-`already-exists` failure (e.g. a token without label-create permission on a fresh repo) it returns `false`. Its caller `mutateLabel` (the create-on-first-use retry block: `isLabelNotFound` → `createLabel` → retry) then surfaces the ORIGINAL add failure (`'<label>' not found`) — so a permission-denied CREATE is reported as the fresh-repo SYMPTOM (`not found`) instead of the true cause (`does not have the correct permissions to execute AddLabelsToLabelable`).

2. **`postIssueComment`** (the `private` method) hard-codes `"gh is unavailable or unauthenticated"` in its degrade branch for ANY failure (`result === undefined || result.status !== 0` — so rate-limit, permissions, transient 5xx, deleted issue all read as auth) — the exact misattribution already removed from `mutateLabel` (which now uses `ghFailureReason`). It is also a **contagion source**: sibling seam methods are told to "mirror `postIssueComment`", so the stale string nearly infected the new `closeIssue`.

The fix is the SAME treatment the `mutateLabel`/lock fix already applied (`intake-lock-failure-semantics-and-real-cause`, in `done/`): thread `ghFailureReason(result)` (the captured real `gh` stderr) through both paths so the operator is told what actually failed.

### Precise scope

- **`createLabel`**: stop collapsing a failure to a bare `false` that throws away stderr. Surface the failure reason (return the `RunResult`/a reason, or thread `ghFailureReason(createResult)`) so `mutateLabel` can report the CREATE's real cause when the create fails for any reason OTHER than `already exists`. Keep `already exists` → success and missing-`gh` → degrade behaviours UNCHANGED.
- **`postIssueComment`**: replace the hard-coded `"gh is unavailable or unauthenticated"` degrade string with `ghFailureReason(result)` (the real cause), mirroring the corrected `mutateLabel`/`closeIssue`.
- **Sweep**: grep `issue-provider.ts` for any OTHER surviving hard-coded `gh`-cause guess and apply the same treatment (the note flagged `getLabels`/`mutateLabel` as already corrected — confirm, and catch any sibling that was missed).
- Behaviour otherwise unchanged: success paths, the `already exists` short-circuit, and the graceful never-hard-fail degrade posture all stay; only the FAILURE MESSAGE becomes honest.

## Acceptance criteria

- [ ] `createLabel` no longer discards its stderr on a non-`already-exists` failure: a permission-denied create surfaces the REAL `gh` cause through `mutateLabel`, NOT the stale `'<label>' not found`. Proven by a test that stubs a `gh label create` permission failure and asserts the reported reason is the create's real stderr.
- [ ] `postIssueComment`'s degrade branch reports `ghFailureReason(result)` (the real cause) instead of the hard-coded "unavailable or unauthenticated" string — proven by a test stubbing a non-auth `gh` comment failure and asserting the real cause is surfaced.
- [ ] `already exists` → success and missing-`gh` → degrade behaviours are unchanged (regression guard).
- [ ] No hard-coded `gh`-cause guess remains in `issue-provider.ts` (grep-clean for the stale strings).
- [ ] Tests mirror the repo's existing issue-provider test style (stubbed `gh` RunResults; no real network/`gh` invocation; no shared/global location touched).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. Independent; same mechanical family as the landed `intake-lock-failure-semantics-and-real-cause` fix (reuse its `ghFailureReason`).

## Prompt

> Finish the `ghFailureReason` treatment in `src/issue-provider.ts` so EVERY `gh` failure reports its REAL cause, not a hard-coded guess. The original lock fix (`work/done/intake-lock-failure-semantics-and-real-cause.md`) introduced `ghFailureReason(result)` and corrected `mutateLabel`/`getLabels`; TWO sibling paths still misattribute:
>
> 1. `createLabel` returns a bare `boolean` and THROWS AWAY the real `gh` stderr on a non-`already-exists` failure. Its caller `mutateLabel` (the fresh-repo create-on-first-use retry: `isLabelNotFound` → `createLabel` → retry) then surfaces the ORIGINAL `--add-label` failure (`'<label>' not found`) — so a permission-denied CREATE reads as the fresh-repo symptom (`not found`) instead of the truth (`0xronan7 does not have the correct permissions to execute AddLabelsToLabelable`). Make `createLabel` surface its failure reason (return the `RunResult`/reason, or thread `ghFailureReason(createResult)`) so `mutateLabel` reports the create's REAL cause when it fails for any reason other than `already exists`. Keep `already exists` → success and missing-`gh` → degrade unchanged.
> 2. `postIssueComment`'s degrade branch still hard-codes `"\`gh\` is unavailable or unauthenticated"` for ANY failure — the SAME misattribution removed from `mutateLabel`. It is a contagion source (sibling methods are told to "mirror `postIssueComment`"; it nearly infected `closeIssue`). Replace it with `ghFailureReason(result)` (the real cause).
>
> Then grep `issue-provider.ts` for any OTHER surviving hard-coded `gh`-cause guess and apply the same treatment.
>
> READ FIRST: `src/issue-provider.ts` — `createLabel()` (bare-boolean return), `mutateLabel()` (the create-on-first-use retry block + how it already uses `ghFailureReason`), `postIssueComment()` (the hard-coded degrade string), `closeIssue()` (the recently-fixed sibling that uses `ghFailureReason` — the model to match); `work/done/intake-lock-failure-semantics-and-real-cause.md` (the original fix that introduced `ghFailureReason`).
>
> SEAM TO TEST AT: the existing issue-provider tests (stub `gh` RunResults — a permission-denied `gh label create`, a non-auth `gh issue comment` failure — assert the surfaced reason is the real stderr, NOT the stale `not found` / `unavailable or unauthenticated`). No real `gh`/network.
>
> SCOPE FENCE: do NOT change success paths, the `already exists` short-circuit, or the never-hard-fail degrade posture — only make the FAILURE message honest. Do NOT touch `closeIssue` (already correct) beyond using it as the pattern.
>
> FIRST run the drift check (launch snapshot): confirm `createLabel` still returns a bare boolean and `postIssueComment` still hard-codes the string. If a prior fix already corrected either, narrow this slice to whatever remains (or route to `needs-attention/` if both are already fixed).
>
> "Done" = both paths surface the real `gh` cause, no hard-coded guess remains in `issue-provider.ts`, tests cover both, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

## Source

Promotes two observations (2026-06-10): `createlabel-failure-masked-by-original-not-found-on-permission-denied` and `issue-provider-hardcoded-gh-unauth-string-survives-in-comment-and-comment-paths`. Both are the same `ghFailureReason` family as the landed `intake-lock-failure-semantics-and-real-cause` fix.

---

### Claiming this slice

```sh
dorfl claim issue-provider-surface-real-gh-cause --arbiter origin
git fetch origin && git switch -c work/issue-provider-surface-real-gh-cause origin/main
git mv work/in-progress/issue-provider-surface-real-gh-cause.md work/done/issue-provider-surface-real-gh-cause.md
```
