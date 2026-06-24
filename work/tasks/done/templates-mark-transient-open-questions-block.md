---
title: 'Templates: fence the transient open-questions block with a structural marker and move the autonomy-note instruction out of the durable body'
slug: templates-mark-transient-open-questions-block
brief: apply-reconciles-stale-open-questions
blockedBy: []
covers: [5]
---

## What to build

Establish the STRUCTURAL marker convention that lets the apply rung reconcile a resolved brief/task body deterministically, without guessing at author-controlled heading text.

End-to-end:

- In the brief template and the task template, wrap the transient "open questions" block with a stable HTML-comment fence (decision D1 in the brief, mirroring how the sidecar already uses HTML-comment markers): an opening marker (e.g. `<!-- open-questions -->`) and a matching closing marker (e.g. `<!-- /open-questions -->`). Everything an apply must strip on full resolution lives between the two markers; nothing durable does.
- Move the AUTHORING guidance "Set `needsAnswers: true` ... clear once answered" OUT of the durable rendered body (decision D2). Either drop it into a template HTML comment (not durable prose) so there is nothing stale to reconcile, OR fence it inside the same `open-questions` marker block so the existing reconciliation strips it too on full resolution. Pick one and apply it consistently across both templates.
- Mirror the change byte-identically into both protocol locations per this repo's two-place protocol discipline (see `AGENTS.md`): edit `skills/setup/protocol/brief-template.md` and `skills/setup/protocol/task-template.md` as the source of truth, and propagate identical content into `work/protocol/brief-template.md` and `work/protocol/task-template.md`. After the edit, `diff -r skills/setup/protocol work/protocol` shows no drift on these two files.
- Briefs and tasks AUTHORED BEFORE this change (without the marker) are intentionally untouched — there is no retrofit here (out of scope per the brief). The marker is additive, opt-in by virtue of being in the template.

## Acceptance criteria

- [ ] Brief template wraps the transient open-questions block with a stable HTML-comment marker pair, and the durable body no longer contains the "Set `needsAnswers: true` ... clear once answered" instruction as rendered prose.
- [ ] Task template carries the same marker convention (consistent with the brief template) so any future per-task `needsAnswers` flow has the same reconciliation seam.
- [ ] `skills/setup/protocol/brief-template.md` ↔ `work/protocol/brief-template.md` and `skills/setup/protocol/task-template.md` ↔ `work/protocol/task-template.md` are byte-identical (`diff -r skills/setup/protocol work/protocol` shows no drift on these files).
- [ ] The acceptance gate (`pnpm -r build && pnpm -r test && pnpm format:check`) stays green; if any existing snapshot/template-render test exists for the templates, it is updated alongside the template change.
- [ ] No code in `packages/dorfl/` is modified by this slice (the reconciliation logic lands in the sibling slice); this slice changes only the templates.

## Blocked by

- None — can start immediately. The marker string itself is decided in the brief (D1); the apply-side reconciliation slice can adopt it in parallel.

## Prompt

> Goal: introduce the structural marker convention the apply rung's body reconciliation will hinge on, by editing the brief and task TEMPLATES only. Read the source brief `work/briefs/ready/apply-reconciles-stale-open-questions.md` (decisions D1 and D2 specifically) before editing.
>
> Domain vocabulary: a "brief" is a launch snapshot in `work/briefs/ready/*.md`; the "open-questions block" is the transient section authors fill while `needsAnswers: true` and the apply rung must strip on full resolution; the "autonomy note" is the "Set `needsAnswers: true` ... clear once answered" authoring instruction that today appears as durable body prose and shouldn't.
>
> Where to look: `skills/setup/protocol/brief-template.md` and `skills/setup/protocol/task-template.md` (SOURCE OF TRUTH per `AGENTS.md`); `work/protocol/brief-template.md` and `work/protocol/task-template.md` (the propagated COPY for this repo; MUST stay byte-identical with the source). Also skim how `packages/dorfl/src/sidecar*.ts` already uses HTML-comment markers, so the marker style here matches house style.
>
> Seam to test at: the templates themselves — if there is an existing render or snapshot test covering them, update it. There is no apply-side logic in this slice.
>
> "Done" means: both templates carry the marker fence around the transient open-questions block; the autonomy-note instruction is no longer rendered durable prose (it lives in a template comment, or inside the same marker fence so the reconcile step strips it); the two protocol locations are byte-identical; the acceptance gate is green.
>
> Constraints: do NOT modify `apply-persist.ts` or any other runtime code in this slice — keep it file-orthogonal with the sibling reconciliation slice. Do NOT retrofit existing already-authored briefs/tasks in `work/` (out of scope per the brief). Follow the formatter-writer rule in `AGENTS.md` (`pnpm format` to fix, then verify with `pnpm format:check`). Do NOT perform git operations — the runner owns commits.
>
> Record non-obvious in-scope decisions in the done record (e.g. exact marker tag chosen if it differs from `<!-- open-questions -->`, whether the autonomy note went into a template comment vs. inside the fenced block, and why). If a marker-tag choice meets the ADR gate, write it as an ADR in `docs/adr/` instead.

---

### Claiming this task

```sh
dorfl claim templates-mark-transient-open-questions-block --arbiter origin
git fetch origin && git switch -c work/templates-mark-transient-open-questions-block origin/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/todo/templates-mark-transient-open-questions-block.md work/tasks/done/templates-mark-transient-open-questions-block.md
```
