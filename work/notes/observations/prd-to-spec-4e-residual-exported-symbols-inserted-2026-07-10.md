---
title: spec→spec re-scope #2 — inserted atomic-migrate batch 4e (residual exported Spec* symbols + PrdsLandIn plumbing) before the contract task; the C-audit's symbol coverage was incomplete TWICE (option A, ratified 2026-07-10)
date: 2026-07-10
needsAnswers: true
---

## Trigger

The CONTRACT task STOPPED a SECOND time (first was the emit-sites/local-unions gap → batch 4d). Its mandated drift-check found ~7 live EXPORTED `Spec*` code symbols that NO migrate batch ever owned, verified against the tree @ 55b874da:

- `renderPrd` (`intake.ts:1659`) — 4a curated an explicit symbol list, 4c owned `renderPrdBody`; bare `renderPrd` was on neither.
- `buildIntakeDecisionPrd` (`intake.ts:2319`, re-exported from `index.ts:408` — public API).
- `findPrdPath` (`prompt.ts:695`).
- `promoteFromPrePrd` / `PromoteFromPrePrdOptions` / `PromoteFromPrePrdResult` (`needs-attention.ts:877/890/899`).
- `PrdsLandIn` (`config.ts:60`) + its internal plumbing (`config.prdsLandIn` field, `prdLandingToSide`, `explicitPrdsLandIn`, `PerformIntakeOptions.prdsLandIn`, `env-config` schema). Batch 3 only added the `specsLandIn` config KEY + `SpecsLandIn = PrdsLandIn` alias beside the still-primary `spec*` internals (its own decision note said so: "the internal field ... NOT renamed ... a migrate-batch concern").

These are exported CODE IDENTIFIERS (not folder-literals / `prd:` field / prose), so the identifier leak scan MUST flag them and they are not allow-listable. Verified each exists + is live (`grep -rn "export .*renderPrd\b|buildIntakeDecisionPrd|findPrdPath|promoteFromPrePrd|type PrdsLandIn"`).

## Decision (option A, with the human — same shape as 4d)

Inserted atomic-migrate batch `rename-spec-residual-exported-symbols-and-prdslandIn-plumbing` (4e), blockedBy 4d, ordered BEFORE the contract task (contract's `blockedBy` now names it). Two pieces: (1) atomic exported-symbol rename (definition + importers + `index.ts` re-export + coupled tests, one green commit, no alias — the batch-4a shape); (2) complete the `PrdsLandIn` INTERNAL plumbing migration onto `spec` (invert the `SpecsLandIn`/`config.specsLandIn` primary/alias so `spec` is primary; keep the `prdsLandIn` field-alias + `--specs-land-in` INPUT flag readable for green-in-isolation — the contract task removes those INPUT aliases). User-facing flags + type-member + field + folder-literals + sidecar fallback stay out of scope.

## Lesson (the C-audit's SECOND blind spot, now twice-confirmed)

The C-audit (`prd-to-spec-remaining-chain-audit-alias-makes-batches-independently-green.md`) mapped the migrate surface by ONE lens: the `namespace === 'spec'` CONSUMER sites. That lens is blind to (a) PRODUCER emit-sites + local unions (→ 4d), and (b) exported `Spec*` SYMBOLS that are neither a namespace consumer nor on 4a's hand-curated list (→ 4e). A rename cutover's coverage audit needs THREE separate enumerations, not one: (1) VALUE consumers (`=== 'old'`, alias-covered, incremental), (2) VALUE producers (emit-sites + local union definitions, must be flipped or the alias hides them), and (3) exported SYMBOLS/types/fields (no alias, atomic rename, enumerate by `grep "export.*Old"` — NOT a hand-curated list, which is exactly what dropped `renderPrd`/`findPrdPath`/`promoteFromPrePrd`/`buildIntakeDecisionPrd`). The contract-phase drift-check is the backstop that caught both, precisely because the leak scan forces a real `grep "export.*Spec"` instead of trusting the audit's curated list. Twice now the "contract task can't close" signal was the honest tripwire the curated audit lacked.

## Provenance

Contract-task agent STOP diagnosis (2nd), independently verified @ 55b874da (grep of each exported symbol + its importer count; `PrdsLandIn` plumbing surface via `grep -rn "PrdsLandIn|prdsLandIn|prdLandingToSide|explicitPrdsLandIn|PerformIntakeOptions"`). Re-scope ratified with the human (option A).
