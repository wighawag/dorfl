# Frontmatter owns the blank line between the closing `---` fence and the buildable body's first heading

**Context.** The shared buildable-body renderer (`packages/dorfl/src/buildable-body.ts`, `renderTaskBody` / `renderPrdBody`) is called by TWO producers of buildable task / PRD markdown that each write their OWN frontmatter block: promotion (`packages/dorfl/src/triage-persist.ts` `buildPromotedBody`) today, and intake (`packages/dorfl/src/intake.ts` `renderBacklogTask` / `renderPrd`) once the sibling task rewires it. The exact byte layout at the `---` fence ↔ first-heading boundary is load-bearing: a prior fence-spacing drift produced `---\n## What to build` instead of `---\n\n## What to build` and forced a Gate-2 requeue on `promotion-buildPromotedBody-uses-shared-renderer` (see its `## Requeue 2026-06-25` note). The empty-mechanism test only asserted the `## Prompt` seed and did not catch the missing blank line at the boundary.

**Decision.** The **frontmatter serializer** owns the single blank line separating the closing `---` fence from the first heading of the buildable body. Concretely: the frontmatter block ends with `\n\n` (one newline to close the fence line, one newline for the blank line); the shared buildable-body renderer emits its first heading with **NO leading blank line and NO leading whitespace**. The composed shape is exactly `---\n\n# <first-heading>` — or, in this repo's `##`-level bodies, `---\n\n## <first-heading>`.

**Why here, not in the renderer.** Frontmatter is optional/absent in some callers, and its serializer already knows whether it emitted anything; putting the separator there keeps the shared renderer's output byte-identical whether or not frontmatter is present, and avoids double-blank-lines when composed. This is the shape that made the fence-spacing byte comparison identical to the pre-rewire promotion output on the common path.

**Blast radius.** Every current and future caller of the shared buildable-body renderer must obey this split:

- promotion (`triage-persist.ts` `buildPromotedBody`, the `fenceToBody = frontmatter.join('\n') + '\n\n'` site around L471),
- the pending sibling task that rewires the intake path (`intake.ts` `renderBacklogTask` / `renderPrd`) to the same renderer, and
- any future consumer of `renderTaskBody` / `renderPrdBody`.

A renderer caller that emits its own trailing blank AFTER frontmatter (so the composition becomes `---\n\n\n##`), OR a future edit to `renderTaskBody` / `renderPrdBody` that adds a leading blank at the heading (so a frontmatter-less caller becomes `\n##`), reintroduces the fence-spacing drift class.

**Enforcement hook (recommended, not landed here).** The existing empty-mechanism test asserts only the `## Prompt` seed and does NOT catch a stray blank-line drift at the fence↔heading boundary — the same blind-spot pattern that caused the prior requeue. A follow-up should add a byte-level assertion in at least one renderer / caller test that pins the exact `---\n\n## <first-heading>` boundary for BOTH the frontmatter-present and frontmatter-absent cases. This ADR RECORDS the recommendation; it does not implement it (a separate observation may be spawned).

**Pointer.**

- Frontmatter side (owns the trailing `\n\n`): `packages/dorfl/src/triage-persist.ts` `buildPromotedBody`, the `fenceToBody = frontmatter.join('\n') + '\n\n'` construction (~L471). The inline comment there cross-references this ADR.
- Renderer side (starts at the first heading with no leading blank): `packages/dorfl/src/buildable-body.ts` `renderTaskBody` (initial `lines: string[] = ['## What to build', '', …]`) and `renderPrdBody` (initial `lines: string[] = ['## Problem Statement', '', …]`).

**Consequences.** The convention pins a small cross-module invariant that the type system does not express, so it must be defended by comments + a byte-level test (see the enforcement hook). The gain is that the shared renderer's output is context-free — every caller composes it the same way — which is the whole point of extracting it. Naming/coherence: no new concept is introduced; this ratifies the existing implementation shape.
