<!-- dorfl-sidecar: item=observation:review-nits-extend-renderprdbody-with-solution-and-userstories-inputs-2026-06-25 type=observation slug=review-nits-extend-renderprdbody-with-solution-and-userstories-inputs-2026-06-25 allAnswered=false -->

## Q1

**What becomes of this review-gate nit — should the follow-on rewire task that actually wires `renderPrdBody` into `intakes` be required to lock byte-for-byte renderer↔intake equivalence with a `.toBe` golden (covering PS+Solution+UserStories and the trailing-newline detail the observation manually verified), or do you want this kept as a standalone observation / promoted to its own task / deleted?**

> The observation (`work/notes/observations/review-nits-extend-renderprdbody-with-solution-and-userstories-inputs-2026-06-25.md`) records Gate 2 APPROVED the task but flagged that `buildable-body.test.ts` only asserts the intake-scaffold default shape via `toContain` (sections present + order), while the byte-for-byte `.toBe` is only on the promotion (neither-new-input) case. The reviewer manually verified equivalence (renderer output ends `...<userStories>\n` and `intakes.renderPrd` builds the same sections then appends one `\n`, so bytes match) but notes 'the renderer-reproduces-intake byte-for-byte claim in the task is not directly asserted here' and suggests 'the rewire task should lock this with a toBe.' The task itself is additive-only and does not rewire intake, so this is correctly scoped out — the question is purely what should happen to the durable nit.

_Suggested default: Fold into the follow-on rewire task as an explicit acceptance criterion ('add a `.toBe` golden asserting renderer output equals current `intakes.renderPrd` output byte-for-byte for the PS+Solution+UserStories case, including the trailing-newline detail'), then delete this observation. It is a one-line constraint on a task that already has to exist; promoting it to its own task would fragment a single piece of work, and keeping it as an open observation risks it being silently dropped when the rewire lands._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
