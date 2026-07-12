---
promotedFrom: observation:prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch
---

## What to build

Add a one-line lens item to `REVIEW-PROTOCOL.md`'s lens list capturing the durable lesson from the third scope/boundary miss on the `spec`→`spec` cutover: **a clause belongs in the batch that owns the FILE it must edit** (splitting a wide refactor by CONCEPT instead of by FILE OWNERSHIP produces clauses with no home — e.g. batch 2 of the cutover had a `do spec:`/`advance spec:` verb-dispatch acceptance clause, but the dispatcher lives in `do.ts`/`advance.ts` which are batch 4's files, so the clause was unsatisfiable inside its own batch's scope fence).

The framing to add (as a review-side complement to TASKING-PROTOCOL §3a, which codifies the tasking-side rule): **for a wide-refactor task chain, FOR EACH acceptance clause, identify which file(s) must change and verify THIS batch owns them.** This is a distinct review lens from graph coherence / claim-vs-reality / destination coverage — none of those caught the miss, because it is a "can this batch physically edit only its own files and stay green" check.

This lens shares a home with the expand-first review lens (the sibling observation `prd-to-spec-identity-layer-needs-expand-first-not-hard-swap` also resolved to a REVIEW-PROTOCOL.md lens-list addition); both are review-side complements for wide-refactor chains. If the expand-first lens has already landed by the time this task runs, add the file-ownership lens as a sibling bullet in the same location; if not, this task adds only the file-ownership lens and the other rides in on its own task.

### Files

- `skills/setup/protocol/REVIEW-PROTOCOL.md` — **source of truth** (per repo AGENTS.md: edit here, never `work/protocol/` directly).
- `work/protocol/REVIEW-PROTOCOL.md` — propagated copy; mirror the same change byte-identically so `diff -r skills/setup/protocol work/protocol` stays clean.

### Where to put it

The existing lenses (§ "The lenses — apply IN ORDER, ending in the destination check") are numbered 1–5 and end in the destination check. The file-ownership lens is a **narrow, wide-refactor-specific** framing, not a general lens that applies to every review; the cleanest home is a short bullet appended to lens 3 (Cross-artifact composition / contract conformance) or to lens 5 (destination check), whichever the editor judges the better conceptual fit — do NOT insert it as a full new numbered lens (that would inflate the general list for a niche case). A one- or two-line bullet inside the closest existing lens is what the answer asked for ("one-line addition to REVIEW-PROTOCOL.md's lens list").

### Acceptance

- `REVIEW-PROTOCOL.md` (both copies) contains a bullet, inside an existing lens, that reviewers of a wide-refactor task set can apply: for each acceptance clause of each batch, identify the file(s) that must change and verify the batch owns them; a clause whose file lives in another batch is a scope-fence violation and must be moved to the batch that owns the file.
- `diff -r skills/setup/protocol/ work/protocol/` shows no drift between source and copy.
- `pnpm -r build && pnpm -r test && pnpm format:check` green.
- After landing, the source observation note `work/notes/observations/prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch.md` and its question sidecar can be deleted (the human's answer explicitly said "then delete"); do this as part of the same task if the harness permits, otherwise leave a follow-up crumb.

## Prompt

> Add a one-line/one-bullet lens item to `skills/setup/protocol/REVIEW-PROTOCOL.md` (and mirror it byte-identically into `work/protocol/REVIEW-PROTOCOL.md` — the second is a propagated copy of the first; see repo AGENTS.md) capturing this durable review-side lesson from the `spec`→`spec` cutover: **a clause belongs in the batch that owns the FILE it must edit.** For a wide-refactor task chain, reviewers must ask, FOR EACH acceptance clause of EACH batch, "which file(s) must change, and does THIS batch own them?" A clause whose file lives in another batch is a scope-fence violation and must be moved to the batch that owns the file.
>
> Concrete example that motivated this (include as an inline parenthetical if it fits, or drop if it does not): batch 2 of the `spec`→`spec` cutover had a `do spec:`/`advance spec:` verb-dispatch acceptance clause, but the dispatcher (`do.ts` L711/L1893, `advance.ts`, `advance-drivers.ts`, `do-autopick.ts`) is owned by batch 4 — so the clause was unsatisfiable inside batch 2's scope fence and the `do` agent correctly STOPPED. The fix was to move the clause into batch 4. Three consecutive `do`-agent stops on the same cutover (identity-layer needs expand-first; lock/sidecar expand surface missed; this one) all shared the shape "the review passed but a batch could not physically edit only its own files" — a class the current lenses (claim-vs-reality, cross-artifact composition, destination check) do not target.
>
> Place the bullet INSIDE an existing lens (lens 3 "Cross-artifact composition" or lens 5 "destination check" — pick whichever reads more naturally) rather than as a new top-level numbered lens; the answer explicitly asked for a one-line addition, not a whole new lens. If a sibling task adding an "expand-first / indirected-vs-hard-swap" lens (from observation `prd-to-spec-identity-layer-needs-expand-first-not-hard-swap`) has already landed, add this file-ownership bullet next to it. If not, add only this one; the other rides its own task.
>
> After the edit, confirm `diff -r skills/setup/protocol/ work/protocol/` shows no drift, then run `pnpm format` and confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green. The source observation note (`work/notes/observations/prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch.md`) and its question sidecar (`work/questions/observation-prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch.md`) should be deleted in the same change — the human's answer said "then delete" — unless the harness reserves note lifecycle for the engine, in which case leave them.
