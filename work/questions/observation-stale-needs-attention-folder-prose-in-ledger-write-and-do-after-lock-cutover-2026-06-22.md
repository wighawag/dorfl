<!-- dorfl-sidecar: item=observation:stale-needs-attention-folder-prose-in-ledger-write-and-do-after-lock-cutover-2026-06-22 type=observation slug=stale-needs-attention-folder-prose-in-ledger-write-and-do-after-lock-cutover-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this observation — promote it to a small cleanup slice that reconciles the stale `work/needs-attention/` folder prose across `ledger-write.ts`, `complete.ts`, `do.ts`, `integration-core.ts`, `cli.ts` (requeue help), `slicer-review-loop.ts`, and `slicing.ts`; keep it as a pending signal; or drop it?**

> Observation (work/notes/observations/stale-needs-attention-folder-prose-in-ledger-write-and-do-after-lock-cutover-2026-06-22.md, 2026-06-22) records that after the per-item-lock cutover (the `stuck` state on the lock replaced the folder move), several docstrings and user-facing strings still describe the retired folder-move behavior as if live. Concrete sites enumerated by the author:
> - ledger-write.ts:161 (ApplyNeedsAttentionTransitionInput docstring), :325, :634, :697
> - complete.ts:45, :93, :294, :473, :502, :755 (notes claim `git mv ... -> work/needs-attention/<slug>.md`)
> - do.ts:1360, :1362, :1475, :1478, :2337, :2339 (human-facing strings: "routed it to work/needs-attention/")
> - integration-core.ts:425, :621, :650
> - cli.ts:3026 (`requeue` help text mentions recovering from `work/needs-attention/<slug>.md`)
> - slicer-review-loop.ts:62, slicing.ts:1086, :1105
> The BEHAVIOR is already correct (the lock's `state: stuck` is the observable half; `routeToNeedsAttention` no longer moves); only the prose is stale. The author explicitly says the cleanup was "out of scope for that slice, but worth a small follow-up pass" — i.e. user-facing `do` / `run` / `requeue` messages currently point humans at a folder that no longer exists, which is a real UX bug even though the protocol is sound.

_Suggested default: promote-slice — a small, well-scoped, mechanical prose-reconciliation pass across the enumerated file:line sites; the author already triaged it as "worth a small follow-up pass" and listed every location, so the slice is essentially pre-scoped._

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):
