---
title: prd→spec batch 4g — flip the intake/decision VERDICT contract onto spec (the prd outcome token in the prompt + the prd* verdict CONTENT keys)
slug: rename-spec-intake-verdict-outcome-and-content-keys
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-intake-cli-flags-and-residual-prd-identifiers]
covers: [1]
---

## What to build

The FOURTH (and final) missing migrate sub-batch the C-audit dropped (see the contract agent STOP diagnosis #5 this session). The intake/decision VERDICT contract was left half-migrated and owned by no batch: the model prompt still teaches the LLM to emit `{"outcome":"prd",...}`, `parseIntakeVerdict` still accepts `'prd'`, and the `prd*` verdict CONTENT keys (`prdSlug`/`prdTitle`/`prdBody`/`prdHumanOnly`/`prdNeedsAnswers`) are live INTERNAL code identifiers.

Human decision (2026-07-10): **FLIP them (option A).** These are TRANSIENT LLM-verdict JSON keys + TS field names, NEVER written to `work/` disk (grep-confirmed) — so they are NOT the migration command's data territory, and NOT the frontmatter `prd:` field. Under the "fully purge internal `prd` identifiers" decision (batch 4f), they must migrate. Batch 4d §4 KEPT `prdSlug`/`prdTitle`/`prdBody` "analogous to the `prd:` field", but that rationale is inconsistent (4d §4 flipped the `DecisionOutcome` VALUE for exactly the "transient, not persisted, would be a leak" reason that ALSO applies to these keys); this batch corrects it.

Additive-green in isolation: the `'prd'` outcome ALIAS + the `case 'prd':` dispatch STAY (the contract task removes the `IntakeOutcome`/`IntakeArtifactType` `'prd'` member), so flipping the prompt to emit `spec` + accept `spec` keeps routing valid on the still-present `case 'prd':`.

### Piece 1 — the `prd` OUTCOME token (prompt + parser)

- **Prompt** `buildIntakeDecisionSpec` (`intake.ts:~2435/2443`): the `- **prd** → …` outcome row → `- **spec** → …`, and `outcome MUST be exactly one of ask | task | prd | bounce` → `ask | task | spec | bounce`. The `## Problem Statement`/`## Solution` prd example prose → spec.
- **`apply-decide.ts:176`** prompt line: already emits `{"outcome":"spec",...}` — flip its `prdSlug`/`prdTitle`/`prdBody` example keys to `spec*` (piece 2).
- **`parseIntakeVerdict`** (`intake.ts:~1872`): the validation error `ask|task|spec|prd|bounce` → `ask|task|spec|bounce` (drop `prd` from the ACCEPTED set — the LLM now emits `spec`). Leave the `case 'prd':` dispatch (intake.ts:863) + the `IntakeOutcome`/`IntakeArtifactType` `'prd'` MEMBER for the contract task to remove.
- **`parseDecisionVerdict`** (decision-engine.ts) analogously if it teaches/accepts a `prd` outcome.

### Piece 2 — the `prd*` verdict CONTENT keys → `spec*` (both verdict shapes + all readers + prompt JSON keys + ~58 tests)

Rename across BOTH verdict contracts and every reader:
- **`IntakeVerdict`** (intake.ts:143/145/152/160/161): `prdSlug`/`prdTitle`/`prdBody`/`prdHumanOnly`/`prdNeedsAnswers` → `specSlug`/`specTitle`/`specBody`/`specHumanOnly`/`specNeedsAnswers` (+ the `{@link prdTitle}` doc-comments).
- **`DecisionVerdict`** (decision-engine.ts:84/86/88 + the `parseDecisionVerdict` picks at :259-261) → `spec*`.
- **Readers/writers:** `intake.ts` (`:1274/1310/1311/1313/1314/1336/1581/1586-1588`, the `parseIntakeVerdict` picks `:1892-1899`), `advance.ts:1219/1221` (`verdict.prdBody`/`prdSlug`), `apply-decide.ts:176` prompt example keys.
- **Prompt JSON keys:** the `buildIntakeDecisionSpec` prd-row keys (`prdTitle`/`prdBody`/`prdSlug`/`prdHumanOnly`/`prdNeedsAnswers`) → `spec*` so the LLM emits `{"outcome":"spec","specTitle":…,"specBody":…}`.
- **~58 coupled test occurrences** across ~6 test files (intake / intake-verdict-parse / decision-engine / advance / apply-decide) — flip the emitted-verdict fixtures + assertions.

### Do NOT touch (contract task / command / other territory)

- The `IntakeOutcome`/`IntakeArtifactType` `'prd'` TYPE MEMBER + the `case 'prd':` dispatch (contract task removes).
- `intake.ts:1306` `switchToWorkBranch(..., 'prd', ...)` (contract task flips it when it removes the `SlugNamespace 'prd'` member — TS-forced).
- The `prd:` frontmatter FIELD + `parseFrontmatter` `prd:` key (CARVE-OUT #2, command), `work/prds/` folder literals, sidecar `prd-<slug>.md` fallback (CARVE-OUT #1, command), domain-prose.

## Acceptance criteria

- [ ] Prompt teaches `outcome:"spec"` + `spec*` content keys; `parseIntakeVerdict` accepts `ask|task|spec|bounce` (NOT `prd`); `parseDecisionVerdict` analogous.
- [ ] `prdSlug`/`prdTitle`/`prdBody`/`prdHumanOnly`/`prdNeedsAnswers` → `spec*` across `IntakeVerdict` + `DecisionVerdict` + every reader (intake/advance/apply-decide/decision-engine) + prompt JSON keys + all coupled tests. No `prd*` verdict key remains.
- [ ] Additive-green: the `case 'prd':` dispatch + the `'prd'` outcome/artifact TYPE MEMBER LEFT for the contract task; `switchToWorkBranch(...,'prd',...)` LEFT.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] After this, `grep -rnE "\bprd(Slug|Title|Body|HumanOnly|NeedsAnswers)\b" packages/dorfl/src` is empty (the verdict content channel is fully `spec`).

## Blocked by

- rename-spec-intake-cli-flags-and-residual-prd-identifiers (the prior internal purge; this is the last verdict-contract sweep before contract).

## Prompt

> Goal: the FINAL migrate before contract — flip the intake/decision VERDICT contract onto `spec`. Read the parent spec + `TASKING-PROTOCOL.md` §3a + the contract STOP-diagnosis observation (`intake-verdict-outcome-and-content-keys-half-migrated-...`) + batch 4d's decisions note §4 (which flipped the outcome VALUE but inconsistently kept these content keys). TWO pieces: (1) the `prd` OUTCOME token — the `buildIntakeDecisionSpec` prompt teaches `outcome:"spec"` (not `prd`) and `parseIntakeVerdict` accepts `ask|task|spec|bounce`; (2) the `prd*` verdict CONTENT keys `prdSlug`/`prdTitle`/`prdBody`/`prdHumanOnly`/`prdNeedsAnswers` → `spec*` across BOTH `IntakeVerdict` + `DecisionVerdict`, every reader (intake/advance/apply-decide/decision-engine), the prompt JSON keys, and ~58 coupled tests. These are TRANSIENT LLM-JSON keys (never on `work/` disk), so flipping them is safe value-migration, NOT data conversion.
>
> Scope boundary: LEAVE the `case 'prd':` dispatch + the `IntakeOutcome`/`IntakeArtifactType` `'prd'` TYPE MEMBER (contract task removes), `switchToWorkBranch(...,'prd',...)` (contract, TS-forced), the `prd:` frontmatter field + `work/prds/` literals + sidecar fallback (command). Additive-green: routing stays valid on the still-present `case 'prd':`.
>
> Done means: the verdict contract speaks `spec` (outcome + content keys), no `prd*` verdict key remains, full gate green. FIRST check drift: confirm 4f landed; grep `prdSlug|prdTitle|prdBody|prdHumanOnly|prdNeedsAnswers` + the prompt `outcome ... prd` to confirm they are still live.
