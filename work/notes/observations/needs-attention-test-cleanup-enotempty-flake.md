---
slug: needs-attention-test-cleanup-enotempty-flake
needsAnswers: false
triaged: keep
---

2026-06-18 — saw `test/needs-attention.test.ts > readNeedsAttentionItems lists the stuck items with their reason` fail intermittently with `Error: ENOTEMPTY: directory not empty, rmdir '/tmp/dorfl-needs-attention-…/project'` from the `cleanup()` in `test/helpers/gitRepo.ts:102`. Re-running the file in isolation passes; full `pnpm -r test` was the failing site. Looks like a cleanup race between the test's still-finishing git/fs ops and `rmSync(root, {recursive: true, force: true})`, not a correctness issue. Out of scope for the de-overload-humanonly slice; flagging only.

## Applied answers 2026-06-22

### q1: How should this observation be discharged: promote to a slice that fixes the test-cleanup race in `test/helpers/gitRepo.ts:102` (e.g. await in-flight git/fs ops or retry `rmSync` on ENOTEMPTY), keep it as a live signal until the flake recurs, or delete it as too low-signal to act on?

promote-slice (small, localised). The cleanup race is real: the test-repo `cleanup()` does `rmSync(root, {recursive: true, force: true})` which can ENOTEMPTY when in-flight git/fs ops are still touching the tree. Fix: await in-flight ops before cleanup, or retry `rmSync` on ENOTEMPTY. Note the cited path is stale — the real `rmSync` is at `gitRepo.ts:150`, not `:102`; whoever writes the slice should update the reference. Disposition: promote-slice.

## Triaged: promoted

Promoted to a new backlog task `work/tasks/ready/needs-attention-test-cleanup-enotempty-flake.md` (a human answered
"promote"). This observation is resolved; the new item carries the work.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `task:needs-attention-test-cleanup-enotempty-flake` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: Observation was already triaged as promoted; the promoted backlog task work/tasks/ready/needs-attention-test-cleanup-enotempty-flake.md carries the work. Observation itself notes 'Triaged: promoted' and 'resolved'.

## Resolution (recovered from an orphaned question sidecar, 2026-07-12)

CORRECTION: the promoted carrier task was DELETED in commit `d4fd53db` ("repair 12 promptless promoted tasks", GROUP A) as an un-buildable promptless stub; the intended re-mint from this observation never happened, so `work/tasks/ready/needs-attention-test-cleanup-enotempty-flake.md` no longer exists. Its question sidecar (4 questions) was answered by a human and lived nowhere else; recovered verbatim below before the orphaned sidecar is removed. Carry these into any re-minted task.

- **Q1 (fix approach):** Approach (b): retry `rmSync` on ENOTEMPTY with a short bounded backoff. Simplest, most localised, directly targets the observed failure. Only add awaiting of in-flight ops (approach a) if the retry proves insufficient in practice.
- **Q2 (stale refs):** Yes, fix them: rewrite the task to reference `packages/dorfl/test/helpers/gitRepo.ts` `cleanup()` (currently line 152) and `packages/dorfl/test/needs-attention.test.ts` `afterEach`, and instruct the builder to re-confirm line numbers at build time (the observation's :102 and the applied-answer's :150 are both stale).
- **Q3 (localise vs generalise):** Generalise. Fix the shared `rmSync` path once via a single `safeRemoveDir` helper used by both the `cleanup()` site (:152) and the seed/done helper (:352), rather than patching `cleanup()` in isolation. The race is structural (git/fs ops still touching the tree), so a localised patch leaves a latent flake at the other site. (REVIEW-PROTOCOL discipline 4: a second instance means generalise.)
- **Q4 (acceptance):** Accept on the hardened shared removal helper (retry-on-ENOTEMPTY) PLUS a targeted unit test exercising it against a deliberately-busy directory to assert it no longer throws ENOTEMPTY, with the verify floor (`pnpm -r build && pnpm -r test && pnpm format:check`) staying green. A deterministic unit test on the helper is the honest proof; do not rely on "verify stays green" alone for an intermittent race.
