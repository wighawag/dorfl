---
title: review-gate non-blocking nits for 'remove-dead-needs-attention-folder-readers-after-lock-cutover' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: remove-dead-needs-attention-folder-readers-after-lock-cutover
needsAnswers: true
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
  (The agent captured this as `work/notes/observations/stale-needs-attention-folder-prose-in-ledger-write-and-do-after-lock-cutover-2026-06-22.md`, citing `ledger-write.ts`, `complete.ts`, `do.ts`, `integration-core.ts`, `cli.ts`, `slicer-review-loop.ts`, `slicing.ts`. The slice's AC ("No LIVE folder-read/write code for `work/needs-attention/` remains in `packages/agent-runner/src/`") was scoped to the named modules per the verified-scope list; `complete.ts`'s `existsSync` probe is a legacy source-folder fallback used by the committed-recovery branch, not a reader of the retired surface. Defensible, but worth ratifying that it stays out of scope.)
