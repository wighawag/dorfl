---
type: observation
status: spotted
triaged: resolve
title: spec→spec re-scope #3 — inserted batch 4f (intake CLI flags clean-break + FULL internal-identifier purge); the C-audit's single-consumer-lens dropped THREE producer/symbol classes, caught only by the contract-phase leak-scan tripwire (option A, ratified 2026-07-10)
date: 2026-07-10
---

## Trigger

The CONTRACT task STOPPED a THIRD time (after 4d emit-sites and 4e exported-symbols). Its drift-check found a live in-scope CLI-token class with no `spec` twin, owned by no batch, plus a residual internal-identifier set. Verified against the tree @ 213fe777.

## What was found (both verified)

1. **The intake integration-mode CLI-flag family** \u2014 `--merge-spec`/`--propose-spec` (cli.ts:3688/3692), `mergePrd`/`proposePrd` fields (cli.ts:792/793, intake.ts:409/411), the emitted CI trigger-template `prd_flag="--*-spec"` (intake-trigger-template.ts:345/347 + output var + test). Single-form, NO `--merge-spec`/`mergeSpec` twin. This was a DOCUMENTED deferral: `intake.ts:425` ("keep their `spec` spelling until the cli-flag rename batch") + observation `intake-trigger-template-prd-flag-surface-stays-prd-in-batch-3.md` ("migrates ... a dedicated cli-flag batch") \u2014 but no batch was ever authored. Batch 4c renamed only the `do`/`advance` VERB dispatch, not these intake flags.
2. **A residual internal-identifier set** \u2014 the EXPORTED `STAGED_PRDS_DIR` (intake.ts:348; my 4e pre-flight grep MISSED it because the regex `[A-Za-z]*Spec[A-Za-z]` did not match all-caps `SPECS`), the `taskPrd` interface method, private consts (`POOL_PRDS_DIR`, `PRD_PLACEMENT_SLOTS`, `PRD_FOLDERS`), private fns (`prdExists`, `heldPrdIsStale`, `resolvePrdSlug`, `buildTaskingPrd`), and dozens of `spec*` local vars across ~15 files.

## Decisions (with the human)

- **CLI flags: CLEAN BREAK.** `--merge-spec`/`--propose-spec` \u2192 `--merge-spec`/`--propose-spec`, NO back-compat alias (matches the cutover's hard-cutover spirit). The compiled `.github/workflows/*` are NOT edited (a human regenerates via `install-ci`, exactly as `403a5be9` excluded compiled workflows); flagged as manual follow-up.
- **Internal identifiers: FULLY PURGE.** Rename every `spec`-spelled code identifier (exported + internal + local vars) to `spec`, so the contract task's forward scan targets INTERNAL names too and dorfl source is genuinely `spec`-free except the deliberate alias/type-member/field/folder-literal/prose. The contract task's leak-scan class was widened accordingly.
- Both folded into ONE inserted atomic-migrate batch `rename-spec-intake-cli-flags-and-residual-prd-identifiers` (4f), blockedBy 4e, before contract (contract's `blockedBy` now names it).

## The PATTERN (the durable lesson, now three-times-confirmed)

The original C-audit (`prd-to-spec-remaining-chain-audit-alias-makes-batches-independently-green.md`) mapped the migrate surface by ONE lens: `namespace === 'spec'` CONSUMER sites. That single lens was blind to, and the chain therefore dropped, THREE distinct identifier classes \u2014 each surfaced ONLY when the contract task's leak scan forced a real grep:

1. VALUE PRODUCERS (emit-sites + local union definitions) \u2192 batch 4d.
2. Exported SYMBOLS not on 4a/4c's hand-curated list \u2192 batch 4e.
3. CLI-token flags + a missed exported const + internal private names \u2192 batch 4f.

**A rename-cutover coverage audit must enumerate by a MATRIX, not a single lens:** {exported symbol, internal symbol, union-member VALUE (producer), union-member VALUE (consumer), config key, config field, CLI flag/verb/prefix token, path-construction literal, on-disk FILE identity, frontmatter field, prose} \u00d7 {is there a `spec` twin? who owns the flip? is it green-in-isolation on the alias, or atomic?}. The alias makes CONSUMER-widen green in isolation, which HIDES every un-flipped producer/symbol \u2014 so "does each batch stay green" (the C-audit's question) is the WRONG question for coverage; the RIGHT question is "enumerate every occurrence of the token by identifier-class and assign each an owner." The contract-phase leak scan is the honest backstop precisely because it greps instead of trusting a curated list \u2014 three STOPs, three real gaps, zero false alarms. When a curated symbol list appears in a rename task (4a did), treat it as a RISK, not a convenience: prefer `grep "export.*Old"` + an all-casing internal grep as the source of truth.

Corollary for MY own pre-flight: my 4e-era grep `[A-Za-z]*Spec[A-Za-z]` missed `STAGED_PRDS_DIR` (all-caps). A token pre-flight must be case-INSENSITIVE and cover all-caps CONSTANT_CASE, not just PascalCase/camelCase.

## Provenance

Contract-task agent STOP diagnosis (3rd), independently verified @ 213fe777 (grep of the flag family + `STAGED_PRDS_DIR` + the internal `spec*` surface across ~15 files; the two in-repo deferral artifacts confirmed at intake.ts:425 + the observation note). Re-scope ratified with the human (clean break + full purge, option A).
