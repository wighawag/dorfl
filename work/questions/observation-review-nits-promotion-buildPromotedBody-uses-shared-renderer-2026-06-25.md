<!-- dorfl-sidecar: item=observation:review-nits-promotion-buildPromotedBody-uses-shared-renderer-2026-06-25 type=observation slug=review-nits-promotion-buildPromotedBody-uses-shared-renderer-2026-06-25 allAnswered=false -->

## Q1

**What should become of this observation recording the two non-blocking nits from the Gate-2 approve of 'promotion-buildPromotedBody-uses-shared-renderer' — promote either/both to a task, fold them into the already-pending keystone review of the shared renderer extract, keep as a standing note, or delete?**

> Observation file: work/notes/observations/review-nits-promotion-buildPromotedBody-uses-shared-renderer-2026-06-25.md (status: open, reviewOf: promotion-buildPromotedBody-uses-shared-renderer; Gate 2 APPROVED, integration not blocked).
>
> It carries TWO distinct nits, each potentially a separate triage call:
>
> (1) EMPTY-MECHANISM PLACEHOLDER WORDING DRIFT. For an observation with no mechanism prose, the lead-section placeholder text changed from pre-rewire '(no mechanism/fix prose was carried from the observation.)' to the renderer's canonical '(no `## What to build` prose was supplied.)' / '(no `## Problem Statement` prose was supplied.)' (src/buildable-body.ts:93,143). The task asked for byte-for-byte-unchanged output; impact is cosmetic (human filler in a rare reachable edge), dispatchability/semantics unchanged, no validator reads it. The observation itself notes this was 'already flagged for ratification at the keystone review' — sidecar work/questions/observation-review-nits-shared-buildable-task-and-prd-body-renderer-extract-2026-06-25.md — so it may already be covered there. It also notes the new empty-mechanism test asserts only the `## Prompt` seed, NOT this placeholder line, recreating the same byte-drift-the-test-misses pattern that caused the prior fence-spacing requeue.
>
> (2) MISSING `## Decisions` BLOCK in the done record / commit bodies, despite the task explicitly saying 'Record any non-obvious decision in the done record'. Two in-scope decisions the agent made unilaterally and should be ratified: (a) OWNERSHIP OF THE FENCE SEPARATOR — the frontmatter writer now owns the single blank line between the `---` fence and the first heading (`fenceToBody = frontmatter.join('\n') + '\n\n'`) because the shared renderer starts at its heading with no leading blank; this convention is load-bearing for intake too when it adopts the renderer (sibling task), so it is a cross-task interaction. (b) Adopting the renderer's empty-prose placeholder (same as nit 1). Currently captured only as inline code comments, not as a ratifiable decision record. There is a separate standing observation 'observation-decisions-block-convention-repeatedly-skipped-enforce-or-relax-2026-06-22.md' tracking this recurring miss at the process level.

_Suggested default: Fold nit (1) into the existing keystone-review sidecar (observation-review-nits-shared-buildable-task-and-prd-body-renderer-extract-2026-06-25.md) where the placeholder wording is already queued for human ratification, AND promote-to-task nit (2)'s decision (a) — pin the fence-separator ownership convention as a real ## Decisions record / ADR-lite, since it is a cross-task load-bearing convention the sibling intake-adopts-renderer task will rely on. Treat nit (2)(b) as subsumed by nit (1). Then delete this observation. Do NOT spawn a fresh per-occurrence task for the missing-Decisions-block miss itself — that pattern is already tracked by observation-decisions-block-convention-repeatedly-skipped-enforce-or-relax-2026-06-22.md._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
