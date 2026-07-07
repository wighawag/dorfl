## Context

This task exists to ratify one of the two non-obvious decisions the agent silently made while landing 'promotion-buildPromotedBody-uses-shared-renderer' (Gate 2 approved) — surfaced by the review-nits sidecar `work/questions/observation-review-nits-promotion-buildPromotedBody-uses-shared-renderer-2026-06-25.md` (nit 2, part a).

When the shared buildable-body renderer was extracted, the convention landed as: the **frontmatter writer** owns the single blank line between the closing `---` fence and the first heading of the body (implemented as `fenceToBody = frontmatter.join('\n') + '\n\n'`), and the shared renderer starts at its first heading with NO leading blank line. This is currently captured only as an inline code comment in `src/buildable-body.ts` — not as a ratifiable decision record, and no `## Decisions` block was written into the done record for the promoted task even though its instructions asked for one.

This convention is **load-bearing across tasks**: the sibling task that makes the intake path adopt the same shared renderer will rely on it. If it drifts, we regain the fence-spacing bug class that already caused a prior requeue.

Scope-note on the OTHER nits in the parent observation (do NOT do here):
- Nit 1 (empty-mechanism placeholder wording drift, `(no `## What to build` prose was supplied.)` etc.) is being folded into the keystone review sidecar `work/questions/observation-review-nits-shared-buildable-task-and-prd-body-renderer-extract-2026-06-25.md`, where the placeholder wording is already queued for human ratification. Do not duplicate that work here.
- Nit 2b (the missing `## Decisions` block itself) is subsumed by nit 1's placeholder-ratification path and is tracked by the standing decisions-block meta-observation. Do not spawn per-occurrence follow-ups here.

## What to build

Write ONE ratified decision record — either an ADR-lite entry under `docs/adr/` (preferred, since this is a cross-module convention) OR a `## Decisions` block appended to the appropriate done record for `promotion-buildPromotedBody-uses-shared-renderer` — that states:

1. **Convention.** The frontmatter serializer owns the single blank line separating the closing `---` fence from the first heading of the buildable body. Concretely: the frontmatter block ends with `\n\n` (one newline to close the fence line, one blank line), and the shared buildable-body renderer emits its first heading with NO leading blank line and NO leading whitespace.
2. **Why here and not in the renderer.** Frontmatter is optional/absent in some callers and its serializer already knows whether it emitted anything; putting the separator there keeps the shared renderer's output identical whether or not frontmatter is present, and avoids double-blank-lines when composed. This is the shape that made the fence-spacing byte-comparison identical to the pre-rewire output on the common path.
3. **Blast radius.** Every current and future caller of the shared buildable-body renderer (task promotion path, PRD promotion path, and the pending sibling task that rewires the intake path to the same renderer) must obey this split. A renderer caller that emits its own trailing blank after frontmatter, OR a future renderer edit that adds a leading blank at the heading, reintroduces the fence-spacing drift class.
4. **Enforcement hook.** Note that the existing empty-mechanism test asserts only the `## Prompt` seed and does NOT catch a stray blank-line drift at the fence↔heading boundary — the same blind-spot pattern that caused the prior fence-spacing requeue. Recommend (do not necessarily implement in this task) a byte-level assertion in at least one renderer test that pins the exact `---\n\n# <first-heading>` boundary for both the frontmatter-present and frontmatter-absent cases.
5. **Pointer.** Cite the concrete code site (`src/buildable-body.ts` around the `fenceToBody` construction, and the renderer's first-heading emission) so a future reader can locate the invariant without archaeology.

If you choose ADR-lite, follow `work/protocol/ADR-FORMAT.md`. If you choose a `## Decisions` block on the done record, place it under the existing done record for `promotion-buildPromotedBody-uses-shared-renderer` and keep the same five points.

## Out of scope

- Changing any renderer behavior. This is a documentation/ratification task; no `src/` code change is required unless a comment needs to be updated to point at the new record.
- Landing the enforcement-hook test itself (point 4 is a recommendation for a follow-up; a separate observation may be spawned for it).
- Anything about the empty-mechanism placeholder wording (nit 1) — that is the keystone sidecar's job.

## Done when

- A single ratified record (ADR-lite or `## Decisions` block) exists in the repo carrying points 1–5 above.
- Any inline code comment in `src/buildable-body.ts` that currently carries this convention as a floating remark is updated to cross-reference the new record.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- The done record for THIS task notes explicitly which of the two forms (ADR-lite vs `## Decisions` on the sibling done record) was chosen and why, so the sibling intake-adopts-renderer task can find it.
