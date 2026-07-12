<!-- dorfl-sidecar: item=observation:reaper-stuck-terminal-requeue-fixed-self-inflicted-leaks-2026-07-11 type=observation slug=reaper-stuck-terminal-requeue-fixed-self-inflicted-leaks-2026-07-11 allAnswered=false -->

Item: [`observation:reaper-stuck-terminal-requeue-fixed-self-inflicted-leaks-2026-07-11`](../notes/observations/reaper-stuck-terminal-requeue-fixed-self-inflicted-leaks-2026-07-11.md)

## Q1

**What becomes of this observation now that the underlying reaper-reap-terminal-stuck-lock-orphans task has landed on main and the two self-inflicted leak-scan reds it describes are already fixed in-tree?**

> The note is an append-only decision-capture recording that during the requeued reaper attempt two leak-scan reds were introduced by the prior attempt itself (not pre-existing): (1) a 'brief-tasked' inline-code span in docs/adr/ledger-status-on-per-item-lock-refs.md:124 that tripped prd-to-spec-leak-scan's DEAD_TOKEN_LITERAL, fixed by rewriting to current terminal vocabulary; (2) a mis-diagnosed observation note (prd-word-cutover-leak-scan-pre-existing-red-2026-07-10.md) that was itself half of the red and was removed. Task reaper-reap-terminal-stuck-lock-orphans is now in work/tasks/done (landed via PR #315), so the fixes are in main and gates are green. No follow-up action is proposed in the note itself; it explicitly frames itself as an append-only decision bucket rather than a signal demanding new work.

_Suggested default: Discard: keep as landed decision-capture provenance only, no new task/spec/ADR minted — the fixes are already in main, the two lessons (retired-token literals in ADR code spans get flagged; do not write observation notes that carry the very artifact-words the scan forbids) are captured here for history, and no residual work is implied._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete. The underlying reaper-reap-terminal-stuck-lock-orphans task has landed on main and the two self-inflicted leak-scan reds it describes are already fixed in-tree. Fully discharged.
