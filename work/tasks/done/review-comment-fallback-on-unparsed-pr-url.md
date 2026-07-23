---
title: 'review-comment-fallback-on-unparsed-pr-url — when `gh pr create` opens a PR but its URL can''t be parsed, the Gate-2 review comment is silently dropped; fall back to commenting on the branch''s PR instead of no-op''ing'
slug: review-comment-fallback-on-unparsed-pr-url
covers: []
---

> Self-contained correctness fix — derives from NO SPEC (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal: `work/observations/review-nits-review-gate-pr-comment-2026-06-07.md` (first nit). Delete that observation once this lands (the second nit in it — a test-control-strength suggestion — is benign; fold it in here too, see Scope).

## What to build

Close the audit-trail visibility gap where a Gate-2 review comment is **silently dropped** even though a PR was really opened. Today, when `gh pr create` succeeds (exit 0) but dorfl cannot PARSE the PR URL out of its stdout, the GitHub provider's `openRequest` returns `{opened: true}` with NO `url`. The in-core review comment poster (`integration-core.ts` step 6) gates on `integration.url !== undefined`, so it cleanly NO-OPs — and the human/operator loses the posted review on a PR that genuinely exists.

Make the provider FALL BACK: when a PR was opened but its URL is unknown, post the review comment by resolving the PR from the pushed branch (`gh pr comment <branch> --body-file …`, or `gh pr view <branch> --json url` then comment), instead of dropping it. If even the fallback can't resolve a PR (truly no PR found), THEN it is an honest no-op (preserve the existing "no PR ⇒ clean no-op" rule) — but only after trying.

### The defect (precise)

- `src/github.ts` `openRequest` (~line 213): on `gh pr create` exit 0 with an unparseable stdout URL, returns `{opened: true, instruction: 'Opened a GitHub PR…'}` — deliberately WITHOUT a `url` (it degrades rather than guessing a URL).
- `src/integration-core.ts` step 6 (the review-comment poster) only posts when `integration.url !== undefined`. So the `{opened:true, url:undefined}` shape reaches the poster and is skipped.

The result is consistent with the slice that introduced it ("no PR url ⇒ clean no-op") — but a PR WAS opened; the right behaviour is to comment on it via the branch, not to drop the audit trail.

### The fix

- In the GitHub provider, add a branch-resolved comment path: given the pushed `work/<slug>` branch, resolve its open PR (`gh pr view <branch> --json url --jq .url`, or comment directly with `gh pr comment <branch>`), and use THAT to post the review comment when the create-time URL was unparseable.
- Wire it so the in-core poster (step 6) can still post when `integration.url` is undefined but `opened === true` (e.g. pass the branch through, or have the provider expose a `commentOnOpenedRequest(branch, body)` that internally resolves the URL). Keep the seam discipline: the provider owns the `gh` mechanics; the core owns "post the review verdict as a comment".
- Preserve the genuine no-op: a non-GitHub arbiter (`NoneProvider`) and a "no PR exists at all" case still post nothing.

## Scope

- IN: the branch-resolved comment fallback in the GitHub provider; the in-core poster reaching it when a PR opened without a parseable URL; tests for both the fallback-posts path and the truly-no-PR clean-no-op. Also (folding in the second nit from the source observation) STRENGTHEN the existing equivalence test to "same provider, commenting on vs off" rather than "commenting provider vs NoneProvider", so it isolates that commenting changes no gate/verdict/merge logic.
- OUT: changing WHEN a review comment is posted (still only after a real PR opens in propose mode); the `--merge` no-PR path; any change to the verdict/gate/merge logic; inventing a URL when none can be resolved.

## Acceptance criteria

- [ ] When `gh pr create` opens a PR (exit 0) but its stdout URL is unparseable, the Gate-2 review comment is posted via a BRANCH-RESOLVED fallback (resolve the PR from the pushed `work/<slug>` branch), NOT silently dropped.
- [ ] When no PR can be resolved at all (genuinely none), it is a clean no-op (the existing "no PR ⇒ no comment" rule is preserved) — but only AFTER the fallback tried.
- [ ] A non-GitHub arbiter (`NoneProvider`) still posts nothing (unchanged).
- [ ] The verdict / gate / mode / merge logic is byte-unchanged (the comment stays advisory — existing review-gate tests pass unchanged).
- [ ] The equivalence test is strengthened to "same GitHub provider, commenting ON vs OFF" (proving the comment changes no gate/verdict/merge outcome), replacing the weaker "commenting provider vs NoneProvider" control.
- [ ] Tests assert: the fallback POSTS when the create-URL is unparseable but a PR exists; the clean no-op when no PR is resolvable; `NoneProvider` posts nothing. Use the house provider/`gh`-stub pattern (stub `gh pr create` to return exit 0 with an unparseable stdout, and `gh pr view`/`gh pr comment` to resolve the branch's PR); temp-dir isolation; real shared dirs untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Prompt

> Close an audit-trail gap: when `gh pr create` opens a PR (exit 0) but dorfl can't PARSE the PR URL from its stdout, the Gate-2 review comment is currently dropped silently (the in-core poster gates on `integration.url !== undefined`). Make the GitHub provider FALL BACK to commenting on the PR resolved from the pushed `work/<slug>` branch, instead of no-op'ing. Only when NO PR is resolvable at all is it an honest no-op (preserve the existing "no PR ⇒ clean no-op" rule). Source: `work/observations/review-nits-review-gate-pr-comment-2026-06-07.md` (READ IT FIRST; delete it as part of this slice once the behaviour lands).
>
> READ FIRST: `src/github.ts` `openRequest` (~line 213 — the `{opened:true, url:undefined}` degradation on an unparseable create-URL; this is where the branch-resolved comment fallback lives) + `selectProvider`/`NoneProvider`; `src/integration-core.ts` step 6 (the review-comment poster — the `integration.url !== undefined` gate to relax so it can post on an opened-but-URL- less request via the branch); `test/review-gate-pr-comment.test.ts` (the existing comment tests + the equivalence test to strengthen). Keep the seam discipline: the provider owns the `gh` mechanics, the core owns "post the verdict as a comment".
>
> Also fold in the second (benign) nit from the source observation: strengthen the "comment is advisory / decision unchanged" test to use the SAME GitHub provider with commenting on vs off (not the commenting provider vs `NoneProvider`), so it isolates that commenting changes no gate/verdict/merge logic.
>
> TDD with vitest, house style (stub `gh pr create` to exit 0 with an unparseable stdout, and `gh pr view`/`gh pr comment` to resolve the branch's PR; temp dirs; assert the real `~/.dorfl/` is untouched): the fallback POSTS when the create-URL is unparseable but a PR exists; a clean no-op when no PR is resolvable; `NoneProvider` posts nothing; the verdict/gate/mode/merge logic is unchanged. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim review-comment-fallback-on-unparsed-pr-url --arbiter origin
git fetch origin && git switch -c work/review-comment-fallback-on-unparsed-pr-url origin/main
git mv work/in-progress/review-comment-fallback-on-unparsed-pr-url.md work/done/review-comment-fallback-on-unparsed-pr-url.md
```

## Needs attention

acceptance gate failed (exit 1)

## Requeue 2026-06-11

False gate red: 1544/1546 passed; the 2 failures are the KNOWN same-slug-race CAS flake (triage-persist.test.ts + advance-triage.test.ts) under full parallel load — NOT this slice's work. Re-run after the flake is fixed.
