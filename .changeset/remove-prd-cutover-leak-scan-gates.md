---
'dorfl': patch
---

Remove the three `prd` → `spec` cutover leak-scan test gates. The vocabulary cutover and the stuck-lock migration are complete, so these transitional gates no longer guard a live invariant: the only remaining `prd` mentions are legitimate historical/provenance references to the retired `prd-` lock/branch namespace (which the `migrate-stuck-locks` feature, its docs, and its follow-up tasks must name), not fresh regressions. The tree-wide prose scan had flipped from a useful canary into pure friction, repeatedly failing builds on un-backticked-but-legitimate historical mentions in auto-generated task bodies (bouncing tasks with an opaque "acceptance gate failed on the rebased tip").

Deleted: `prd-word-cutover-leak-scan.test.ts` (tree-wide WORD/PROSE scan), `prd-src-prose-leak-scan.test.ts` (src-dir prose scan), and `prd-to-spec-leak-scan.test.ts` (the cutover trust-signal gate). The functional `prd → spec` conversion feature and its tests (`prd-to-spec.test.ts`, `convert-from-prd-to-spec-skill-doc.test.ts`) are UNCHANGED — only the enforcement scans are removed.
