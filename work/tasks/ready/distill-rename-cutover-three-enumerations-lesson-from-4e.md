---
promotedFrom: observation:prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10
---

## What to build

Harvest the durable lesson from `work/notes/observations/prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10.md` into a SHARED cutover-lessons note under `work/notes/findings/`, then delete the observation. Batch 4e itself has already landed (`work/tasks/done/rename-spec-residual-exported-symbols-and-prdslandIn-plumbing.md`); this task is purely the lesson-capture + drop, NOT any code work.

The lesson to preserve (verbatim intent, tightened prose is fine):

> A rename cutover's coverage audit needs THREE separate enumerations, not one:
> 1. **VALUE consumers** — `=== 'old'` sites; alias-covered; can migrate incrementally.
> 2. **VALUE producers** — emit-sites + local union type definitions; must be flipped or the alias silently hides them (this was the 4d gap).
> 3. **Exported SYMBOLS / types / fields** — no alias possible; must be atomically renamed; enumerate by `grep -rn "export.*Old"` — NOT by a hand-curated list, which is exactly what dropped `renderPrd` / `findPrdPath` / `promoteFromPrePrd` / `buildIntakeDecisionPrd` / `PrdsLandIn` in the prd→spec cutover (this was the 4e gap).

The framing lesson (why it matters): the original C-audit (`prd-to-spec-remaining-chain-audit-alias-makes-batches-independently-green.md`) mapped the migrate surface through ONE lens — the `namespace === 'spec'` CONSUMER sites — and that single-lens framing was blind to producers (→ 4d insertion) and to exported symbols (→ 4e insertion). The contract-phase drift-check (a real `grep "export.*Spec"` leak scan) was the honest tripwire twice. Siblings 4f and 4g are further manifestations of the same single-lens C-audit pattern and should be cross-referenced.

The human's instruction (see the answer harvested into the observation): fold this into the SAME shared cutover-lessons note under `work/notes/findings/` as the sibling 4d lesson. Do NOT mint a separate ADR. After the lesson is folded in, DELETE the 4e observation file — history is the archive.

Concrete steps:

1. Look for an existing shared cutover-lessons note under `work/notes/findings/` (likely slug something like `rename-cutover-coverage-audit-lessons.md` or whatever the sibling 4d distillation task chose). If it exists, APPEND the 4e-specific enumeration-3 material as a new subsection and cross-link 4d/4f/4g siblings.
2. If it does NOT yet exist (4d's distillation task may not have landed yet), CREATE it at `work/notes/findings/rename-cutover-coverage-audit-lessons.md` with a stable structure that both 4d and 4e (and eventually 4f, 4g) can slot into: an intro naming the C-audit single-lens root cause, then one subsection per enumeration lens (§1 VALUE consumers, §2 VALUE producers [4d], §3 exported SYMBOLS/types/fields [4e]), then a short 'sibling observations' cross-reference block listing the prd-to-spec-4d/4e/4f/4g observation slugs (whichever still exist at the time — 4e will be deleted by this same task).
3. Include, in the §3 (exported symbols) subsection, the concrete symbol list that leaked past the curated audit: `renderPrd`, `buildIntakeDecisionPrd`, `findPrdPath`, `promoteFromPrePrd` / `PromoteFromPrePrdOptions` / `PromoteFromPrePrdResult`, `PrdsLandIn` + its internal plumbing (`config.prdsLandIn`, `prdLandingToSide`, `explicitPrdsLandIn`, `PerformIntakeOptions.prdsLandIn`, env-config schema). Note the mechanical rule: use `grep -rn "export .*<OldPrefix>"` — never a hand-curated symbol list.
4. Delete `work/notes/observations/prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10.md`.
5. Verify (`pnpm -r build && pnpm -r test && pnpm format:check` — no code changed, but format:check will cover the new/edited markdown after `pnpm format`).

Out of scope: any code change, any ADR, touching sibling observations 4d/4f/4g (they have or will have their own distillation tasks), touching the already-landed 4e migrate task in `work/tasks/done/`.

## Prompt

> Batch 4e of the prd→spec rename cutover (`rename-spec-residual-exported-symbols-and-prdslandIn-plumbing`) has already landed in `work/tasks/done/`. What remains is to preserve its DURABLE lesson before dropping the transient re-scope observation that spawned it.
>
> Read `work/notes/observations/prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10.md` in full (body + harvested answer). The human's disposition: distill the lesson into the shared cutover-lessons note under `work/notes/findings/` alongside the sibling 4d lesson, then delete the 4e observation. Do NOT mint an ADR.
>
> The lesson to capture: a rename cutover's coverage audit needs THREE separate enumerations, not one — (1) VALUE consumers (`=== 'old'`, alias-covered, incremental), (2) VALUE producers (emit-sites + local union definitions, must be flipped or the alias hides them — this was the 4d gap), (3) exported SYMBOLS / types / fields (no alias possible, atomic rename, enumerate via `grep -rn "export.*Old"`, NEVER via a hand-curated list — the hand-curated list is exactly what dropped `renderPrd`, `buildIntakeDecisionPrd`, `findPrdPath`, `promoteFromPrePrd` (+ `PromoteFromPrePrdOptions` / `PromoteFromPrePrdResult`), and the `PrdsLandIn` plumbing in prd→spec). Framing lesson: the original C-audit (`prd-to-spec-remaining-chain-audit-alias-makes-batches-independently-green.md`) used a single lens — `namespace === 'spec'` consumer sites — and was blind to lenses (2) and (3); the contract-phase leak scan was the honest tripwire twice. Sibling observations 4d/4f/4g share this single-lens root cause; cross-reference them.
>
> Steps: (1) look under `work/notes/findings/` for an existing shared cutover-lessons note (the 4d distillation may have created one); if present, APPEND a §3 for exported SYMBOLS/types/fields with the concrete leaked-symbol list and the `grep -rn "export.*Old"` mechanical rule, and add 4e to the sibling cross-reference block. (2) If it does NOT exist, CREATE `work/notes/findings/rename-cutover-coverage-audit-lessons.md` with the three-lens structure (intro naming the C-audit single-lens root cause, §1 VALUE consumers, §2 VALUE producers [4d], §3 exported symbols [4e], sibling cross-references to 4d/4f/4g). (3) DELETE `work/notes/observations/prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10.md`. (4) Run `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> No code changes. No ADR. Do not touch the already-landed migrate task in `work/tasks/done/` or the sibling observation notes 4d/4f/4g.
