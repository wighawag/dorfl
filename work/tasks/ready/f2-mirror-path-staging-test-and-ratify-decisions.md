## Context

Follow-up to the (now-done) slice `f2-surface-staging-config-and-pool-extension`. Gate 2 (code review) APPROVED that slice but raised non-blocking nits, tracked in observation `review-nits-f2-surface-staging-config-and-pool-extension-2026-06-22`. The human answered them:

- Q2 (silent decisions): **Ratify all four as-is** — coherent and doc-commented. The recurring `## Decisions`-block-skip pattern is tracked separately as its own meta-observation (answered RELAX there); NOT this task's job to fix.
- Q3 (missing mirror-path test): **Yes, add one** — this is the highest-value nit and the sole real deliverable of this follow-up.
- Q4 (stranded-sidecar edge): **Acknowledge as known low-impact edge**; document the create-vs-consume expectation rather than re-route `apply`. The realistic flip direction is off→on, and an answered staged sidecar only exists if surfacing (opt-in) minted it, so the strand window is narrow.

The observation stays open as the durable triage record for these nits; this task carries out the one action item.

## Scope — what to do

### 1. Add a direct test of `gatherLifecycleMirror`'s staging widening (primary deliverable)

The existing `packages/dorfl/test/surface-staging-config-and-pool.test.ts` exercises `gatherLifecycleInPlace` and `scanRepoPaths` (which dispatches to the in-place gather) plus a real-git apply/lock pair, but never invokes `gatherLifecycleMirror` or the new `resolveMirrorTaskStaging` / `resolveMirrorBriefStaging` methods directly. The mirror path is the one CI's propose-matrix actually runs against the bare hub mirror — via `readTaskStagingFromTree` / `readBriefStagingFromTree`, which parse `<ref>:work/tasks/backlog/*.md` and `<ref>:work/briefs/proposed/*.md` through `git ls-tree` + `git show` — and it is currently unverified.

Add a single test (extend `surface-staging-config-and-pool.test.ts` or add a sibling file) that:

1. Creates a working repo and seeds a staged `needsAnswers: true` item (task or brief) under `work/tasks/backlog/` (or `work/briefs/proposed/`).
2. Initializes a bare mirror and pushes the working repo to it (real git, matching the style already used in the existing test).
3. Calls `gatherLifecycleMirror({ ..., gates: { surface: true, surfaceStaging: true } })` against the bare mirror and asserts the staged item appears in `.surface` (i.e. is enumerated into the surface pool via `needsAnswers[]`).
4. Calls the same with `gates: { surface: true, surfaceStaging: false }` and asserts the staged item is NOT enumerated (empty surface, or at least does not contain the staged item).

This exercises `resolveMirrorTaskStaging` / `resolveMirrorBriefStaging` and the `git ls-tree` + `git show` mirror readers end-to-end.

### 2. Record the ratified decisions (small doc touch)

Because the original slice's commit/PR body had no `## Decisions` block, ratify the four decisions in-band so future readers don't have to re-derive them. Preferred: a short `## Decisions` block in THIS task's commit/PR body (belt-and-braces: also acceptable to add a brief note near the relevant code, e.g. a doc-comment on `LifecyclePoolGates.surfaceStaging` if not already clear, or on the four new `LedgerReadStrategy` methods). Ratify:

1. **Split default is intentional.** `LifecyclePoolGates.surfaceStaging` defaults `false` at the library boundary; `Config.surfaceStaging` defaults `true` at the user-visible layer. The calm library default is load-bearing for any direct caller of `gatherLifecycle*` that doesn't thread CLI gates.
2. **Four new public methods on `LedgerReadStrategy` are intentional** (`resolveLocalTaskStaging`, `resolveLocalBriefStaging`, `resolveMirrorTaskStaging`, `resolveMirrorBriefStaging`), rather than overloading `resolveLocalState` / `resolveMirrorState` with a flag. Keeps the state vs. staging axes orthogonal at the interface.
3. **The `surfaceStaging` gate is consumed by the GATHER, not by pure `buildLifecyclePools`,** even though the field lives on `LifecyclePoolGates`. Placement acknowledged in the existing doc comment; ratified here as intentional.
4. **`surfaceStaging` in `REPO_ALLOWED_KEYS` is intentional** so a repo's `.dorfl.json` can flip it via the normal resolution chain.

### 3. Document the create-vs-consume edge (small doc touch)

Do NOT re-route `apply` to bypass the gate. Instead, add a short note (in the doc-comment on `surfaceStaging` in `LifecyclePoolGates`, or the ADR `ci-config-policy-and-gate-family` §4 if lightweight, or a nearby comment in `lifecycle-gather.ts` `gatherLifecycleInPlace`) capturing:

> `surfaceStaging` gates CREATE (surface-side enumeration). Apply consumes via the same enumeration, so flipping `surfaceStaging` true→false after a surface tick has minted+answered a staged sidecar can strand that sidecar until the flag is flipped back on. Realistic flip direction is off→on, and an answered staged sidecar only exists if surfacing (opt-in) minted it, so the strand window is narrow and accepted. Revisit only if the create-vs-consume invariant must hold strictly.

## Out of scope

- Any refactor of the four new `LedgerReadStrategy` methods into a flag-parameterized form (Q2 ratified as-is).
- Re-routing `apply` to consume regardless of `surfaceStaging` (Q4 acknowledged as accepted edge).
- Fixing the recurring skipped-`## Decisions`-block pattern (tracked and answered RELAX on its own meta-observation).

## Acceptance

- New test exists that seeds a staged `needsAnswers` item, pushes to a bare mirror, and asserts `gatherLifecycleMirror` enumerates it under `surfaceStaging:true` and does not under `surfaceStaging:false`.
- Test grep-matches `surfaceStaging` AND a `gatherLifecycleMirror` call site in the same file.
- The four ratified decisions are recorded (at minimum in this task's commit/PR body under `## Decisions`).
- The create-vs-consume strand edge is documented near the gate.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.