<!-- agent-runner-sidecar: item=observation:review-nits-remove-dead-needs-attention-folder-readers-after-lock-cutover-2026-06-22 type=observation slug=review-nits-remove-dead-needs-attention-folder-readers-after-lock-cutover-2026-06-22 allAnswered=false -->

## Q1

**Ratify the keep-or-cut decision: delete `readNeedsAttentionItems` + de-export it from `index.ts` + remove the four tombstone tests — agent chose option (a), which the slice flagged as the recommended default. OK?**

> Gate 2 approved the slice 'remove-dead-needs-attention-folder-readers-after-lock-cutover' but flagged that the slice required this judgement-call decision be recorded as a `## Decisions` line in the done record / PR description, and that record was never amended (commit message also has no Decisions block). The decision itself matches the slice's default; the ask is ratification + acknowledgement of the missing durable record.

_Suggested default: Ratify (a) — decision is sound and matches the slice's stated default; accept the missing-Decisions-line as a process nit rather than reopening the slice._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

## Q2

**Ratify the rewritten `ApplyResolveNeedsAttentionTransitionInput/Result` shape — dropping the `moveCommit` / `commitMessage` fields the old `ResolveFromNeedsAttentionResult` type declared. OK?**

> Those fields were declared on the deleted type but never produced by the strategy body (which only returns `{moved}` or `{moved: false, reasonNotMoved}`), and the sole consumer (`start.ts`) only reads `moved` / `reasonNotMoved`. Honest cleanup, but it is a public-type change because the package re-exports these via `index.ts`, so worth explicit ratification.

_Suggested default: Ratify the drop — fields were vestigial (declared but never produced or consumed); the new shape matches reality._

<!-- q2 fields: id=q2 disposition=keep -->

**Your answer** (write below this line):

## Q3

**Ratify deferring the residual folder prose + the live `existsSync(work/needs-attention/<slug>.md)` probe in `complete.ts`'s source resolver to a follow-up slice. OK?**

> Captured as observation `stale-needs-attention-folder-prose-in-ledger-write-and-do-after-lock-cutover-2026-06-22.md` (cites `ledger-write.ts`, `complete.ts`, `do.ts`, `integration-core.ts`, `cli.ts`, `slicer-review-loop.ts`, `slicing.ts`). The slice's AC ('No LIVE folder-read/write code for `work/needs-attention/` remains in `packages/agent-runner/src/`') was scoped to the named modules per the verified-scope list; `complete.ts`'s `existsSync` probe is a legacy source-folder fallback used by the committed-recovery branch, not a reader of the retired surface. Defensible scoping, but worth ratifying it stays out of scope of THIS slice.

_Suggested default: Ratify the deferral — the probe is on the committed-recovery path, not the retired needs-attention reader surface; track via the existing follow-up observation rather than reopening this slice._

<!-- q3 fields: id=q3 disposition=keep -->

**Your answer** (write below this line):
