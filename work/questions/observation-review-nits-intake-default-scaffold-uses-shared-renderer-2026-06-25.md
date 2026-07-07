<!-- dorfl-sidecar: item=observation:review-nits-intake-default-scaffold-uses-shared-renderer-2026-06-25 type=observation slug=review-nits-intake-default-scaffold-uses-shared-renderer-2026-06-25 allAnswered=false -->

## Q1

**Nit 1 — widened visibility of `renderBacklogTask` and `renderPrd` (module-private → exported) solely to let a characterisation test call them directly: ratify as-is, narrow back (drive the test through public callers), or promote to a task to do that narrowing?**

> intake.ts L1581 / L1638 changed `function` to `export function`. Grep confirms the only consumer of the widened exports is test/intake-default-scaffold.test.ts — no production code imports them. This is the standard characterisation-test pattern (pin behaviour via a direct call before/after a refactor) and is fully reversible. Footprint of the widening is effectively nil.

_Suggested default: Keep as-is (ratify) and delete this observation — standard characterisation-test pattern with zero production-side footprint; revisit only if a future refactor wants to re-narrow the surface._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Ratify as-is. Widening `renderBacklogTask`/`renderPrd` to exported solely for a characterisation test is the standard pin-behaviour pattern with zero production-side footprint (only the test imports them) and is fully reversible. Revisit only if a future refactor wants to re-narrow. Delete this observation once Q2 is answered too.

## Q2

**Nit 2 — benign edge difference between the shared renderer and the pre-rewire literal when `title` / `problemStatement` is empty (placeholder `'(no ## What to build prose was supplied.)'` vs. empty line): accept the new behaviour, or promote to a task to re-align?**

> buildable-body.ts `renderTaskBody` / `renderPrdBody` substitute the placeholder on empty inputs; the pre-rewire literal emitted an empty line. The intake call sites always pass a non-empty title/transform line (`review.title`, `verdict.prdTitle ?? slug`), and an empty title would already corrupt the frontmatter `title:` field upstream — so no realistic intake path reaches this branch. The placeholder is strictly safer if it ever did.

_Suggested default: Accept the new placeholder behaviour and delete this observation — the divergence is strictly safer and is unreachable from any current intake path._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Accept the new placeholder behaviour. The divergence (placeholder vs empty line on empty title/problemStatement) is strictly safer and is unreachable from any current intake path (call sites always pass a non-empty title, and an empty title would corrupt frontmatter upstream). Delete this observation.
