<!-- dorfl-sidecar: item=observation:review-nits-shared-buildable-task-and-prd-body-renderer-extract-2026-06-25 type=observation slug=review-nits-shared-buildable-task-and-prd-body-renderer-extract-2026-06-25 allAnswered=false -->

## Q1

**What should become of this observation overall — keep as a durable review-nits note, promote any/all of the three nits into follow-on tasks, fold the ratifications into an ADR/decisions block, or delete once the individual nits below are dispositioned?**

> Native observation-triage question. The note is a durable home for 3 non-blocking nits from the APPROVED Gate-2 review of 'shared-buildable-task-and-prd-body-renderer-extract' (task already in work/tasks/done/). It carries `status: open`; it will sit indefinitely unless triaged. The three sub-questions below cover the individual nits; this question covers the container.
>
> Source: work/notes/observations/review-nits-shared-buildable-task-and-prd-body-renderer-extract-2026-06-25.md

_Suggested default: Disposition each nit below, then delete this observation (its purpose is exhausted once the nits are answered)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Disposition each nit below (Q2-Q4), then delete this observation. Its purpose is exhausted once the nits are answered.

## Q2

**Ratify the BODY-only rendering seam: renderTaskBody/renderPrdBody emit only the markdown AFTER the frontmatter fence, and each caller keeps its own frontmatter writer. Endorse as the intended boundary, or require it be revisited (e.g. push frontmatter into the shared renderer too)?**

> Nit #1 in the observation. The agent made this seam decision without a `## Decisions` block on the PR; reviewer notes it matches PRD US #5 ('writers stay distinct') but it is an un-stated boundary worth a human nod.
>
> Source: packages/dorfl/src/buildable-body.ts module doc; renderTaskBody returns sections only, no `---` fence.

_Suggested default: Ratify as-is — matches PRD US #5; record the ratification (e.g. in a short ADR or commit-trailer) so the next maintainer sees it was deliberate._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Ratify the BODY-only rendering seam (each caller keeps its own frontmatter writer; the shared renderer emits only the markdown after the fence). It matches PRD US #5 ("writers stay distinct"). No need to push frontmatter into the shared renderer. The placeholder-wording ratification queued here (from the promotion sidecar) is also covered under Q3.

## Q3

**Ratify the empty-input placeholder fallbacks in the shared renderer (e.g. '(no `## What to build` prose was supplied.)' for missing whatToBuild/problemStatement), or require different behaviour (throw, omit the section, leave blank)?**

> Nit #2 in the observation. Currently the renderer silently substitutes placeholder prose when callers pass empty input.
>
> Source: packages/dorfl/src/buildable-body.ts (empty-input fallbacks around the section emitters).

_Suggested default: Ratify the placeholder-prose fallback — it preserves a valid buildable shape and signals 'author forgot this section' loudly in the rendered file._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Ratify the empty-input placeholder fallbacks (e.g. '(no `## What to build` prose was supplied.)'). They preserve a valid buildable shape and signal "author forgot this section" loudly in the rendered file, better than throwing or silently omitting. This is the canonical wording the promotion-buildPromotedBody sidecar deferred here for ratification, so it is now ratified.

## Q4

**How should the prompt-seed divergence be resolved when promotion is rewired to call renderTaskBody? The shared renderer's default seed is 'Build the task described above.' but triage-persist.ts buildPromotedBody currently emits the slug-bearing 'Build the task \'<slug>\', described above.' — should promotion pass the slug-bearing seed in explicitly to preserve byte-for-byte output, or is it acceptable to switch promoted tasks to the generic seed?**

> Nit #3 in the observation, and the one with a downstream consequence. Confirmed in code:
>   packages/dorfl/src/buildable-body.ts:110  → 'Build the task described above.'
>   packages/dorfl/src/triage-persist.ts:439  → `Build the task '${slug}', described above.`
> If the follow-on rewire task is not warned, promoted-task output will silently change.

_Suggested default: Pass the slug-bearing seed in explicitly when promotion is rewired (preserve byte-for-byte output); capture this constraint in the follow-on task's acceptance criteria._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Pass the slug-bearing seed (`Build the task '<slug>', described above.`) in explicitly when promotion is rewired to call renderTaskBody, to preserve byte-for-byte output. Capture this as an explicit acceptance criterion on the follow-on rewire task so promoted-task output does not silently change to the generic seed.
