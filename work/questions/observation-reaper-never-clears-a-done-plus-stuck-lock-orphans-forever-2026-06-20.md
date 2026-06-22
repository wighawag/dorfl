<!-- agent-runner-sidecar: item=observation:reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20 type=observation slug=reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20 allAnswered=false -->

## Q1

**How should this observation be dispositioned: promote to a slice that extends the reaper to treat stuck+terminal-on-main locks as reapable (split kept-stuck into stuck+terminal => reapable vs stuck+in-flight => keep, with a pinning test), keep as an open observation, or another route?**

> Observation reports that `reapStaleItemLocks` only reaps `cleared-stale` (TERMINAL-on-main + active) and by construction NEVER reaps `kept-stuck` (terminal + stuck), so a `done`-on-main item with a lingering `stuck` lock orphans forever — verified against `packages/agent-runner/src/item-lock.ts`. Concretely, `slice-claim-cas-spinner` survived `gc --reap-stale-locks` after PR #140 merged and had to be hand-deleted via `git push origin --delete`. The ADR `ledger-status-on-per-item-lock-refs` already authorises this: it allows `done`+`stuck` to co-exist and declares the `main` durable record AUTHORITATIVE over a stale lock — the reaper just doesn't apply that rule to the stuck case. The fix shape, refs, tests, and the non-terminal-stuck carve-out (must still never auto-reap) are all spelled out in the observation, so it is slice-ready; the only judgement left is the routing.

_Suggested default: promote-slice — fix shape, tests, ADR authority, and the non-terminal carve-out are already specified; it is a concrete code change in `item-lock.ts` plus a pin test._

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

promote-slice, but treat it as a CONTRACT change, not a pure bugfix. Verified: the reaper reaps ONLY the `cleared-stale` class (terminal-on-main + active) and never `kept-stuck` (terminal + stuck), so a `done` + stuck lock orphans forever. The fix — split `kept-stuck` into stuck+terminal (reapable) vs stuck+in-flight (keep), with a pinning test that the non-terminal stuck case still NEVER reaps — loosens the load-bearing "stuck is never auto-cleared, it means human attention" invariant. So ship it WITH the carve-out + pin test AND an ADR note ratifying that terminal-on-main + stuck is now reapable (the cited ADR authorises "main is authoritative" but does not by itself say a stuck lock should be auto-cleared, so record the extension explicitly). Cross-ref the release-lock escape-hatch sidecar (same orphan, complementary recovery path). Disposition: promote-slice (as a contract change).
