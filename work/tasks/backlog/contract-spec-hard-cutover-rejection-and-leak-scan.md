---
title: prd→spec CONTRACT phase — flip hard-cutover rejection + add forward/reverse leak scan
slug: contract-spec-hard-cutover-rejection-and-leak-scan
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-protocol-contract-and-to-spec-skill]
covers: [1, 8]
---

## What to build

The CONTRACT phase of the wide refactor (`TASKING-PROTOCOL.md` §3a): now that no caller uses the old `prd` form, make the dead token dead and prove the sweep is complete. This is the acceptance GATE for the whole source-part cutover.

- **Hard-cutover rejection:** ensure every rejection test asserts the now-dead `prd:`/`prd-`/`work/prd-`/`do prd:` token is REJECTED and the `spec` spelling is live (mirroring how the `brief → prd` cutover flipped these). Consolidate them if scattered.
- **Forward+reverse leak scan (the exhaustive gate):** add (or extend the existing scan test) a check that (forward) NO live `prd`/`Prd`/`PRD` code/doc identifier survives outside an explicit allow-list of intentional provenance (historical slugs, ADR references to the `403a5be9` era, landed `work/` history which the command owns), and (reverse) the `spec` rename did not corrupt genuine English (`specify`, `specific`, etc. — the `preisolate` task should have cleared these, so any reverse hit is a real regression). The scan must be EXHAUSTIVE-BY-CONSTRUCTION (grep-based over the trees, not a hand-listed file set) so a missed spelling fails the gate — the explicit defense against the `brief`-leftover failure.
- Delete any dead `prd`-token compatibility reader if one remains.

## Acceptance criteria

- [ ] Rejection tests: `prd:`/`prd-`/`work/prd-`/`do prd:` rejected; `spec` tokens live.
- [ ] A forward leak scan fails on ANY unallow-listed live `prd`/`Prd`/`PRD` identifier in `packages/dorfl/{src}`, `skills/`, `docs/`, `CONTEXT.md`, `AGENTS.md`; the allow-list is small and each entry justified (provenance/history).
- [ ] A reverse leak scan fails on corrupted genuine English introduced by the sweep.
- [ ] Both scans are grep/glob-based over the trees (exhaustive-by-construction), NOT a hand-maintained file list.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green, both scans clean.

## Blocked by

- rename-spec-protocol-contract-and-to-spec-skill (the whole source-part rename, code + contract, must be in before "the old form is dead" can be asserted).

## Prompt

> Goal: close the source-part wide refactor with its CONTRACT phase — flip the hard-cutover rejection tests so the dead `prd:`/`prd-`/`do prd:` token is rejected and `spec` is live, and add/extend an EXHAUSTIVE forward+reverse leak scan that gates the whole cutover green. Read the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command` (esp. "leak-scan-as-gate", user story 8) + `TASKING-PROTOCOL.md` §3a.
>
> Domain vocabulary: a "hard cutover" is a clean break with no back-compat alias — the retired token is REJECTED, proven by test (prior art: `frontmatter.test.ts` rejecting `brief:`). A leak scan greps the trees for the dead word forward (did any survive?) and the reverse mangling (did the sweep corrupt English?). Exhaustive-by-construction = it scans the trees, so it cannot silently miss a file — the explicit fix for the `brief`-leftover class (`via: 'brief'` still lives in the code today).
>
> Where to look: existing hard-cutover tests (grep `HARD CUTOVER`, `reject`), any existing scan test to extend, and the `403a5be9` commit for how the prior scan + allow-list was shaped.
>
> Done means: dead token rejected, both scans exhaustive + green, no dead compat reader, full gate green. This task is the trust signal that the source-part cutover is complete.
>
> FIRST check drift: confirm batches 1–5 all landed (this asserts "no caller uses the old form" — if any batch is missing, the forward scan will rightly fail and you should route the missing batch, not weaken the scan).
