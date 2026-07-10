---
title: prd→spec MIGRATE is incomplete — batch 4 widened CONSUMER switches but left ~50 live `'prd'` EMIT sites + local union DEFINITIONS un-migrated across ~14 modules, so the contract task cannot make the forward identifier leak scan green without an out-of-scope batch
date: 2026-07-10
---

## What I saw

Driving `contract-spec-hard-cutover-rejection-and-leak-scan` (the CONTRACT phase). The task's premise is "now that every caller has migrated onto `spec` (batches 2–4), REMOVE the `prd` alias ... and prove the sweep is complete" via a forward IDENTIFIER-SCOPED bi-word leak scan that must be GREEN and that (by its own acceptance) "fails on any unallow-listed live `prd` CODE IDENTIFIER (exported symbol / union-value / config key / CLI token / whole-literal dead-token path)".

That premise is FALSE against the live tree (@ 7e9f73fb). Batch 4 (per its own done record + the C-audit note) migrated only the `namespace === 'prd'` CONSUMER `===` checks (widening them to `|| === 'spec'`). It did NOT flip the EMIT sites or the LOCAL union DEFINITIONS onto `spec`. ~50 live `'prd'` CODE IDENTIFIERS remain across ~14 modules the contract task does NOT list for removal:

- Local union DEFINITIONS carrying `'prd'`: `decision-engine.ts` `DecisionOutcome`, `select-priority.ts` `SelectedNamespace`, `scan.ts` `ScannedBlockedItem`, `lifecycle-gather.ts` `BlockedItem`, `lifecycle-pools.ts`, `needs-attention.ts`, `triage-persist.ts` `artifact: 'task' | 'prd'`.
- `namespace: 'prd'` EMIT sites (feed sidecar-path / lock / branch identity): `lifecycle-gather.ts` (5×), `select-priority.ts:231` (`'prd' as const`), `needs-attention.ts:1097`.
- `prd:${slug}` CLI-token EMIT sites (the `do`/`advance` arg): `advance-drivers.ts:374`, `advance-loop-driver.ts:251`, `advance-isolated.ts:396`, `do-remote-auto.ts:149`.
- `'prd'` value branches: `apply-decide.ts:55`, `cli.ts:3509-3525`, `advance.ts:444-445/1211`, `do-autopick.ts:193`, `triage-persist.ts` (5×).

## Why it blocks the contract task (load-bearing, not a small factual gap)

1. **Forward-scan contradiction.** These are exactly the "union-value / CLI token" leak class the forward scan must flag. Making the scan GREEN would require EITHER migrating ~50 identifiers across ~14 out-of-scope modules (the task lists only frontmatter / slug-namespace / repo-config / intake / sidecar / item-lock), OR allow-listing ~50 live un-migrated `'prd'` identifiers — which the task explicitly forbids ("Any entry NOT on this justified list is a leak and fails the gate"; these are not intentional survivors). The task even instructs: "if any batch is missing, the forward scan will rightly fail and you should route the missing batch, not weaken the scan."
2. **Latent runtime regression the type system won't catch.** Because these modules use their OWN `'task' | 'prd'` unions (not `SlugNamespace`), removing `'prd'` from `SidecarType`/`SlugNamespace`/`typeForNamespace` compiles clean (measured: 18 errors, all in the 6 listed files) BUT leaves `lifecycle-gather` building `prd:<slug>` → `sidecarPathFor` → `parseSlugArg` → now-unknown prefix → silently falls through to the `task` sidecar/lock entry, and `advance-drivers` emitting a `prd:<slug>` CLI arg that misresolves to a bare task. Prd items lose their sidecar/lock identity silently.

## Suggested re-scope

Insert a MIGRATE batch (call it `rename-spec-namespace-emit-sites-and-local-unions`, blockedBy batch 4c, before this contract task) that flips the ~14 modules' EMIT sites + local union DEFINITIONS + `prd:${slug}` CLI-token emits from `'prd'` to `'spec'` (value-migration: safe in isolation on the `spec` alias, green per §3a). Then this contract task's premise ("every caller migrated onto `spec`") holds and the forward identifier scan can be green. Alternatively, widen THIS task's scope to own those ~14 modules' emit-site migration (but that is a large addition the task wording assigns to batch 4, and doing it silently would be exactly the wrong-but-compiling build the contract is meant to be the trust signal against).

Note the C-audit (`prd-to-spec-remaining-chain-audit-alias-makes-batches-independently-green.md`) listed these modules as batch 4's "consumer sites" but conflated "widen the `===` check" with "flip the emitted value" — only the former was actually required/done for green-in-isolation, so the emit-side flip fell through the chain.

## Provenance

Live tree @ 7e9f73fb: `grep -nE "'prd'|prd:\$\{" packages/dorfl/src` cross-referenced against the contract task's listed-scope files; blast-radius measured by removing `'prd'` from `SlugNamespace`/`SidecarType`/`IntakeArtifactType`/`IntakeOutcome` and running `tsc --noEmit` (18 errors, all in slug-namespace/sidecar/item-lock/intake/do/cli/advance/advance-classify/item-path — none in the ~14 local-union emit modules, which is exactly why the leak is silent). Reverted; tree left clean.
