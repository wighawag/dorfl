---
title: 'review-gate non-blocking nits for ''remove-dead-needs-attention-folder-readers-after-lock-cutover'' (Gate 2 approve)'
date: 2026-06-22
status: open
reviewOf: remove-dead-needs-attention-folder-readers-after-lock-cutover
needsAnswers: false
triaged: keep
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'remove-dead-needs-attention-folder-readers-after-lock-cutover' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the keep-or-cut decision: the agent chose option (a) — delete `readNeedsAttentionItems` + de-export from `index.ts` + remove the four tombstone tests. The slice flagged this as a judgement call and recommended (a) as default. OK?
  (The slice required this decision be recorded as a `## Decisions` line in the done record / PR description; the done record was not modified to add one, and the commit message has no Decisions block. The decision itself is sound and matches the slice's default; this finding is the missing record + the ratification ask.)
- Ratify the rewritten `ApplyResolveNeedsAttentionTransitionInput/Result` shape: dropping the `moveCommit`/`commitMessage` fields the old `ResolveFromNeedsAttentionResult` declared. OK?
  (Those fields were declared on the deleted type but never produced by the strategy body (which only returns `{moved}` or `{moved: false, reasonNotMoved}`), and the sole consumer (`start.ts`) only reads `moved`/`reasonNotMoved`. So this is honest cleanup, but it is a public-type change worth ratifying given the package re-exports these via `index.ts`.)
- Ratify the deferral of the residual folder prose + the live `existsSync(work/needs-attention/<slug>.md)` probe in `complete.ts`'s source resolver to a follow-up slice. OK?
  (The agent captured this as `work/notes/observations/stale-needs-attention-folder-prose-in-ledger-write-and-do-after-lock-cutover-2026-06-22.md`, citing `ledger-write.ts`, `complete.ts`, `do.ts`, `integration-core.ts`, `cli.ts`, `slicer-review-loop.ts`, `slicing.ts`. The slice's AC ("No LIVE folder-read/write code for `work/needs-attention/` remains in `packages/dorfl/src/`") was scoped to the named modules per the verified-scope list; `complete.ts`'s `existsSync` probe is a legacy source-folder fallback used by the committed-recovery branch, not a reader of the retired surface. Defensible, but worth ratifying that it stays out of scope.)

## Applied answers 2026-06-22

### q1: Ratify the keep-or-cut decision: delete `readNeedsAttentionItems` + de-export it from `index.ts` + remove the four tombstone tests — agent chose option (a), which the slice flagged as the recommended default. OK?

KEEP / ratify (a). Verified: `readNeedsAttentionItems` is gone (no matches anywhere) and de-exported — the cut happened, and it matches the slice's recommended default. Accept the missing `## Decisions` line as a process nit (part of the recurring pattern captured in the meta-observation), not a reason to reopen. Disposition: keep.

disposition: keep

### q2: Ratify the rewritten `ApplyResolveNeedsAttentionTransitionInput/Result` shape — dropping the `moveCommit` / `commitMessage` fields the old `ResolveFromNeedsAttentionResult` type declared. OK?

KEEP / ratify the drop. Verified: the old `ResolveFromNeedsAttentionResult` type is gone; the new `{moved, reasonNotMoved?}` shape matches what the strategy body produces and what the sole consumer (`start.ts`) reads. The dropped `moveCommit`/`commitMessage` fields were vestigial (declared but never produced or consumed). Disposition: keep.

disposition: keep

### q3: Ratify deferring the residual folder prose + the live `existsSync(work/needs-attention/<slug>.md)` probe in `complete.ts`'s source resolver to a follow-up slice. OK?

KEEP / ratify the deferral. Verified: `complete.ts`'s `existsSync(work/needs-attention/<slug>.md)` probe is on the committed-recovery path (a runner-owned recovery SOURCE folder), NOT a reader of the retired needs-attention surface, so it was defensibly out of scope for this slice. Track the residual folder prose + this probe via the existing follow-up observation (`stale-needs-attention-folder-prose-...`) rather than reopening this slice. Disposition: keep.

disposition: keep
