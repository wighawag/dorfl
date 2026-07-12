---
promotedFrom: observation:prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch
consolidates:
  - observation:prd-to-spec-identity-layer-needs-expand-first-not-hard-swap
---

## What to build

Add TWO new review lenses (as bullets inside the existing lens list) to `REVIEW-PROTOCOL.md`, both review-side complements to `TASKING-PROTOCOL.md` §3a for wide-refactor task chains. Both were ratified as the lightweight "fold inline, no spec/ADR" option.

> NOTE (consolidation): this task was merged from two apply-rung tasks that each added a bullet to the SAME lens list (the expand-first lens from `prd-to-spec-identity-layer-needs-expand-first-not-hard-swap`, and this file-ownership lens). Doing both edits in one task avoids a parallel-edit conflict and a wrong-path bug: the expand-first task pointed at `skills/review/REVIEW-PROTOCOL.md`, which does NOT exist. The real source of truth is `skills/setup/protocol/REVIEW-PROTOCOL.md`, mirrored to `work/protocol/REVIEW-PROTOCOL.md` (per repo AGENTS.md).

### Lens A — expand-first / indirected-vs-hard-swap

> **Wide-refactor batch safety.** For a task chain that performs a pervasive rename / identifier cutover across many call sites, verify — per batch — that the batch is either (a) **indirected-safe** (the renamed identifier is read through a key/indirection, so a hard swap does not break downstream call sites and `pnpm -r build` stays green in isolation), or (b) **expand-first** (an earlier batch already added the new form beside the old across the whole non-indirected identity surface, so this batch is an additive migrate, and a later contract batch removes the aliases). A linear sequence of hard-swap `rename-*` batches over NON-indirected identifiers CANNOT stay green per-batch and must be rejected or restructured into expand → migrate → contract.

Motivation to weave in (parenthetical, keep short): the spec→spec identity-layer chain shipped review-clean yet its batch 2 STOPPED at build time — `fm.spec` / `'spec'` were non-indirected and read at ~28 downstream call sites, so a hard swap could not compile alone. Review had checked graph coherence, claim-vs-reality, and destination coverage, but not per-batch compilability.

### Lens B — file-ownership / clause-belongs-in-its-file's-batch

> **File ownership.** For a wide-refactor task chain, FOR EACH acceptance clause of EACH batch, identify which file(s) it must change and verify THIS batch owns them. A clause whose file lives in another batch is a scope-fence violation and must be moved to the batch that owns the file.

Motivation to weave in (parenthetical): batch 2 of the spec→spec cutover carried a `do spec:` / `advance spec:` verb-dispatch clause, but the dispatcher (`do.ts` L711/L1893, `advance.ts`, `advance-drivers.ts`, `do-autopick.ts`) is owned by batch 4, so the clause was unsatisfiable inside batch 2's scope fence and the `do` agent correctly STOPPED. The fix was to move the clause into batch 4.

These three consecutive `do`-agent stops on the same cutover (identity-layer expand-first, lock/sidecar expand surface missed, verb-dispatch file-ownership) all share the shape "review passed but a batch could not physically edit only its own files and stay green" — a class the current lenses (claim-vs-reality, cross-artifact composition, destination check) do not target.

### Files

- `skills/setup/protocol/REVIEW-PROTOCOL.md` — **source of truth** (per AGENTS.md: edit HERE, never `work/protocol/` directly).
- `work/protocol/REVIEW-PROTOCOL.md` — propagated copy; mirror both additions byte-identically so `diff -r skills/setup/protocol work/protocol` stays clean.

### Where to put them

The existing lenses are numbered and end in the destination check. Both new lenses are narrow, wide-refactor-specific framings, NOT general lenses that apply to every review. Do NOT inflate the general numbered list with two new top-level lenses. The cleanest home is a short bullet (or a small "wide-refactor sub-checklist" of two bullets) appended inside the closest existing lens — lens 3 (cross-artifact composition / contract conformance) is the natural fit, with lens 5 (destination check) as an alternative. The editor judges the best conceptual home; keep each lens to one or two lines and match the surrounding tone/format.

### Acceptance

- `REVIEW-PROTOCOL.md` (BOTH copies) contains both lenses, phrased in-house, integrated inside an existing lens rather than as two new top-level numbered lenses.
- `diff -r skills/setup/protocol/ work/protocol/` shows no drift between source and copy.
- `pnpm -r build && pnpm -r test && pnpm format:check` green (run `pnpm format` first if needed).
- After landing, both source observations and their question sidecars are dischargeable (the human's answers said "then delete"): `prd-to-spec-identity-layer-needs-expand-first-not-hard-swap` and `prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch`. Leave the git-state transition to the runner/harness.

## Prompt

> Add TWO review lenses to `skills/setup/protocol/REVIEW-PROTOCOL.md` (source of truth) and mirror both byte-identically into `work/protocol/REVIEW-PROTOCOL.md` (a propagated copy; see repo AGENTS.md). Do NOT look for `skills/review/REVIEW-PROTOCOL.md` — it does not exist.
>
> Both lenses are review-side complements to `TASKING-PROTOCOL.md` §3a for wide-refactor task chains. Add them as short bullets INSIDE an existing lens (lens 3 "cross-artifact composition" is the natural home; lens 5 "destination check" is the alternative) — do NOT add two new top-level numbered lenses; the answers explicitly asked for lightweight one-line additions.
>
> Lens A (expand-first): for each batch of a pervasive rename/identifier cutover, verify the batch is either indirected-safe (renamed identifier read through a key/indirection, hard swap keeps `pnpm -r build` green alone) OR expand-first (a prior batch added the new form beside the old across the whole non-indirected surface, this batch is an additive migrate, a later contract batch removes the aliases). Flag a linear sequence of hard-swap `rename-*` batches over non-indirected identifiers. Motivation (weave in briefly): the spec→spec chain shipped review-clean yet batch 2 stopped at build time — `fm.spec`/`'spec'` were non-indirected, read at ~28 call sites, could not compile alone.
>
> Lens B (file ownership): for a wide-refactor chain, FOR EACH acceptance clause of EACH batch, identify which file(s) must change and verify THIS batch owns them; a clause whose file lives in another batch is a scope-fence violation and must be moved to the batch that owns the file. Motivation (weave in briefly): batch 2 carried a `do spec:`/`advance spec:` verb-dispatch clause, but the dispatcher lives in `do.ts`/`advance.ts`/`advance-drivers.ts`/`do-autopick.ts` (batch 4's files), so the clause was unsatisfiable in batch 2 and the `do` agent correctly STOPPED.
>
> First read the existing REVIEW-PROTOCOL to match lens style, tone, and length. Add the two bullets (as a small wide-refactor sub-checklist inside one lens is fine). Then confirm `diff -r skills/setup/protocol/ work/protocol/` shows no drift, run `pnpm format`, and verify `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT touch §3a itself, do NOT open a spec/ADR, and do NOT revisit the already-landed spec→spec remediation tasks in `work/tasks/done/`. Do NOT perform any git operations; the runner owns git-state transitions (including deleting the two source observations/sidecars the answers marked "then delete").

## Requeue 2026-07-12

Requeued after fix 7be9bd2d: the prd-word leak-scan failure was caused by two unswept task bodies (promote-rename-cutover-lessons + sweep-prose-prd-colon), now fixed on main. This item failed only on the shared rebased tip, not its own content.
