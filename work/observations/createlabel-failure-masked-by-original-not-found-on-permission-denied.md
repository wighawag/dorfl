---
title: createLabel's boolean return swallows the REAL create-failure cause, so a permission-denied create-on-first-use is reported as the stale `'<label>' not found`
date: 2026-06-10
slug: createlabel-failure-masked-by-original-not-found-on-permission-denied
---

## What was spotted

While running `intake 40 --merge` against a fresh repo (`wighawag/rocketh`) whose `agent-runner:processing` lock label did not yet exist, intake failed at lock-acquire with:

```
could not add the `agent-runner:processing` label on issue #40: failed to update https://github.com/wighawag/rocketh/issues/40: 'agent-runner:processing' not found
```

That message is MISLEADING. The fresh-repo create-on-first-use path (`src/issue-provider.ts`, `mutateLabel` → `createLabel`) DID fire — it ran `gh label create agent-runner:processing` — but that create FAILED (the bot identity `0xronan7`, a `repo`-scope classic-token collaborator, lacked permission to create labels). Because the create failed, the add was NOT retried, and the code surfaced the ORIGINAL `--add-label` failure (`'<label>' not found`) verbatim.

The root cause: `createLabel` returns a bare `boolean`. On a non-`already exists` failure it returns `false` and THROWS AWAY the real `gh` stderr (e.g. an `HTTP 403: Resource not accessible` / GraphQL permission denial). The caller has no failure reason to surface, so the user sees the fresh-repo SYMPTOM (`not found`) instead of the actual create-permission CAUSE.

Confirmed by then pre-creating the label out-of-band and re-running: the `not found` vanished, the add step ran, and GitHub returned the TRUE cause unmasked:

```
GraphQL: 0xronan7 does not have the correct permissions to execute `AddLabelsToLabelable` (addLabelsToLabelable)
```

So the apply-permission error surfaces fine; only the CREATE-permission error is masked behind `not found`.

## Why it matters

- **Diagnosability:** identical class of bug to the one already fixed in `mutateLabel` (the hard-coded "`gh` is unavailable or unauthenticated" misattribution) and its sibling still-surviving in `postIssueComment` — a human is sent chasing a fresh-repo "label not found" when the real problem is create permissions. The create-on-first-use convenience masks its own failure mode.
- **Create vs apply asymmetry:** the create-failure cause is the ONE issue-provider failure still reported as a misleading symptom rather than the real `gh` stderr; the apply path already surfaces the truth via `ghFailureReason`.

## Scope / candidate fix

Have `createLabel` surface its failure reason instead of collapsing to a bare `false` that discards the stderr — e.g. return the `RunResult`/reason (or thread `ghFailureReason(createResult)` through) so that, when the create fails for a reason OTHER than `already exists`, `mutateLabel` reports the create's REAL cause rather than the original add's stale `'<label>' not found`. Keep the `already exists` → success and the missing-`gh` → degrade behaviours unchanged. Small and mechanical; same treatment family as the `mutateLabel` / `postIssueComment` misattribution fixes.

## References

- `src/issue-provider.ts` `createLabel()` — bare `boolean` return discarding stderr.
- `src/issue-provider.ts` `mutateLabel()` — fresh-repo create-on-first-use retry block (`isLabelNotFound` → `createLabel` → retry); surfaces the original add failure when `createLabel` returns `false`.
- Sibling/related: `work/observations/issue-provider-hardcoded-gh-unauth-string-survives-in-comment-and-comment-paths.md` and `work/done/intake-lock-failure-semantics-and-real-cause.md` (the original misattribution fix that introduced `ghFailureReason`).
- Surfaced by: `node …/cli.js intake 40 --merge` on `wighawag/rocketh` with identity `0xronan7` (a `repo`-scope classic token, collaborator without label-write/triage), before vs after pre-creating the lock label.
