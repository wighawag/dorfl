<!-- dorfl-sidecar: item=task:scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20 type=task slug=scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20 allAnswered=false -->

## Q1

**Confirm the fix direction: switch the `autoBuild` gate at `packages/dorfl/src/scan.ts` ~L368 from `resolveRepoConfig({repoPath: mirror.path, ...})` to `resolveRepoConfigFromMirror({mirrorPath: mirror.path, ...})` so both pool gates resolve from the SAME mirror-ref view — is that the unification target, or do you want the inverse (both onto the working-tree reader) or a new shared helper that both gates call?**

> The observation's triage note (`work/notes/observations/scan-…-2026-06-20.md` → 'Applied answers 2026-06-22') already proposes `resolveRepoConfigFromMirror` for BOTH, on the grounds that a bare mirror has no working tree so the working-tree reader degrades to global fallback and never observes a committed per-repo override. The task body itself is a stub ('draft this into a buildable task'), so the fix shape is not yet pinned down in-task.

_Suggested default: Both gates call `resolveRepoConfigFromMirror` in the bare-mirror branch of `scan()` (matches the observation's stated reasoning: the mirror IS bare, so the mirror-ref reader is the only one that can see a committed `.dorfl.json`)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Scope: should this slice ALSO audit/unify any OTHER call sites in `scan()` (and adjacent bare-mirror code paths) that read per-repo config via `resolveRepoConfig` against a bare mirror path, or is the slice strictly the single `autoBuild` line at ~L368?**

> The observation names only the autoBuild vs autoSlice pair, but the underlying defect — using the working-tree reader against a bare mirror — is a CLASS of bug. `scan.ts` may have (or later grow) other gates that fall into the same trap. Deciding the scope fence now prevents either over-reaching (slice swells) or leaving a sibling divergence for a future observation.

_Suggested default: Strictly the single autoBuild line at ~L368 (matches the observation's narrow framing and the 'narrow blast radius' rationale); add a code comment / lint-style guard note that `resolveRepoConfig` must not be called against a bare mirror path, so any future sibling case is caught at review-time rather than runtime._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Test shape: the observation says 'a mirror whose committed `.dorfl.json` overrides one gate asserts both pool gates observe that same committed view' — should the regression test override (a) ONLY one gate (e.g. `autoBuild: false`) and assert autoSlice's view agrees, (b) BOTH gates with distinct non-default values and assert each gate sees its own committed value, or (c) both shapes?**

> Shape (a) is the minimal repro of the divergence (one gate overridden, the other defaulted — the readers must agree on what the committed file says). Shape (b) also locks in that the mirror-ref reader correctly threads each gate's value (not just that the two readers AGREE on a default). The observation's wording is closer to (a) but (b) is the stronger regression.

_Suggested default: Shape (b): commit a `.dorfl.json` that sets BOTH `autoBuild` and `autoSlice` to non-default values in a fixture bare mirror, run `scan()`, and assert the resulting `RepoReport`/pool-gate decisions reflect BOTH committed values — strongest regression and pins down the mirror-ref reader's per-gate fidelity in one test._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Per-machine override threading: `scan()` passes `options.override` (the `ConfigOverrideMap` from `loadConfigOverride`) into the working-tree `resolveRepoConfig` call for autoBuild. Does `resolveRepoConfigFromMirror` accept / honour the same `override` argument, and if not, is preserving the per-machine-override layering for autoBuild IN-SCOPE for this slice (vs. a follow-up)?**

> `scan.ts` ~L362-372 explicitly documents threading `options.override` 'into the SAME per-repo resolution `do`/`run` use … ADR per-machine-config-override-layer'. If `resolveRepoConfigFromMirror` does not take an `override` parameter, blindly swapping the reader would silently drop per-machine override layering for the autoBuild gate — that would be a regression hidden inside the 'unification' fix. The current autoSlice call at ~L397 should be checked the same way.

_Suggested default: In-scope: the swap MUST preserve per-machine override layering. If `resolveRepoConfigFromMirror` does not already accept `override`, extend it (or wrap it) so both gates honour `options.override` after the swap, and assert that in the test (a per-machine override of one gate is observed by both gates)._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
