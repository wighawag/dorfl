2026-06-13 — While building `advance-isolated-one-shot` I noticed the tree-less
advance rungs (surface/apply/triage) commit the sidecar / `needsAnswers` / marker
LOCALLY in their `cwd` working tree but NEVER push that commit to the arbiter:
`surface-persist.ts persistSurfacedQuestions` + `apply-persist.ts` do a local
`git commit`, and only the `advancing` borrow + `createItemThroughCas` (promote)
go through the CAS to the arbiter. In the registry-set loop driver
(`advance-loop-driver.ts`) the per-mirror cwd is a `git clone` of the bare mirror
that is RE-CREATED fresh each tick (`cli.ts buildRegistrySetAdvanceTick`'s
`treelessCwd`, `rmSync` then re-clone), so a surfaced sidecar appears to be lost on
the next tick unless something fetches it back — i.e. the loop/CI advance surface
may not actually reach the arbiter's `main`. The one-shot `advance --isolated`
slice works around this by ff-pushing the tree-less result to the arbiter after a
successful surface/apply/triage rung (see that slice's `## Decisions`), but the
loop/registry path was NOT changed. Worth a focused look: either the loop should
ff-push tree-less results too, or the treeless cwd should not be re-cloned fresh
each tick (so its committed sidecar persists), or surface/apply should integrate
through a shared band. Out of scope for `advance-isolated-one-shot`.
