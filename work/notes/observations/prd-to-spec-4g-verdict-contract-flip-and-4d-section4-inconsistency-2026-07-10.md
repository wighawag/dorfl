---
title: spec→spec re-scope #4 — inserted batch 4g (flip the intake/decision VERDICT contract); resolves batch 4d §4's inconsistent "keep the spec* content keys" carve-out (option A, ratified 2026-07-10)
date: 2026-07-10
---

## Trigger

The CONTRACT task STOPPED a 5th time. Unlike stops #1-3 (dropped migrate scope) and #4 (a task-authoring contradiction I introduced), THIS one surfaced an INCONSISTENCY in a prior batch's own decision, plus a genuinely un-owned half-migration.

## What was found (verified)

1. **The `spec` OUTCOME token is half-migrated:** `buildIntakeDecisionSpec` still teaches the LLM `{"outcome":"spec"}` + `outcome MUST be one of ask|task|spec|bounce`, and `parseIntakeVerdict` still accepts `'spec'`. Batch 3 deferred this prompt flip to "the migrate batch that flips the prompt" \u2014 never created.
2. **The `spec*` verdict CONTENT keys** (`prdSlug`/`prdTitle`/`prdBody`/`prdHumanOnly`/`prdNeedsAnswers`) are live INTERNAL identifiers on BOTH `IntakeVerdict` (intake.ts) and `DecisionVerdict` (decision-engine.ts), read by `parseIntakeVerdict`/`parseDecisionVerdict`, the `case 'spec'` dispatch (`verdict.prdBody` etc.), advance.ts:1219/1221, apply-decide.ts:176 \u2014 ~31 src + ~58 test occurrences.
3. **They are NEVER written to `work/` disk** (grep-confirmed: only appear in observation/task-body prose, never as live ledger data). So they are TRANSIENT LLM-verdict JSON keys + TS field names \u2014 NOT the migration command's data territory, and NOT the on-disk `prd:` frontmatter field.

## The inconsistency this exposes (batch 4d §4)

4d §4 flipped the `DecisionOutcome` VALUE `'spec' \u2192 'spec'` with the reasoning: "the verdict is a FRESH per-call LLM emission \u2014 nothing `'spec'`-valued is persisted on disk \u2014 so no on-disk alias is needed, and a lingering `'spec'` union member would be a leak the contract task flags." In the SAME note it KEPT the content keys `prdSlug`/`prdTitle`/`prdBody` "analogous to the out-of-scope `prd:` frontmatter FIELD." Those two rationales CONTRADICT: the content keys are ALSO transient/not-persisted, so the "analogous to the on-disk field" justification does not hold \u2014 they are exactly the "would-be-a-leak transient identifier" class 4d flipped the outcome value for. Batch 4f then cited "4d §4" to exclude them, inheriting the shaky premise.

## Decision (option A, with the human)

FLIP the whole verdict contract (batch 4g `rename-spec-intake-verdict-outcome-and-content-keys`, blockedBy 4f, before contract): the `spec` outcome token in the prompt + `parseIntakeVerdict` acceptance onto `spec`, and `spec* \u2192 spec*` content keys across both verdict shapes + all readers + prompt JSON keys + ~58 tests. This is the consistent application of 4f's "FULLY PURGE internal `spec` identifiers": they ARE internal code identifiers, and being transient they are SAFE to flip (no data coupling), so there is no reason to island them. Additive-green in isolation: the `case 'spec':` dispatch + the `'spec'` TYPE MEMBER stay (contract removes them), so routing survives on the still-present `case 'spec':`. Alternative (ratify them as allow-listed survivors) was declined \u2014 it would leave a permanent 5-key `spec*` island purely for naming inertia and reverse the fully-purge intent.

## Lesson (the source/data line for a VERDICT contract)

A model-verdict contract has THREE `spec`-token layers, each on a different side of the source/data line: (a) the OUTCOME token in the prompt + parser (SOURCE \u2014 flip it; the LLM emits fresh each call), (b) the CONTENT keys `spec*` (SOURCE \u2014 transient TS/JSON identifiers, NOT persisted, so flip them; do NOT confuse with the on-disk `prd:` FIELD), (c) any value the verdict WRITES to `work/` disk (DATA \u2014 the command converts). 4d §4 mis-classified (b) as if it were the on-disk field (c-adjacent). The tell: does the identifier ever appear as literal text in a committed `work/` file? If no, it is transient SOURCE, and the fully-purge + strict-scan applies. This is the FOURTH inserted migrate batch (4d producers, 4e symbols, 4f cli-flags+internal, 4g verdict) \u2014 all four are classes the single-consumer-lens C-audit missed, and all four were caught only by the contract-phase leak-scan tripwire forcing a real grep. The durable fix for the NEXT cutover is the identifier-class MATRIX in the 4f note, now extended: add "model-verdict outcome token" and "model-verdict content keys" as their own enumerated classes, distinct from the on-disk field.

## Provenance

Contract-task agent STOP diagnosis #5, verified @ a02e1194 (grep of the spec* verdict keys across 4 src modules + the `buildIntakeDecisionSpec` prompt outcome token + `parseIntakeVerdict` accept-list; confirmed 0 occurrences of the keys as literal text in committed `work/` ledger files). Re-scope ratified with the human (option A: flip, do not ratify).
