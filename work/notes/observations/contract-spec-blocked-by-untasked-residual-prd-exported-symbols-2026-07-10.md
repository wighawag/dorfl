# Contract-spec leak scan blocked: ~7 live exported `prd` symbols were never assigned to a migrate batch (2026-07-10)

While building `contract-spec-hard-cutover-rejection-and-leak-scan`, the drift check found that the forward IDENTIFIER-SCOPED leak scan cannot go green: several live EXPORTED `Prd*` code symbols remain in `packages/dorfl/src` with no `Spec*` twin, and none of the landed migrate batches (2, 3, 4a/b/c/d, 5) owned them. Batch 4a curated an EXPLICIT symbol list (`LedgerPrdItem`, `LedgerPrdPool`, `resolvePrdPool`, `resolveMirrorPrdPool`, `PrdExistence`, `resolvePrdExistence`, `taskablePrds`, `TaskablePrdsInput`, `scorePrds`, `PrdCandidate`, `ScannedPrd`) and deferred `renderPrdBody`/`PrdTask` to 4c; the following were on NEITHER list and are still live:

- `renderPrd` (`intake.ts:1659`, exported; distinct from the 4c-renamed `renderPrdBody`)
- `buildIntakeDecisionPrd` (`intake.ts:2319`, exported AND re-exported from `index.ts:408` — the public package surface)
- `findPrdPath` (`prompt.ts:695`, exported)
- `promoteFromPrePrd` / `PromoteFromPrePrdOptions` / `PromoteFromPrePrdResult` (`needs-attention.ts:877/890/899`, exported)
- `PrdsLandIn` (`config.ts:60`, exported type). Batch 3 only ADDED `specsLandIn` as a config KEY beside `prdsLandIn`; it did NOT rename the internal plumbing type `PrdsLandIn`, the `config.prdsLandIn` field, `prdLandingToSide`, `explicitPrdsLandIn`, or `PerformIntakeOptions.prdsLandIn`. So `SpecsLandIn = PrdsLandIn` is an alias and `PrdsLandIn` is still primary internally.

Because these are genuine exported CODE SYMBOLS (not `work/specs/` path literals, not the `prd:` FIELD token, not stripped-comment domain-prose — the three categorical exemptions), the forward scan MUST flag them, and they are NOT the small allow-listable set the contract task anticipates (provenance slugs / English / the 2 intake `to-prd` prompt strings). Renaming them here would silently duplicate batch 4a's atomic-rename job for symbols it deliberately curated out, i.e. an untasked source change. Routing per the task's own instruction ("if any batch is missing, the forward scan will rightly fail; route the missing batch, not weaken the scan").
