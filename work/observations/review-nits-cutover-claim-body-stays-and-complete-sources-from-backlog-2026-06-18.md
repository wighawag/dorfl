---
title: review-gate non-blocking nits for 'cutover-claim-body-stays-and-complete-sources-from-backlog' (Gate 2 approve)
date: 2026-06-18
status: open
reviewOf: cutover-claim-body-stays-and-complete-sources-from-backlog
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'cutover-claim-body-stays-and-complete-sources-from-backlog' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the slice's SCOPE FENCE says 'do NOT touch the needs-attention/ folder/recovery surface (9b owns its retarget)', yet the diff adds backlog/-first probing to findSourceFolder (the wip-save bounce), resolveSurfaceSourceRel, and surfaceToNeedsAttention's per-attempt planner in needs-attention.ts. Is this partial entry into 9b's surface intended?
  (This looks NECESSARY rather than a fence violation: because claim now leaves the body in backlog/, a freshly-claimed-but-red autonomous build (the strand/surface path) rests in backlog/, so without backlog/ probing those surfaces could no longer find the item to route it to needs-attention - a regression the moment this slice lands. The agent drew the line correctly: it touched the SURFACE source-resolution (needed now) but LEFT resolveRequeueSourceRel (requeue's source list, still ['needs-attention','in-progress']) for 9b, and FILED work/observations/requeue-needs-attention-still-source-from-in-progress-not-backlog.md documenting that 9b must teach the bounce/requeue source lists about a body resting in backlog/. autonomous-strand-surface.test.ts + needs-attention.test.ts cover the backlog-source surface. Human should ratify the 'surface now, requeue in 9b' split (or fold the requeue retarget forward).)
- Ratify the repo-mirror.ts concurrency fix: ensureMirror's single all-heads fetch was split into a HARD main-only fetch plus a BEST-EFFORT (soft) all-heads fetch. This is a real behavioral change not named in the slice's file list.
  (The comment explains it well: with claim no longer serialising same-repo run jobs (the body-move used to serialise them), two concurrent run jobs now share one bare mirror, and git REFUSES to fetch into a sibling worktree's checked-out work/<slug> head ('refusing to fetch into branch ... checked out'), failing the whole ensure even though main and this job's own head updated fine. Degrading the all-heads fetch to best-effort (while keeping main a hard fetch so the worktree base is guaranteed) is a reasonable fix and continue-detection is arbiter-authoritative anyway. It is a sound, self-directed cross-cutting decision surfaced by this slice's premise; worth a human nod since it relaxes a fetch from hard to soft.)
- Ratify retained dead surface: ClaimCasOptions.retries is now accepted-but-ignored and ClaimCasResult.claimCommit is now ALWAYS undefined, both kept on the shapes only for type-compat with existing callers (do.ts threads claim.claimCommit into onboarding).
  (Both are clearly documented in claim-cas.ts as legacy/retained-for-type-compat, and the undefined claimCommit correctly drives isolation.ts's pre-existing 'no claim commit -> branch off <arbiter>/main' path. This is honest dead-surface debt rather than a defect, but a human may prefer to schedule its removal (and the corresponding do.ts/isolation.ts simplification) in a later cut-over slice so the option/result shapes do not advertise capabilities the command no longer has.)
