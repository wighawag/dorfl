---
title: prd→spec batch 4b — close-job/lifecycle-gather consumers + the doubly-retired brief→spec sweep
slug: rename-spec-remaining-src-modules-b
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-remaining-src-modules-a]
covers: [1]
---

## What to build

Sub-batch (b) of the split bulk migrate (§3a): the `close-job`/`lifecycle-gather` consumers PLUS the whole `brief → spec` remnant sweep (the doubly-retired word, scope `{prd, brief} → spec`, ADR §7a). Additive-migrate; the `prd` alias covers un-touched occurrences elsewhere, so green in isolation.

Scope (this batch's files ONLY): `close-job.ts`, `lifecycle-gather.ts`, `frontmatter.ts`'s residual `via`/closure CONSUMER (the `resolveClosingIssue`-family), and their coupled tests.

- **`namespace === 'prd'` consumers** in these files → also match `'spec'` (add `|| === 'spec'`, keep `'prd'`).
- **The `brief → spec` sweep (the 22 remnants):**
  - Live code identifiers (8): `via: 'issue' | 'brief'` → `via: 'issue' | 'spec'` in `close-job.ts` (type decls, `prdCandidates → specCandidates`, the `closeComment` param + branch + the user-facing string `every task of brief \`${slug}\`` → `every task of spec \`${slug}\``) and `frontmatter.ts` (`{via: 'brief', spec}` — the field is `spec` post-batch-2). Rename `prdCandidates → specCandidates`.
  - Stale doc-comment prose (14): `config.ts` (“the brief-side”), `install-ci-branch-protection.ts` (×9 “the brief…”), `merge-question-surfacer.ts`, `verify-workflow-template.ts` — rewrite “the brief” → “the spec”. (These are comment-only files; touching only the comments does not conflict with sub-batch (a)/(c).)
- Update the coupled `close-job`/`frontmatter` tests for the `via` tag + `closeComment` string in this batch.

Do NOT touch the deliberate `prd` alias surface (contract task removes it) or sub-batch (a)/(c) code symbols.

## Acceptance criteria

- [ ] `close-job.ts`/`lifecycle-gather.ts` `namespace === 'prd'` consumers also match `'spec'`.
- [ ] The 22 `brief` remnants renamed to `spec`: `via: 'brief' → 'spec'` (+ `prdCandidates → specCandidates`, `closeComment` string) in close-job/frontmatter; the ~14 “the brief” doc-comments in config/install-ci-branch-protection/merge-question-surfacer/verify-workflow-template rewritten to “the spec”.
- [ ] Coupled close-job/frontmatter tests updated (the `via` tag + `closeComment`).
- [ ] The deliberate `prd` alias surface + sub-batch (a)/(c) symbols UNTOUCHED.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- rename-spec-config-and-intake (shared identity renamed; `prd` alias present so this stays green).

## Prompt

> Goal: sub-batch (b) of the split bulk migrate (read `work/protocol/TASKING-PROTOCOL.md` §3a + the parent spec). Migrate the `close-job.ts`/`lifecycle-gather.ts` `namespace === 'prd'` consumers onto `spec`, AND sweep the 22 doubly-retired `brief` remnants to `spec` (scope `{prd, brief} → spec`, ADR §7a): the LIVE `via: 'brief'` tag in close-job/frontmatter (+ `prdCandidates → specCandidates`, the `closeComment` user-facing string), and the ~14 “the brief” doc-comments in config.ts/install-ci-branch-protection.ts/merge-question-surfacer.ts/verify-workflow-template.ts. All become `spec`, NOT `prd`.
>
> Why the brief sweep is here: `via: 'brief'` is a LIVE union tag that means the artifact — the exact leftover-word failure the whole cutover exists to prevent. The contract task's bi-word leak scan (forward `prd`+`brief`) will fail if any stray `brief` survives.
>
> Scope boundary: touch only close-job/lifecycle-gather/frontmatter-consumer + the comment-only brief files. Do NOT touch the `prd` alias surface (contract task) or sub-batch (a)/(c) symbols (ledger/tasking/scan/do/advance/prompt/prd-complete).
>
> Done means: these consumers match `spec`, all 22 `brief` remnants are `spec`, coupled tests green, full gate green. FIRST check drift: confirm `rename-spec-config-and-intake` landed; confirm `via: 'brief'` still exists (if already gone, another batch took it — reconcile, don't double-migrate).
