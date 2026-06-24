---
title: 'Apply rung RECONCILES the resolved item body on full resolution (strips the marker-fenced open-questions block), leaving re-pause untouched'
slug: apply-reconciles-resolved-brief-body
brief: apply-reconciles-stale-open-questions
blockedBy: []
covers: [1, 2, 3, 4]
---

## What to build

Teach the apply rung to RECONCILE the item body on the FULL-RESOLUTION route, not just append `## Applied answers`. When apply folds in the human's answers and clears `needsAnswers`, it must also remove the content those answers supersede so the resolved item reads as resolved — eliminating the claim-vs-reality drift the brief documents.

End-to-end thin slice:

- Add a reconcile step in `packages/dorfl/src/apply-persist.ts` (alongside / inside `withAppliedAnswers` or as a sibling helper composed into the resolve path) that strips a marker-fenced "open-questions" block from the item body. The marker convention is decided by the brief (D1): an HTML-comment fence pair, sibling-slice `templates-mark-transient-open-questions-block` introduces it in the templates. The strip is STRUCTURAL — it matches the marker pair, NOT the visible heading text.
- Wire the reconcile to fire ONLY on the FULL-RESOLUTION disposition (no follow-up questions appended, `needsAnswers` going to `false`). The re-pause route (`appendQuestions.length > 0`) keeps today's behaviour exactly: the open-questions block is legitimately still open and must stay (D3).
- Backward compatibility: items authored without the marker pair are left as-is by the reconcile (no marker → nothing to strip → identical bytes to today, no regression). This covers both already-applied briefs (out of scope to retrofit, per the brief) and any non-template-authored items.
- Tests, mirroring the existing apply-rung test pattern (throwaway git repos):
  1. Full-resolution apply on an item whose body has a marker-fenced open-questions block → block is GONE, `## Applied answers` is present, `needsAnswers:false`, sidecar deleted (the resolved-reads-as-resolved invariant + existing invariants).
  2. Re-pause apply (follow-up questions appended) on the same shape of body → open-questions block is RETAINED, `needsAnswers` stays true, sidecar re-paused (reconcile did not fire).
  3. Full-resolution apply on a body with NO marker → behaves exactly as today: append-only, no strip, no crash (backward compat).
  4. Existing apply-rung invariant tests stay green (no regression on `needsAnswers:false ⇔ sidecar deleted`, terminal-disposition routing, keep/delete/needs-attention/dropped paths).

## Acceptance criteria

- [ ] `apply-persist.ts` strips a marker-fenced open-questions block on the FULL-RESOLUTION route as part of the same atomic commit that records `## Applied answers` and deletes the sidecar.
- [ ] The RE-PAUSE route (`appendQuestions` non-empty) is byte-for-byte unchanged relative to today's behaviour with respect to the open-questions block (it is retained).
- [ ] An item body without the marker pair is left untouched by the reconcile (backward compatible — no false positives from heading-text matching).
- [ ] New tests cover: marker-present full-resolution strips; marker-present re-pause retains; marker-absent full-resolution behaves as today. Tests use throwaway git repos (the existing apply-persist test style).
- [ ] All existing apply-rung tests stay green; the `needsAnswers:false ⇔ no active sidecar` invariant is preserved; terminal-disposition routes (`keep` / `delete` / `dropped` / `needs-attention`) are unchanged.
- [ ] The acceptance gate (`pnpm -r build && pnpm -r test && pnpm format:check`) is green.
- [ ] No template files are edited by this slice (templates land in the sibling slice); this slice edits only `apply-persist.ts` and its tests.

## Blocked by

- None — can start immediately. The marker convention is fixed by the brief (D1); both this slice and `templates-mark-transient-open-questions-block` can land in either order. Items authored before the templates carry the marker are still safely handled (the backward-compat clause).

## Prompt

> Goal: make the apply rung RECONCILE the resolved item body on the full-resolution route — strip the now-stale marker-fenced open-questions block in the same atomic commit that records `## Applied answers` and deletes the sidecar. Read the source brief `work/briefs/ready/apply-reconciles-stale-open-questions.md` fully first (decisions D1 / D2 / D3 are the contract).
>
> Domain vocabulary: the "apply rung" is the advance engine's APPLY step (`applyAnsweredQuestions` in `packages/dorfl/src/apply-persist.ts`); the "FULL-RESOLUTION route" clears `needsAnswers` and deletes the sidecar in one commit (vs. the RE-PAUSE route which appends follow-up questions and stays `needsAnswers:true`); the "open-questions block" is the transient body section the apply must strip when its questions have been answered; the "marker" is a structural HTML-comment fence pair the templates (sibling slice) introduce so apply doesn't have to guess at heading text.
>
> Where to look in the codebase: `packages/dorfl/src/apply-persist.ts` (this is the fix site — specifically `withAppliedAnswers` and the resolve path in `applyAnsweredQuestions`); `packages/dorfl/src/sidecar*.ts` for the existing HTML-comment marker style to mirror; `packages/dorfl/test/` for the apply-rung test pattern and the throwaway-git-repo helpers. The brief's "Fix site" line (D1) calls out this exact module.
>
> Seam to test at: the `applyAnsweredQuestions` entry point — feed it a working tree with a sidecar of fully-answered entries and an item body that does (and separately does not) carry the marker pair; assert on the post-commit body, the sidecar's absence, and the frontmatter `needsAnswers` value. Also exercise the re-pause path (with `appendQuestions` non-empty) and assert the open-questions block is retained.
>
> "Done" means: the three new tests above pass; all existing apply-rung tests stay green; the resolved item body reads as resolved (no leftover "## Open questions" content inside the marker fence) while bodies without the marker are unchanged.
>
> Constraints: the reconcile must fire ONLY on FULL-RESOLUTION (no `appendQuestions`), NEVER on re-pause (D3); the strip MUST be structural (marker-pair based), not a regex over a heading like `## Open questions` (the brief explicitly warns this is fragile, D1); items without the marker MUST be untouched (backward compat). Do NOT edit the templates in this slice (sibling slice owns that). Do NOT auto-delete or retro-rewrite already-applied briefs (out of scope). Do NOT perform git operations on this repo — runner owns commits.
>
> Record non-obvious in-scope decisions in the done record / PR description (e.g. whether reconciliation also strips multiple marker pairs vs. exactly one; behaviour when an opening marker lacks a matching closing one — fail-loud vs. fail-safe; whether trailing whitespace around the stripped block is collapsed). If a choice meets the ADR gate (`ADR-FORMAT.md`), write an ADR in `docs/adr/` instead of just noting it.

---

### Claiming this task

```sh
dorfl claim apply-reconciles-resolved-brief-body --arbiter origin
git fetch origin && git switch -c work/apply-reconciles-resolved-brief-body origin/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/todo/apply-reconciles-resolved-brief-body.md work/tasks/done/apply-reconciles-resolved-brief-body.md
```
