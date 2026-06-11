---
title: GitHubProvider — surface the REAL `gh` failure cause in postPRComment + openRequest (drop the hard-coded "unavailable or unauthenticated" misattribution, mirroring the issue-provider fix)
slug: github-provider-surface-real-gh-cause
covers: []
blockedBy: []
---

> Self-contained off-path follow-up — derives from NO PRD (`covers: []`), so per `work/protocol/WORK-CONTRACT.md` it omits `prd:` and is its own source of truth. Source signal: `work/observations/github-provider-hardcoded-gh-unauth-string-in-pr-comment-and-create.md` (surfaced by the Gate-3 review of PR #66). It is the PR/review-surface COUNTERPART of the already-landed issue-surface fix `issue-provider-surface-real-gh-cause` (`work/done/`): the SAME diagnosability defect, the SAME fix shape, a DIFFERENT provider (`GitHubProvider` in `github.ts`, not `issue-provider.ts`). PR #66 correctly did NOT touch this — `github.ts` was out of its scope.

## What to build

`GitHubProvider` (the PR/review seam used by `do`/`run`/`complete`'s propose path) still hard-codes the misattribution **"`gh` is unavailable or unauthenticated"** on two degrade branches — so for ANY failure cause (a rate-limit, a permissions error, a transient 5xx), a human is sent chasing a phantom auth problem. The issue-surface sibling already removed exactly this string by surfacing the real `gh` stderr through a `ghFailureReason(result)` helper (with a missing-binary special case). Apply the SAME treatment here:

- **`postPRComment`'s degrade branch** (the `result === undefined || result.status !== 0` path — currently returns an `instruction` saying the review "was not posted as a comment on `<url>`" because "`gh` is unavailable or unauthenticated"): replace the hard-coded cause with the REAL reason. Keep the rest of the instruction (the "post it manually on `<url>`" guidance) intact.
- **`degrade(input, reason)`'s `reason === 'unavailable'` branch** — NOTE: the `unavailable`/`outage` split does NOT live inline in `openRequest`; it is in the private `degrade(input, reason)` helper (reached VIA `openRequest`'s failure path). The `unavailable` arm currently hard-codes "`gh` is unavailable or unauthenticated, so no PR was opened — open one manually…". Surface the real cause there instead. The sibling `outage` arm already says something honest; leave it UNCHANGED — only the `unavailable` arm hard-guesses.

**THE MISSING-BINARY SHARP EDGE (do not get this wrong — it is why the issue-side has a two-arm guard, not a bare `ghFailureReason` call).** `ghFailureReason(result: RunResult)` takes a NON-undefined `RunResult` — it reads `result.stderr`/`result.status`. But `github.ts`'s `runGh` returns `RunResult | undefined`, where `undefined` = the `gh` BINARY IS MISSING (spawn failed). `postPRComment`'s guard is `result === undefined || result.status !== 0`, so the degrade branch IS reachable with `result === undefined` — and `ghFailureReason(undefined)` would crash. Mirror the issue-side's exact idiom (`issue-provider.ts`): a TWO-ARM guard —

```
result === undefined
  ? '`gh` is not available (binary missing).'   // missing-binary special case (fixed string)
  : ghFailureReason(result)                      // the real gh stderr
```

Structural consequence for `openRequest`/`degrade`: `degrade` today receives only `reason`, NOT the `result`. To surface the real cause in the `unavailable` arm you must THREAD the failure detail into `degrade` (either pass the `RunResult | undefined` in, or resolve the reason-string at the `openRequest` call site and pass THAT) — pick whichever keeps `degrade`'s shape cleanest, and apply the same two-arm undefined-vs-`RunResult` guard. Do NOT call `ghFailureReason` on a possibly-undefined value.

**The design decision to make (and record in a `## Decisions` block):** `ghFailureReason` currently lives as a NON-exported local function in `issue-provider.ts`, and `github.ts` does not import it. Note the shared surface is BIGGER than just `ghFailureReason`: both providers now need the SAME `undefined`-→"binary missing" / else-`ghFailureReason` PAIR. Choose how to share:
- (a) export `ghFailureReason` from `issue-provider.ts` and import it in `github.ts` (you still re-write the undefined guard at each call site), OR
- (b) lift the WHOLE pair — the `undefined`-vs-`RunResult` resolution into a real-reason string — into a small shared helper both providers import (cleanest, since #2 makes the shared logic more than one function), OR
- (c) a sibling helper in `github.ts`.
Prefer (b), then (a); avoid (c) — duplicating re-creates the very drift this slice closes (the issue-side and PR-side would diverge on the next fix). Pick the least-surprising option for the module conventions; do NOT duplicate the logic.

Preserve the providers' existing posture: the `outage`-vs-`unavailable` split stays, and the degrade NEVER hard-fails (a `gh` problem must not crash the propose/review path — it degrades to a clear manual instruction, just now with the TRUE cause).

## Acceptance criteria

- [ ] `GitHubProvider.postPRComment`, on a `gh` failure, surfaces the REAL `gh` failure reason (the captured stderr, with the missing-binary special case) instead of the hard-coded "unavailable or unauthenticated" string — the rest of the "post it manually on `<url>`" guidance is unchanged.
- [ ] The `unavailable` arm of the private `degrade(input, reason)` helper (reached via `openRequest`) surfaces the REAL `gh` failure reason instead of the hard-coded string; the `outage` arm is unchanged.
- [ ] The missing-binary case is handled WITHOUT calling `ghFailureReason(undefined)`: a `result === undefined` (spawn failed / `gh` not on PATH) yields the fixed "`gh` is not available (binary missing)." string, and only a defined `RunResult` is passed to `ghFailureReason` — on BOTH `postPRComment` and the `degrade` `unavailable` arm (the two-arm guard, mirroring the issue-side).
- [ ] No occurrence of the literal "unavailable or unauthenticated" hard-guess survives in `github.ts` (grep is clean) — except where it is genuinely the real reported cause.
- [ ] The shared `ghFailureReason` logic is NOT duplicated: it is reused via export/shared-module (the chosen sharing approach recorded in a `## Decisions` block); the issue-side `issue-provider.ts` behaviour is unchanged.
- [ ] The degrade posture is preserved: a `gh` failure NEVER hard-fails the propose/review path — it degrades to a clear manual instruction carrying the true cause.
- [ ] Tests cover both sites AND both failure modes: (i) a `gh` failure with a non-auth stderr (rate-limit / permissions message) is surfaced verbatim — NOT misattributed to auth — for `postPRComment` and the `degrade` `unavailable` arm; (ii) the missing-`gh`-binary case (`runGh` → `undefined`) reads as the clear "binary missing" string on both, never crashing. Mirror the issue-provider test style. No shared/global location is touched (the providers shell out to a STUBBED `gh`; the real `gh`/network is never invoked).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. The issue-side counterpart (`issue-provider-surface-real-gh-cause`) is already in `work/done/`; this only reuses its `ghFailureReason` helper.

## Prompt

> Remove the hard-coded "`gh` is unavailable or unauthenticated" misattribution from `GitHubProvider` (`src/github.ts`) and surface the REAL `gh` failure cause instead — the PR/review-surface counterpart of the already-landed issue-surface fix. For ANY `gh` failure (rate-limit, permissions, transient 5xx) the user is currently told it is an auth problem and sent chasing a phantom; surface the actual `gh` stderr (with the missing-binary special case) like `issue-provider.ts` now does.
>
> Source: `work/observations/github-provider-hardcoded-gh-unauth-string-in-pr-comment-and-create.md` (READ IT FIRST). Counterpart slice (the template to mirror): `work/done/issue-provider-surface-real-gh-cause.md` and its introduction of `ghFailureReason` in `work/done/intake-lock-failure-semantics-and-real-cause.md`.
>
> TWO sites in `src/github.ts`: (1) `postPRComment`'s degrade branch (the `result === undefined || result.status !== 0` path — currently the "review was not posted as a comment on `<url>` … unavailable or unauthenticated" instruction); (2) the private `degrade(input, reason)` helper's `reason === 'unavailable'` arm (reached VIA `openRequest`'s failure path — NOT an inline branch in `openRequest`; the `unavailable`/`outage` split lives in `degrade`). Leave `degrade`'s `outage` arm alone (already honest). Replace ONLY the hard-coded cause, keeping the manual-fallback guidance and the never-hard-fail degrade posture intact.
>
> MISSING-BINARY SHARP EDGE: `ghFailureReason(result: RunResult)` needs a NON-undefined `RunResult`, but `runGh` returns `RunResult | undefined` (`undefined` = `gh` binary missing) and the degrade branches ARE reached with `undefined`. Do NOT call `ghFailureReason(undefined)` — it would crash. Mirror the issue-side's TWO-ARM guard: `result === undefined ? '\`gh\` is not available (binary missing).' : ghFailureReason(result)`. `degrade` today gets only `reason`, not the `result` — so THREAD the failure detail (the `RunResult | undefined`, or the pre-resolved reason string) into `degrade` to surface the real cause in its `unavailable` arm.
>
> DECISION (record in a `## Decisions` block): `ghFailureReason` is a NON-exported local function in `issue-provider.ts`, not imported in `github.ts` — AND the shared surface is bigger than just it (both providers need the same `undefined`→"binary missing" / else-`ghFailureReason` PAIR). SHARE it: prefer (b) lift the whole undefined-vs-`RunResult`→reason-string pair into a small shared helper both import; else (a) export `ghFailureReason` and re-write the undefined guard at each call site. Avoid (c) duplicating into `github.ts` (re-creates the drift this slice closes). Pick the least-surprising option for the module conventions here.
>
> READ FIRST: `src/github.ts` `postPRComment()` (~L283) + the private `degrade()` helper (~L338–L343, the `unavailable`/`outage` `cause` split with the surviving string) and `runGh()` (returns `RunResult | undefined`) — paths ~as of 2026-06-11, confirm before editing (monorepo paths under `packages/agent-runner/src/`); `src/issue-provider.ts` `ghFailureReason()` (~L677) AND its TWO-ARM call sites (~L374–378, ~L408–419, ~L443–455 — the `result === undefined ? 'binary missing' : ghFailureReason(result)` idiom to mirror).
>
> FIRST, check this slice against current reality (drift): confirm both hard-coded strings still survive in `github.ts` and that `ghFailureReason` still lives un-exported in `issue-provider.ts`. If the issue-side helper has already been lifted/exported, just reuse it; if `github.ts` has already been fixed, route to `needs-attention/` rather than building on a stale premise.
>
> TDD with vitest, house style (stub the `gh` shell-out; never invoke real `gh`/network): a non-auth `gh` failure (rate-limit / permissions stderr) is surfaced verbatim on BOTH branches (not misattributed to auth); the missing-`gh`-binary case still reads clearly; the degrade never hard-fails; `issue-provider.ts` behaviour is unchanged; real shared dirs untouched. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim github-provider-surface-real-gh-cause --arbiter origin
git fetch origin && git switch -c work/github-provider-surface-real-gh-cause origin/main
git mv work/in-progress/github-provider-surface-real-gh-cause.md work/done/github-provider-surface-real-gh-cause.md
```
