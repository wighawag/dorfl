---
title: prd→spec remaining-chain audit — the expand alias makes every migrate batch independently green; the only real trap was batch 4's catch-all wording
date: 2026-07-09
---

## Why this audit ran

Batch 2 stopped THREE times on scope/coupling errors (expand-first needed; lock/sidecar surface missed; verb-dispatch in wrong batch). Before driving any further batch, audited the whole remaining chain (batches 2, 3, 4, protocol, contract, build) for the same class of trap: "can each batch satisfy its acceptance clauses editing only files it owns, and stay green in isolation?"

## Key structural finding (the reassuring one)

**Every remaining migrate batch CAN stay green in isolation, because of the expand tasks.** The two expand tasks made the whole identity surface dual-form: `parseFrontmatter` populates BOTH `fm.spec` and `fm.prd`; `SlugNamespace`/sidecar/lock accept BOTH `spec:` and `prd:`; config reads BOTH `specsLandIn`/`prdsLandIn`; intake accepts BOTH `'spec'`/`'prd'`. So a migrate batch flips ONLY its own occurrences onto `spec`, and the still-present `prd` alias covers every occurrence any OTHER batch has not migrated yet. That is exactly the expand→migrate→contract guarantee (§3a): green is preserved batch-to-batch because the old form still exists until the contract task removes it. This is the property the original hard-swap chain LACKED (batch 2 failed precisely because there was no alias yet).

## File-ownership map (so batches don't double-own or orphan)

- Batch 2 (`rename-spec-frontmatter-field-and-slug-namespace`): the `fm.prd→fm.spec` reads + the tasking work-branch/lock EMIT, in `frontmatter.ts` / `prompt.ts` / `tasking.ts` / `tasking-lock.ts`. NOT the do/advance verb.
- Batch 3 (`rename-spec-config-and-intake`): `repo-config.ts` / `intake.ts` / `intake-trigger-template.ts`. The 5 other files reading `prdsLandIn` (cli, config, env-config, placement, work-layout) compile untouched on the alias.
- Batch 4 (`rename-spec-remaining-src-modules`): the `namespace === 'prd'` CONSUMER sites (advance*, do*, scan, select-priority, lifecycle-gather, needs-attention, triage-persist, integration-core, ledger-read, cli) + the `do spec:`/`advance spec:` verb dispatch + the `brief` remnants + the `prd-complete.ts → spec-complete.ts` file rename. Where it shares a file with batch 2/3 (`tasking.ts`, `intake.ts`), it touches ONLY the occurrences the earlier batch left.
- Protocol task: `skills/setup/protocol/*` + `to-prd → to-spec` skill + vendor/mirror. No code files.
- Contract task: REMOVES the aliases (slug-namespace/sidecar/item-lock/repo-config/frontmatter/intake) + rejection + bi-word leak scan. Correctly last.
- Build task: the new `prd-to-spec` command, own files.

## The one fix applied

Batch 4's "every remaining `Prd*`" catch-all wording is what let the verb-dispatch clause fall into ambiguity. Tightened its SCOPE paragraph to enumerate exactly what it owns (consumer sites + verb-dispatch + brief remnants + file rename) and to state explicitly it does NOT re-touch the occurrences batches 2/3 already migrated in shared files. No other task needed changes.

## Lesson

For a wide-refactor chain, the review lens that catches this class is: FOR EACH acceptance clause → which file must change → does THIS batch own it, AND can the batch stay green given the alias? The expand→migrate→contract shape makes "green in isolation" automatic for the migrate batches; the residual risk is purely SCOPE WORDING (catch-all phrasing that lets a clause target a file another batch owns). Enumerate ownership; never say "everything remaining".

## Provenance

Audit of the live tree @ d01b7794: grep of the `namespace === 'prd'` consumer surface (16 files) + the `prdsLandIn` readers (5 files) cross-referenced against each remaining task body's claimed files.
