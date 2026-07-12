---
title: spec→spec re-scope — inserted migrate batch 4d (emit sites + local unions) before the contract task; the sidecar FILE-path prd-<slug>.md reader is DATA-territory the command removes (option A, ratified with the human 2026-07-10)
date: 2026-07-10
needsAnswers: true
---

## Trigger

The CONTRACT task (`contract-spec-hard-cutover-rejection-and-leak-scan`) STOPPED with a verified-correct diagnosis (its own note: `prd-to-spec-migrate-left-namespace-emit-sites-and-local-unions-on-prd-contract-cannot-close.md`): the migrate step was INCOMPLETE. Batches 4a/4b/4c widened the `namespace === 'spec'` CONSUMER `===` checks to `|| === 'spec'` but left ~50 live `'spec'` PRODUCER identifiers across ~14 modules — local union DEFINITIONS (`SelectedNamespace`, `DecisionOutcome`, `ScannedBlockedItem`, `BlockedItem`, `lifecycle-pools`, `needs-attention`, `triage-persist artifact`), `{namespace:'spec'}` emit-site values, and `spec:${slug}` CLI-token emits. The C-audit conflated "widen the `===` check" with "flip the emitted value" — only the former was required for green-in-isolation, so the producer flip fell through the whole chain.

## Verified (not taken on faith)

1. **The identifiers are real source union-values**, not folder-literals/field/prose — so option A's identifier-scoped forward leak scan CORRECTLY flags them; the option-A exemption does not cover them. (`grep -nE "namespace: 'spec'|'task' \| 'spec'|spec:\$\{" packages/dorfl/src` @ 7e9f73fb.)
2. **The latent runtime regression is real.** `lifecycle-gather` emits `{namespace:'spec'}` → `readSidecarInPlace` → `sidecarPathFor('prd:<slug>')` → `typeForNamespace`. Removing the `'spec'` case from `typeForNamespace`/`parseSlugArg` makes `prd:<slug>` fail to parse → falls through to the `task` default (`sidecar.ts:198-219`) → a `prd:` item silently gets a `task-<slug>` sidecar/lock entry. Compiles clean (the ~14 modules keep their own `'task' | 'spec'` unions), so TS does not catch it. The contract task, meant to be the trust signal, would have shipped a silent misroute.
3. **The extra wrinkle:** flipping the emit `'spec' → 'spec'` is NOT naively green-in-isolation, because `sidecarPathFor('spec:<slug>')` reads a DIFFERENT on-disk file (`work/questions/spec-<slug>.md`) than `prd-<slug>.md`, and the on-disk data is still `prd-<slug>.md` until the migration command converts it. This is the SAME data-coupling the 4b agent flagged when it deliberately refused to flip lifecycle-gather's emitters.

## Decision (option A, with the human)

Two moves, both recorded in the task files:

1. **Insert migrate batch 4d** `rename-spec-namespace-emit-sites-and-local-unions` (blockedBy 4c, ordered BEFORE the contract task; contract's `blockedBy` now also names it). It flips the three producer classes onto `spec`. To stay green-in-isolation despite the sidecar-path coupling, it KEEPS the sidecar/lock FILE-path reader resolving BOTH `spec-<slug>.md` and the legacy `prd-<slug>.md` (fallback), proven by test.

2. **The sidecar FILE-path `prd-<slug>.md` reader is DATA-territory, not the contract task's.** This is the crux of where the source/data line sits for the sidecar identity: the `SlugNamespace`/`SidecarType` `'spec'` TYPE MEMBER is SOURCE (the contract task removes it), but the on-disk sidecar FILENAME `prd-<slug>.md` is DATA (the migration command converts `prd-<slug>.md → spec-<slug>.md` and removes the fallback). Removing the type member does not require removing the file-path fallback (it probes a filename, not the union). The contract task's forward scan ALLOW-LISTS that one file-path fallback with this justification.

## Lesson (the reusable one)

For a namespace/enum-VALUE cutover, "migrate the consumers" is TWO jobs, not one: widen the CONSUMER `=== 'old'` checks (green on the alias), AND flip the PRODUCER emit-site values + local union DEFINITIONS. The alias makes the consumer-widen green in isolation, which HIDES the un-flipped producers — the build passes, so a coverage audit that only asks "does it stay green" (the C-audit) misses them. The producer flip is only forced at the CONTRACT step (when the alias is removed) or by an identifier leak scan. For a value that also keys an on-disk FILE (sidecar/lock), the producer flip is further DATA-coupled: flipping the emitted value changes which file is read, so the file-path alias must outlive the type-value cutover and belongs to the data-migration command. Enumerate PRODUCERS and CONSUMERS separately; and separate a value's TYPE identity (source) from its on-disk FILE identity (data).

## Provenance

Contract-task agent STOP diagnosis, independently verified against the live tree @ 7e9f73fb (grep of the producer surface + trace of `lifecycle-gather → sidecarPathFor → typeForNamespace`, `sidecar.ts:198-219`/`sidecarPathFor:265`). Re-scope ratified with the human (option A).
