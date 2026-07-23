---
title: 'spec→spec batch 4d — migrate the namespace EMIT sites + local union DEFINITIONS + spec:${slug} CLI-token emits onto spec'
slug: rename-spec-namespace-emit-sites-and-local-unions
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-remaining-src-modules-c]
covers: [1]
---

## What to build

The MISSING migrate sub-batch the C-audit dropped (see `work/notes/observations/prd-to-spec-migrate-left-namespace-emit-sites-and-local-unions-on-prd-contract-cannot-close.md`). Batches 4a/4b/4c widened the `namespace === 'spec'` CONSUMER `===` checks to `|| === 'spec'`, but did NOT flip the PRODUCER side: the ~50 live `'spec'` code identifiers that are (i) local union DEFINITIONS, (ii) `{namespace: 'spec'}` EMIT-site values, and (iii) `spec:${slug}` CLI-token EMIT sites. This batch flips all three onto `spec` so the CONTRACT task's forward identifier leak scan can be green and no `prd:<slug>` identity misroutes.

Additive-migrate per §3a: the `spec` alias still exists everywhere (SlugNamespace/SidecarType keep `'spec'` beside `'spec'`; the sidecar FILE-path reader still resolves both `prd-<slug>.md` and `spec-<slug>.md` — see the green-in-isolation note), so flipping only these producer identifiers stays green.

### The three identifier classes to flip (enumerate; do NOT "flip everything")

1. **Local union DEFINITIONS carrying `'spec'` → add/replace with `'spec'`** (these are each module's OWN `namespace`/`artifact` union, NOT `SlugNamespace`):
   - `decision-engine.ts` `DecisionOutcome = 'task' | 'spec' | 'adr' | 'delete' | 'ask'` → `'spec'` (the migrate: `'task' | 'spec' | ...`; the `spec` VALUE is produced by intake decisions already migrated to `'spec'` in batch 3 — confirm and align).
   - `select-priority.ts` `SelectedNamespace = 'task' | 'spec' | 'observation'` → `'spec'`.
   - `scan.ts` `ScannedBlockedItem.namespace: 'task' | 'spec' | 'observation'` (L91) + the `as` cast (L311) → `'spec'`.
   - `lifecycle-gather.ts` `BlockedItem`/params `namespace: 'task' | 'spec'[ | 'observation']` (L38/L49/L170) → `'spec'`.
   - `lifecycle-pools.ts` (L100) `namespace: 'task' | 'spec'` → `'spec'`.
   - `needs-attention.ts` (L1038) `namespace: 'task' | 'spec'` → `'spec'`.
   - `triage-persist.ts` `artifact?: 'task' | 'spec'` (L236/L440/L462) → `'spec'`.
2. **`{namespace: 'spec'}` EMIT-site VALUES → `'spec'`:** `lifecycle-gather.ts` (the ~6 `out.push({namespace: 'spec', …})` / `blocked.push(...)` at L82/97/115/221/231/248), `select-priority.ts:231` (`'spec' as const`), `needs-attention.ts:1097` (`'spec' as const`).
3. **`spec:${slug}` CLI-token EMIT sites → `spec:${slug}`:** `advance-drivers.ts:374`, `advance-loop-driver.ts:251`, `advance-isolated.ts:396`, `do-remote-auto.ts:149`, `do-autopick.ts:193` (`argForSelectedItem`/`argForSelected`/`remoteArgFor` returning `spec:${item.slug}`). Also the value branches the observation lists: `apply-decide.ts:55`, `cli.ts:3509-3525`, `advance.ts:444-445/1211` — flip the produced `'spec'`/`prd:` VALUE onto `spec` where it is an EMIT (leave any pure `=== 'spec'` consumer already `|| === 'spec'`).

Update the coupled tests for each flipped module.

### Green-in-isolation: the sidecar FILE-path alias STAYS (this batch does NOT touch data)

Flipping `lifecycle-gather` to emit `{namespace: 'spec'}` changes `sidecarPathFor('spec:<slug>')` to read `work/questions/spec-<slug>.md` instead of `prd-<slug>.md`. The on-disk sidecar data is still `prd-<slug>.md` until the migration command converts it. So `typeForNamespace`/`sidecarPathFor`/the sidecar reader MUST keep resolving BOTH forms through the cutover: an emitted `spec:<slug>` identity whose on-disk sidecar is still `prd-<slug>.md` must still be FOUND. Do NOT regress this. Concretely: the sidecar/lock reader either (a) reads `spec-<slug>.md` then falls back to `prd-<slug>.md`, or (b) the `typeForNamespace` `'spec'` case is aliased to also probe the `spec` file — pick the smaller change and record it. This FILE-path `prd-<slug>.md` reader alias is DATA-territory: the migration command removes it (it converts `prd-<slug>.md → spec-<slug>.md` on disk), NOT this batch and NOT the contract task. Add/keep a test proving a `spec:`-emitted item still finds its legacy `prd-<slug>.md` sidecar.

Do NOT touch: the `prd:` frontmatter FIELD, `work/specs/` folder literals, the `SlugNamespace`/`SidecarType` `'spec'` type MEMBER (the contract task removes the type member; this batch only stops PRODUCING the `'spec'` value), or the `prd:` CLI-INPUT prefix acceptance (contract task).

## Acceptance criteria

- [ ] All three identifier classes flipped to `spec`: the ~7 local union DEFINITIONS, the ~8 `{namespace:'spec'}` emit-site values, and the ~5 `spec:${slug}` CLI-token emits (+ the listed value branches). No module still PRODUCES a `'spec'` namespace value or a `spec:${slug}` arg.
- [ ] The sidecar/lock FILE-path reader still finds a legacy `prd-<slug>.md` sidecar for a `spec:`-emitted item (alias STAYS; proven by test). The migration command — NOT this batch — removes that file-path alias.
- [ ] `SlugNamespace`/`SidecarType` `'spec'` TYPE member + `prd:` frontmatter field + `work/specs/` folder literals UNTOUCHED (contract task / command own those).
- [ ] Coupled tests updated; `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] After this lands, `grep -nE "namespace: 'spec'|spec:\$\{|'task' \| 'spec'" packages/dorfl/src` returns only the deliberate alias/type-member survivors (contract task's remaining scope) — no producer identifier.

## Blocked by

- rename-spec-remaining-src-modules-c (the consumer `=== 'spec'` checks are already `|| === 'spec'`, so flipping the producers onto `spec` routes correctly through the still-present alias).

## Prompt

> Goal: complete the MIGRATE step the C-audit dropped — flip the PRODUCER side of the `spec` namespace onto `spec`. Read `work/notes/observations/prd-to-spec-migrate-left-namespace-emit-sites-and-local-unions-on-prd-contract-cannot-close.md` (the full diagnosis + file/line refs), the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command`, and `TASKING-PROTOCOL.md` §3a. Three classes: (1) the ~7 local `'task' | 'spec'` union DEFINITIONS → `'spec'`; (2) the ~8 `{namespace: 'spec'}` EMIT-site values → `'spec'`; (3) the ~5 `spec:${slug}` CLI-token emits → `spec:${slug}`. Additive-migrate: the `spec` alias (SlugNamespace/SidecarType `'spec'` member) STAYS, so this is green in isolation.
>
> CRITICAL green-in-isolation constraint: flipping `lifecycle-gather` to emit `spec:<slug>` makes `sidecarPathFor` read `work/questions/spec-<slug>.md`, but the on-disk sidecar is still `prd-<slug>.md` until the migration command converts the data. So you MUST keep the sidecar/lock FILE-path reader resolving BOTH `spec-<slug>.md` AND the legacy `prd-<slug>.md` (fallback), and prove it with a test. That FILE-path alias is DATA-territory the migration command removes — do NOT remove it here, and do NOT touch the `SlugNamespace`/`SidecarType` `'spec'` TYPE member, the `prd:` frontmatter field, or `work/specs/` folder literals.
>
> Done means: no module PRODUCES a `'spec'` namespace value or `spec:${slug}` arg; the legacy `prd-<slug>.md` sidecar is still found for a `spec:`-emitted item (tested); the type member + field + folder literals untouched; full gate green. FIRST check drift: confirm 4c landed and the `spec` alias (SlugNamespace `'spec'`, `typeForNamespace` `'spec'` case) is present.
