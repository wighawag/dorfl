---
promotedFrom: observation:prd-to-spec-identity-layer-needs-expand-first-not-hard-swap
---

## What to build

Add ONE new review lens to `skills/review/REVIEW-PROTOCOL.md`'s lens list (and mirror any propagated copy under `work/protocol/` if REVIEW-PROTOCOL is propagated there — check `diff -r skills/setup/protocol work/protocol` conventions; if REVIEW-PROTOCOL only lives under `skills/review/`, edit only there).

The lens, roughly worded:

> **Wide-refactor batch safety.** For a task chain that performs a pervasive rename / identifier cutover across many call sites, verify — per batch — that the batch is either (a) **indirected-safe** (the identifier being renamed is read through a key/indirection so a hard swap doesn't break downstream call sites and `pnpm -r build` stays green in isolation), or (b) **expand-first** (an earlier batch already added the new form beside the old across the whole non-indirected identity surface, so this batch is an additive migrate, and a later contract batch removes the aliases). A linear sequence of hard-swap `rename-*` batches over NON-indirected identifiers CANNOT stay green per-batch and must be rejected or restructured into expand → migrate → contract. This complements `TASKING-PROTOCOL.md` §3a on the reviewing side (§3a codifies the tasking-side rule; this lens is the review-time check that the rule was actually followed).

Match the surrounding lens entries in tone, length, and formatting — do not restructure the lens list, just add one bullet/entry in the appropriate place.

### Out of scope

- No spec, no ADR — the human explicitly chose the lightweight option (b): fold inline, no spec/ADR.
- No changes to `TASKING-PROTOCOL.md` §3a itself — it already codifies the tasking-side rule; this task is purely the review-side complement.
- No re-litigating the spec→spec identity-layer remediation — the expand-first task, the additive-migrate rechaining of batches 2/3/4, and the contract batch's alias-removal have already landed (the three tasks are in `tasks/done`). This task is ONLY the durable review-lens addition.

### Acceptance

- `skills/review/REVIEW-PROTOCOL.md` contains the new lens, phrased in-house and integrated into the existing lens list.
- If a propagated copy exists under `work/protocol/` or elsewhere, it is byte-identical to the source (per AGENTS.md protocol-propagation rule).
- `pnpm -r build && pnpm -r test && pnpm format:check` all pass (run `pnpm format` first if needed).

## Prompt

> Add a single new review lens to `skills/review/REVIEW-PROTOCOL.md` (source of truth) covering wide-refactor task chains: for each batch of a pervasive rename / identifier cutover, the reviewer must verify the batch is either **indirected-safe** (identifier read through a key/indirection, hard swap keeps `pnpm -r build` green alone) OR **expand-first** (a prior batch added the new form beside the old across the whole non-indirected surface, this batch is an additive migrate, and a later contract batch removes the aliases). A linear sequence of hard-swap `rename-*` batches over NON-indirected identifiers must be flagged. Frame it as the review-side complement to `TASKING-PROTOCOL.md` §3a (which already codifies the tasking-side rule). This lens exists because the spec→spec identity-layer chain shipped review-clean yet its batch 2 STOPPED at build-time — `fm.spec`/`'spec'` were non-indirected and read at ~28 downstream call sites, so a hard swap could not compile in isolation; review had checked graph coherence, claim-vs-reality, and destination coverage, but not per-batch compilability. First read the existing REVIEW-PROTOCOL to match its lens style, tone, and length; add ONE entry, don't restructure. If REVIEW-PROTOCOL is propagated (check `skills/setup/protocol/` vs `work/protocol/` per AGENTS.md), mirror the edit so the copies stay byte-identical. Do NOT open a spec or ADR — the human chose the lightweight inline-lens option. Do NOT touch §3a. Do NOT revisit the spec→spec remediation; those tasks (`expand-spec-frontmatter-and-namespace-aliases`, `rename-spec-config-and-intake`, `contract-spec-hard-cutover-rejection-and-leak-scan`) are already in `tasks/done`. Finish with `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.
