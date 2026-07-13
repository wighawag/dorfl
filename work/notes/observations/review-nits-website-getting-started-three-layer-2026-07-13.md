---
title: review-gate non-blocking nits for 'website-getting-started-three-layer' (Gate 2 approve)
date: 2026-07-13
status: open
reviewOf: website-getting-started-three-layer
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'website-getting-started-three-layer' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Layer 1 presents BOTH 'from-idea' and 'setup' as adopt-skill front doors, but CONTEXT.md L82 phrases the invariant as 'setup — the single onboarding skill'. The task explicitly asked for both, and 'from-idea' does exist under skills/, so this is faithful to the task; flagging so a human can ratify whether CONTEXT.md's 'single' phrasing should be updated to match the two-skill framing the site now advertises.
  (CONTEXT.md:82 vs website/src/routes/+page.svelte layer-1 copy; skills/from-idea and skills/setup both present.)
- The page shows the per-repo gate file as '.dorfl.json' (dot-prefixed), matching work/protocol/WORK-CONTRACT.md, but this repo's actual file is 'dorfl.json' (no dot). The site correctly follows the protocol name, not the legacy file; noting so a human confirms the canonical name is dot-prefixed.
  (website/+page.svelte layer-2 code block shows '.dorfl.json'; ls of repo root shows 'dorfl.json'; work/protocol/WORK-CONTRACT.md:209 uses '.dorfl.json'.)
