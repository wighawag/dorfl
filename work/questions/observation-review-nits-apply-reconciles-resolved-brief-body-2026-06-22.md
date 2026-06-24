<!-- dorfl-sidecar: item=observation:review-nits-apply-reconciles-resolved-brief-body-2026-06-22 type=observation slug=review-nits-apply-reconciles-resolved-brief-body-2026-06-22 allAnswered=false -->

## Q1

**Nit 1: Should the three behavioural decisions (strip-all-pairs, fail-safe on unmatched fence, collapse `\n{3,}` → `\n\n`) be surfaced as a `## Decisions` block on the done task file / PR description for human ratification, rather than living only inside the `stripOpenQuestionsBlocks` JSDoc in `packages/dorfl/src/apply-persist.ts` (lines ~307-331)?**

> The slice prompt explicitly asked to record non-obvious in-scope decisions in the done record / PR description. The choices ARE recorded — but only in the source JSDoc; the commit message is single-line and the done task file has no Decisions block. The choices themselves look right; this is a ratification/visibility nit on Gate-2-approved work.

_Suggested default: keep — fold a one-paragraph Decisions block into the done task file retroactively (or accept as-is and tighten the slice template so future slices surface this automatically); not worth a new slice._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

## Q2

**Nit 2: Should the cross-slice contract — that `OPEN_QUESTIONS_MARKER_OPEN` / `OPEN_QUESTIONS_MARKER_CLOSE` (`<!-- open-questions -->` / `<!-- /open-questions -->`) are now load-bearing and shared with the un-claimed `templates-mark-transient-open-questions-block` slice — be made explicit, so the templates slice references / mirrors the same literal byte sequence instead of hand-retyping it in markdown templates?**

> `packages/dorfl/src/apply-persist.ts` exports the two constants. `work/tasks/todo/templates-mark-transient-open-questions-block.md` is unclaimed; markdown can't import TS, so the strings will be hand-typed there. A silent drift between the two byte sequences would break reconcile. The brief offered the strings as an example; this slice made them load-bearing.

_Suggested default: promote-task — add a one-line constraint to the templates slice brief pointing at the exported constants as the source of truth, with a test that asserts the template files contain those exact bytes._

<!-- q2 fields: id=q2 disposition=promote-task -->

**Your answer** (write below this line):

## Q3

**Nit 3: Should the markers be renamed to the namespaced form `<!-- dorfl-open-questions -->` / `<!-- /dorfl-open-questions -->` to match the existing `<!-- dorfl-sidecar: … -->` style in `sidecar.ts`, avoiding collisions with author-written HTML comments?**

> `packages/dorfl/src/sidecar.ts` (lines 26/473/546) uses the namespaced `dorfl-` prefix. The brief used the un-prefixed `<!-- open-questions -->` as an example AND said 'mirroring how the sidecar already uses HTML-comment markers' — strictly mirroring would have included the prefix. An author who writes `<!-- open-questions -->` in their own narrative prose would now trigger the strip (low probability, but namespace was free). Changing now is cheap because the templates slice is unclaimed and no on-disk task body uses the markers yet.

_Suggested default: promote-task — rename to `dorfl-open-questions` before the templates slice is claimed, while the blast radius is still zero; bundle with Nit 2._

<!-- q3 fields: id=q3 disposition=promote-task -->

**Your answer** (write below this line):

## Q4

**Nit 4: Was reconcile intentionally scoped to fire on ALL terminal-disposition routes (`keep` / `delete` / `dropped` / `needs-attention`) and the default full-resolve route alike, and if so should a belt-and-braces test be added covering at least one terminal-disposition route (e.g. `keep`) with a marker-fenced body, since the current three new tests in `packages/dorfl/test/apply-persist.test.ts` only exercise the default resolve and re-pause paths?**

> `packages/dorfl/src/apply-persist.ts` ~line 430: `const reconciledBody = stripOpenQuestionsBlocks(baseBody);` sits BEFORE the `terminal === 'keep'` branch and feeds keep/delete/default branches alike. The code's reading aligns with the brief's 'full resolution = anything that clears needsAnswers', but the slice phrasing 'FULL-RESOLUTION (no appendQuestions)' is ambiguous enough that a stricter reading is possible. No test currently locks the terminal-route behaviour.

_Suggested default: promote-task — small follow-up slice (or fold into Nit 2's templates slice) adding one parametrised test per terminal route to lock the scoping._

<!-- q4 fields: id=q4 disposition=promote-task -->

**Your answer** (write below this line):
