---
needsAnswers: true
---

# 2026-06-23: test comments/describe-names still cite the renamed `sliceablePrds` symbol (now `taskableBriefs`)

The live src helper was renamed `sliceablePrds` -> `taskableBriefs`
(`packages/dorfl/src/select-priority.ts:111`), but several TEST comments
and one describe-block NAME still cite the old symbol, so they reference a name
that no longer exists in src:
- `test/scan.test.ts:396` — comment "REUSES `sliceablePrds` (the SAME `autoslice-gate` predicate...)".
- `test/select-priority.test.ts:54` — `describe('sliceablePrds — consumes autoslice-gate predicate ...')`.
- `test/mirror-pool-scan.test.ts:21,26,184` — comments + a test name citing `sliceablePrds` / "sliceable PRDs".

A self-contained symbol-comment sweep (`sliceablePrds` -> `taskableBriefs`; "sliceable
PRDs" -> "taskable briefs"), distinct from the test-label-tidy / fixture-folder /
selection-pool tasks already landed. Keep the immutable slug `autoslice-gate` verbatim.
Surfaced by the Gate-2 review of `rename-residual-slice-test-labels-and-skill-provenance`.
Low-risk, comment/describe-name only (no behaviour). Promote to a task or fold into a
future test-prose sweep.
