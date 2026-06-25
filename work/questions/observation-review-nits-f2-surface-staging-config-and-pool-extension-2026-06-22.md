<!-- dorfl-sidecar: item=observation:review-nits-f2-surface-staging-config-and-pool-extension-2026-06-22 type=observation slug=review-nits-f2-surface-staging-config-and-pool-extension-2026-06-22 allAnswered=false -->

## Q1

**What should become of this batch of non-blocking review nits for the (now-done) slice 'f2-surface-staging-config-and-pool-extension' — promote one or more into a follow-up task/slice, keep the observation open as a triage record, or delete it as already-acceptable?**

> Native observation-triage question. The slice was APPROVED at Gate 2 (review) with these findings explicitly NON-blocking; the slice is integrated (work/tasks/done/f2-surface-staging-config-and-pool-extension.md). This note is their durable triage home. Verified against current code: every nit below still holds against HEAD, so none has been silently fixed since the observation was written.

_Suggested default: Keep the observation open as a triage record and address the highest-value nit (the missing mirror-path test) as a small follow-up; the rest are decisions to ratify, not defects._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Ratify or reverse the four decisions the slice made silently (no `## Decisions` block in the commit/PR body): (1) `LifecyclePoolGates.surfaceStaging` defaults `false` at the library boundary while `Config.surfaceStaging` defaults `true` (the calm-default is load-bearing for any direct caller of `gatherLifecycle*` that doesn't thread CLI gates); (2) four NEW public methods (`resolveLocalTaskStaging`/`resolveLocalBriefStaging`/`resolveMirrorTaskStaging`/`resolveMirrorBriefStaging`) added to `LedgerReadStrategy` and exported, rather than extending `resolveLocalState`/`resolveMirrorState` to enumerate staging behind a flag; (3) the gate is consumed by the GATHER, not by pure `buildLifecyclePools`, though the field lives on `LifecyclePoolGates`; (4) `surfaceStaging` added to `REPO_ALLOWED_KEYS` so a repo's `.dorfl.json` can flip it. Are all four the intended design?**

> Verified in code: `lifecycle-pools.ts:80-85` doc-comments the split-default (lib `false` vs `Config` `true` at config.ts:629); `ledger-read.ts:334+` declares the four new staging methods alongside the existing `resolveLocalState`/`resolveMirrorState` (268/280); `repo-config.ts:138` lists `surfaceStaging` in `REPO_ALLOWED_KEYS` and `index.ts:29` exports it. `git log -1` on the slice shows title only, no body/Decisions block. The recurring observation `decisions-block-convention-repeatedly-skipped-enforce-or-relax-2026-06-22` already exists (work/notes/observations + an open sidecar), and this slice perpetuates the pattern.

_Suggested default: Ratify all four as-is (they are coherent and doc-commented); the real action is the recurring decisions-block-skip pattern, tracked separately._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Should a direct test of `gatherLifecycleMirror`'s staging widening be added — seed a staged `needsAnswers` item, push to a bare mirror, assert `gatherLifecycleMirror({...,gates:{surface:true,surfaceStaging:true}}).surface` enumerates it and is empty when `surfaceStaging:false`?**

> Verified: grep across packages/dorfl/test/ finds ZERO references to `gatherLifecycleMirror` and the named slice test (surface-staging-config-and-pool.test.ts) has 0 matches for it — it exercises only `gatherLifecycleInPlace`/`scanRepoPaths` (in-place path) plus a real-git apply/lock pair. The new mirror readers (`readTaskStagingFromTree`/`readBriefStagingFromTree`, the `<ref>:work/tasks/backlog/*.md` / `briefs/proposed/*.md` `git ls-tree`+`git show` path) are the actual path CI's propose-matrix runs against the bare hub mirror, and are currently unverified by any test.

_Suggested default: Yes — add the single mirror-path test; it covers the real CI code path and is the highest-value nit here._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Is the intended invariant that `apply` CONSUMES an answered staged sidecar regardless of `surfaceStaging` gate state? An answered sidecar can become STRANDED if `surfaceStaging` is flipped true→false after the surface tick minted+answered it: under `surfaceStaging:false` the gather no longer enumerates the staged item into `needsAnswers[]`, so `buildLifecyclePools` cannot route it to `apply` either — yet apply is documented as 'CONSUME, always-on'.**

> Verified: `lifecycle-gather.ts` skips the staging read entirely when `surfaceStaging` is false (gather guarded at :91 / :185), so `buildLifecyclePools` never sees the candidate. Cf. ADR `ci-config-policy-and-gate-family` §4 (create-vs-consume invariant). Real-world impact is small: the realistic flip direction is off→on, and an answered sidecar only exists if surfacing (opt-in) minted it; flagged in case the create-vs-consume invariant should hold strictly.

_Suggested default: Acknowledge as a known low-impact edge; document the create-vs-consume expectation rather than re-route apply, unless the invariant must hold strictly._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
