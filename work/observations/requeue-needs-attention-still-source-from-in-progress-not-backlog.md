---
slug: requeue-needs-attention-still-source-from-in-progress-not-backlog
---

2026-06-18 (noticed building `cutover-claim-body-stays-and-complete-sources-from-backlog`, 9a):
now that claim leaves the body in `work/backlog/` (no `git mv backlog→in-progress`),
the needs-attention BOUNCE (`applyNeedsAttentionTransition` → `findSourceFolder`,
`['in-progress','done','needs-attention']`) and `requeue` (`returnToBacklog` →
`resolveRequeueSourceRel`, `['needs-attention','in-progress']`) can no longer find a
freshly-claimed-but-not-yet-built item (its body rests in `backlog/`, which neither
source list includes). That retarget is explicitly 9b's scope (the needs-attention
surface), so 9a left it; flagging that 9b must teach the bounce/requeue source lists
about a body resting in `backlog/` (claimed = lock held + body in backlog).
