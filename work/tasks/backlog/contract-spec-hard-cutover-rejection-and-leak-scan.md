---
title: prd→spec CONTRACT phase — flip hard-cutover rejection + add forward/reverse leak scan
slug: contract-spec-hard-cutover-rejection-and-leak-scan
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-protocol-contract-and-to-spec-skill]
covers: [1, 8]
---

## What to build

The CONTRACT phase of the wide refactor (`TASKING-PROTOCOL.md` §3a): now that every caller has migrated onto `spec` (batches 2–4), REMOVE the `prd` alias surface the expand task added, make the dead token dead, and prove the sweep is complete. This is the acceptance GATE for the whole source-part cutover.

- **REMOVE the `prd` aliases (the contract of expand→migrate→contract).** Delete the deliberate dual-form acceptance the expand task (`expand-spec-frontmatter-and-namespace-aliases`) added: the `prd:` frontmatter-key read in `parseFrontmatter` (keep only `spec:`), the `'prd'` member + `prd:` prefix in `SlugNamespace`/`slug-namespace.ts` (keep only `spec`), the `prdsLandIn` config-key alias + `--prds-land-in` flag in `repo-config.ts` (keep only `specsLandIn`/`--specs-land-in`), and the `'prd'` `IntakeArtifactType`/`IntakeOutcome` member (keep only `'spec'`). After this, no caller can use the `prd` form because it no longer exists.
- **Hard-cutover rejection:** ensure every rejection test asserts the now-dead `prd:`/`prd-`/`work/prd-`/`do prd:` token is REJECTED and the `spec` spelling is live (mirroring how the `brief → prd` cutover flipped these). Consolidate them if scattered.
- **Forward+reverse leak scan (the exhaustive gate) — BI-WORD (`prd` AND `brief`).** Add (or extend the existing scan test) a check that (forward) NO live `prd`/`Prd`/`PRD` **OR `brief`/`Brief`/`BRIEF`** code/doc identifier survives outside an explicit allow-list of intentional provenance, and (reverse) the `spec` rename did not corrupt genuine English (`specify`, `specific`, etc. — the `preisolate` task should have cleared these, so any reverse hit is a real regression). Both retired words are scanned because this cutover folded `brief → spec` in (review routing (a)): `via: 'brief'` was a live tag, so a scan that only looked for `prd` would have passed it. The scan must be EXHAUSTIVE-BY-CONSTRUCTION (grep/glob over the trees, not a hand-listed file set) so a missed spelling fails the gate.
- **The allow-list is a small, concrete, each-entry-justified set** — name the intentional survivors, do not describe them abstractly. Expected entries: the provenance slugs that immutably contain the retired words (e.g. `code-identifier-slice-prd-to-task-brief-rename`, `brief-regime-rename-and-dropped-migration`, `close-job-via-prd-to-brief-rename-verify-and-flip-masked-test`), ADR references to the `403a5be9`-era history, genuine English (`debrief`, `briefly`, `briefing`), and landed `work/` history (which the migration command owns, not this scan). Any entry NOT on this justified list is a leak and fails the gate.
- Delete any dead `prd`-token compatibility reader if one remains.

## Acceptance criteria

- [ ] The expand task's `prd` aliases are REMOVED: `parseFrontmatter` reads only `spec:`; `SlugNamespace`/prefix only `spec`; `repo-config` only `specsLandIn`/`--specs-land-in`; intake only `'spec'`. The `prd` form no longer compiles.
- [ ] Rejection tests: `prd:`/`prd-`/`work/prd-`/`do prd:` rejected; `spec` tokens live.
- [ ] A forward BI-WORD leak scan fails on ANY unallow-listed live `prd`/`Prd`/`PRD` OR `brief`/`Brief`/`BRIEF` identifier in `packages/dorfl/{src}`, `skills/`, `docs/`, `CONTEXT.md`, `AGENTS.md`; the allow-list is a concrete enumerated set (the provenance slugs, `403a5be9`-era ADR refs, genuine English `debrief`/`briefly`), each entry justified.
- [ ] A reverse leak scan fails on corrupted genuine English introduced by the sweep.
- [ ] Both scans are grep/glob-based over the trees (exhaustive-by-construction), NOT a hand-maintained file list.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green, both scans clean.

## Blocked by

- rename-spec-protocol-contract-and-to-spec-skill (the whole source-part rename, code + contract, must be in before "the old form is dead" can be asserted).

## Prompt

> Goal: close the source-part wide refactor with its CONTRACT phase — flip the hard-cutover rejection tests so the dead `prd:`/`prd-`/`do prd:` token is rejected and `spec` is live, and add/extend an EXHAUSTIVE forward+reverse leak scan that gates the whole cutover green. Read the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command` (esp. "leak-scan-as-gate", user story 8) + `TASKING-PROTOCOL.md` §3a.
>
> Domain vocabulary: a "hard cutover" is a clean break with no back-compat alias — the retired token is REJECTED, proven by test (prior art: `frontmatter.test.ts` rejecting `brief:`). The leak scan is BI-WORD: it greps forward for BOTH retired words (`prd` AND `brief` — this cutover folded `brief → spec` in, so both are dead) and reverse for corrupted English. Exhaustive-by-construction = it scans the trees, so it cannot silently miss a file — the explicit fix for the `brief`-leftover class (`via: 'brief'` was a live tag until batch 4 renamed it; the bi-word scan is what keeps it from recurring).
>
> Where to look: existing hard-cutover tests (grep `HARD CUTOVER`, `reject`), any existing scan test to extend, and the `403a5be9` commit for how the prior scan + allow-list was shaped.
>
> Done means: dead token rejected, both scans exhaustive + green, no dead compat reader, full gate green. This task is the trust signal that the source-part cutover is complete.
>
> FIRST check drift: confirm batches 1–5 all landed (this asserts "no caller uses the old form" — if any batch is missing, the forward scan will rightly fail and you should route the missing batch, not weaken the scan).
