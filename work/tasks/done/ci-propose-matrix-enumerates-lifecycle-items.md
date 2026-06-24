---
title: CI propose matrix enumerates lifecycle items (surface / triage / apply), not only build/slice
slug: ci-propose-matrix-enumerates-lifecycle-items
prd: ci-advance-surfaces-questions-not-only-builds
humanOnly: true
blockedBy: [advance-in-place-publishes-treeless-results]
covers: [1, 2, 3, 4, 6, 7, 8, 11]
---

## What to build

Make the PROPOSE-mode CI advance matrix enumerate ALL lifecycle items as their own
legs, so the WHOLE answer-loop runs in the conservative default integration mode,
NOT only in merge mode:

- **triage** — untriaged observations (`obs:<slug>` legs);
- **surface** — `needsAnswers` slices/PRDs with NO all-answered sidecar
  (`slice:`/`prd:<slug>` legs);
- **apply** — `needsAnswers` slices/PRDs WITH an all-answered sidecar
  (`slice:`/`prd:<slug>` legs). DECIDED (the A2 fork): the propose matrix DOES
  enumerate apply items, so a committed answer is applied on the propose path
  identically to merge. Without this, the on-answer-committed trigger (`push:
  work/questions/**`) would re-run the matrix but find no leg for the answered item,
  and PRD story 4 (apply the answer) would silently be merge-only. Apply behaves
  like merge: the leg runs `advance <id> --propose`, the apply rung consumes the
  answer and commits, and the foundation slice's in-place tree-less publish pushes
  it to `main`.

Today the `enumerate` step builds the matrix from `dorfl scan --json`
filtered on `eligibility.eligible == true`, which is build/slice-only: a
`needsAnswers:true` item is `eligible:false` by construction (whether its sidecar
is answered or not), and untriaged observations are not in the scan's slice/PRD
pools at all. So NO lifecycle rung (triage / surface / apply) ever gets a matrix
leg. This is the SAME class of bug the merged
`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` work fixed for
PRDs — mirror that fix exactly, one layer further.

End-to-end path: expose a lifecycle pool on `scan --json`, extend the `enumerate`
`jq` to emit `obs:`/`slice:`/`prd:` lifecycle legs, and extend the workflow's
structural validator to assert they are emitted. Each lifecycle item becomes its
own propose leg → its own `advance <id> --propose` → a tree-less ff-push of the
sidecar/marker to the arbiter's `main` (the publish wired by the foundation slice).

Scope:

- Add a lifecycle pool to the per-repo `scan --json` report. Do NOT re-derive the
  enumeration: REUSE the existing `lifecycle-gather.ts` seam, which already resolves
  observations + `needsAnswers` items + each item's sidecar and hands them to the
  SHARED `buildLifecyclePools` (so the result AGREES with the `advance -n` / `run`
  paths). Two ready functions exist for the two scan substrates:
  `gatherLifecycleInPlace` (sync, the working checkout → `cwd.repo`) and
  `gatherLifecycleMirror` (async, a bare hub mirror → `repos[]`). Gate via the
  per-repo `surfaceBlockers` / `observationTriage` config (the SAME
  `LifecyclePoolGates` the drivers pass). Surface the pool on BOTH the registry
  (`repos[]`) and in-place (`cwd.repo`) sections, the same dual-surface the
  slice/PRD pools use. The pool must distinguish (or let the consumer derive)
  triage / surface / apply so the `jq` can emit the right namespace prefix.
- Extend the `enumerate` step's `jq` to union the lifecycle legs into the matrix:
  `obs:<slug>` (triage), and `slice:`/`prd:<slug>` (surface AND apply), keeping
  `unique`. Keep the pools DISJOINT by construction (a `needsAnswers` item — whether
  surface or apply — is `eligible:false` so it is never also a build leg; an
  observation is a separate `obs:` namespace) so no item gets two legs.
- Extend `validateAdvanceLifecycleWorkflow` with a presence assertion for the new
  lifecycle legs, mirroring the existing `propose-enumerates-sliceable-prds`
  assertion.
- The advance-lifecycle workflow is EMITTED by a TypeScript generator
  (`generateAdvanceLifecycleWorkflow`), which interpolates parameters (e.g.
  `${setupWith}` provider secrets) into the YAML. So edit the GENERATOR's `jq`
  string + its validator, then REGENERATE this repo's emitted
  `.github/workflows/advance-lifecycle.yml` from the updated generator (the emitted
  copy is the generator's OUTPUT, NOT a byte-copy of the .ts source). Confirm the
  regenerated workflow carries the new `jq`.
- INERT when gates are off: with `surfaceBlockers:false` + `observationTriage:off`
  (the calm defaults) the lifecycle pool is empty and the `jq` adds no legs — the
  matrix is unchanged for a calm-default repo.

## Acceptance criteria

- [ ] `scan --json` reports a lifecycle pool (triage / surface / apply candidates),
      gated by the per-repo `surfaceBlockers` / `observationTriage` config, computed
      by REUSING `lifecycle-gather.ts` (`gatherLifecycleInPlace` for `cwd.repo`,
      `gatherLifecycleMirror` for `repos[]`) — NO forked sidecar resolution / no
      re-derived predicate — on both the `repos[]` and `cwd.repo` sections.
- [ ] The emitted `enumerate` `jq` unions `obs:<slug>` legs (untriaged
      observations), `slice:`/`prd:<slug>` legs for SURFACE items (`needsAnswers`,
      no all-answered sidecar) AND `slice:`/`prd:<slug>` legs for APPLY items
      (`needsAnswers`, all-answered sidecar), alongside the existing eligible-slice
      / sliceable-PRD legs, kept `unique`.
- [ ] An apply leg closes the on-answer loop in propose mode: a `needsAnswers` item
      with an all-answered sidecar becomes a propose leg, the apply rung consumes
      the answer, and the result reaches the arbiter (via the foundation slice's
      publish) — the SAME outcome as the merge path. Asserted.
- [ ] No item produces TWO legs (a `needsAnswers` item is not also a build leg; an
      observation is a separate `obs:` namespace) — asserted on a fixture with both.
- [ ] `validateAdvanceLifecycleWorkflow` asserts the lifecycle legs are emitted
      (new assertion mirroring `propose-enumerates-sliceable-prds`).
- [ ] With gates off (calm defaults), the lifecycle pool is empty and the `jq`
      emits NO added legs (the matrix is unchanged) — asserted.
- [ ] The change is in the GENERATOR (`generateAdvanceLifecycleWorkflow`) — its `jq`
      string + `validateAdvanceLifecycleWorkflow` — and this repo's emitted
      `.github/workflows/advance-lifecycle.yml` is REGENERATED from the updated
      generator (the emitted YAML is the generator's OUTPUT, not a byte-copy of the
      .ts); the regenerated workflow carries the new `jq`.
- [ ] A propose leg for a surfaceable item produces a question sidecar that reaches
      the arbiter's `main` (relies on the foundation slice's in-place tree-less
      publish) — asserted end-to-end or via the existing generate-under-`--fake`
      workflow test plus the foundation slice's publish test.
- [ ] Tests mirror the `advance-ci-template` / `advance-lifecycle-template` test
      style and assert OBSERVABLE results (the matrix leg list; the scan pool),
      not call wiring.
- [ ] Tests ISOLATE all git/scan state in temp/scratch repos; no real
      home/config/global location is touched.

## Blocked by

- `advance-in-place-publishes-treeless-results` — a propose leg surfaces a sidecar
  that must reach the arbiter, which requires the foundation slice's in-place
  tree-less publish. This also serialises the two (both touch the advance/CI area),
  avoiding a conflict.

## Prompt

> Bring the PROPOSE-mode CI advance matrix to parity: enumerate ALL the lifecycle
> items — triage (untriaged observations), surface (`needsAnswers`, no all-answered
> sidecar) AND apply (`needsAnswers`, all-answered sidecar) — as their own legs, so
> the WHOLE answer-loop (ask + apply) runs in the default integration mode, not only
> in merge mode. DECIDED: the propose matrix enumerates APPLY items too, so a
> committed answer is applied on the propose path exactly as in merge (otherwise the
> on-answer `push: work/questions/**` trigger re-runs the matrix but finds no leg for
> the answered item, and PRD story 4 is silently merge-only). MIRROR the
> already-merged `ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`
> fix (it extended the `jq` from slice-only to also enumerate sliceable PRDs; you
> extend it again for the lifecycle pool).
>
> FIRST, check this slice against current reality (launch snapshot — may have
> drifted): confirm the foundation slice
> (`advance-in-place-publishes-treeless-results`) has LANDED (in-place advance now
> publishes tree-less results) — this slice depends on it. Confirm `scan --json`
> still exposes the slice/PRD pools with `eligibility.eligible`, the `enumerate`
> `jq` still filters on `select(.eligibility.eligible == true)`,
> `buildLifecyclePools` still exists, and `validateAdvanceLifecycleWorkflow` still
> carries the `propose-enumerates-sliceable-prds` assertion to mirror. If a
> dependency landed differently, route to `needs-attention/` rather than build on a
> stale premise.
>
> Domain vocabulary: the LIFECYCLE pools (`buildLifecyclePools`) = triage (untriaged
> observations), surface (`needsAnswers` items, no all-answered sidecar), apply
> (`needsAnswers` items WITH an all-answered sidecar). The propose matrix is
> PARALLEL (one PR/leg per item); `selectionOrder` is a sequential-driver concern
> that does NOT apply to it. Lifecycle progression is CROSS-TICK (surface → human
> answers → build; slice-prd → slice-build), so there is no intra-tick ordering to
> model — the cron cadence + the `push: work/questions/**` trigger are the ordering.
>
> Where to look: the scan module (the slice pool `scoreItems` + the PRD pool
> `scorePrds` — add a SIBLING lifecycle pool). CRITICAL: do NOT re-derive the
> lifecycle enumeration — REUSE `lifecycle-gather.ts`, which already resolves
> observations + `needsAnswers` items + each sidecar and feeds `buildLifecyclePools`:
> `gatherLifecycleInPlace` (sync) for the `cwd.repo` section, `gatherLifecycleMirror`
> (async) for the `repos[]` section. Gate via the per-repo `surfaceBlockers` /
> `observationTriage` (the SAME `LifecyclePoolGates` the drivers pass). The
> advance-lifecycle workflow is EMITTED by the generator
> `generateAdvanceLifecycleWorkflow` (it interpolates `${setupWith}` etc.) — edit the
> GENERATOR's `jq` string + `validateAdvanceLifecycleWorkflow`, then REGENERATE the
> emitted `.github/workflows/advance-lifecycle.yml` (it is the generator's OUTPUT,
> NOT a byte-copy of the .ts). The
> `ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` done record + its
> test are the exact pattern to follow.
>
> Keep pools DISJOINT (no double-leg) and `unique` (a `needsAnswers` item — surface
> or apply — is `eligible:false`, never also a build leg; observations are a separate
> `obs:` namespace). Keep it INERT when gates are off (empty pool → no added legs).
> Reuse `gatherLifecycle*` + `buildLifecyclePools` (do not fork the predicate).
>
> "Done" = the acceptance criteria pass: `scan --json` carries the gated lifecycle
> pool (via `gatherLifecycle*`); the `jq` emits `obs:`/`slice:`/`prd:` lifecycle legs
> for triage + surface + apply; the validator asserts them; no double-legs; inert
> when gates off; a surfaceable propose leg's sidecar AND an apply leg's answer-
> application both reach the arbiter (with the foundation slice). Tests mirror the
> existing template-test style and assert observable results.
>
> Constraints: see `work/findings/ci-advance-surfacing-gap-analysis.md` (driver
> coverage + ordering analysis) and the PRD
> `ci-advance-surfaces-questions-not-only-builds`. RECORD any non-obvious in-scope
> decision (e.g. the exact `jq` shape, or how the lifecycle pool is keyed in the
> scan JSON) per the slice template's decision-recording rule.

---

### Claiming this slice

```sh
dorfl claim ci-propose-matrix-enumerates-lifecycle-items --arbiter origin
git fetch origin && git switch -c work/ci-propose-matrix-enumerates-lifecycle-items origin/main
git mv work/in-progress/ci-propose-matrix-enumerates-lifecycle-items.md work/done/ci-propose-matrix-enumerates-lifecycle-items.md
```

## Needs attention

**Marked `humanOnly: true` (2026-06-17) — NOT a code defect; a structural autonomy boundary.** An autonomous CI `advance` run built this slice and Gate-2 review APPROVED it (full destination check passed; 3 non-blocking nits recorded in `work/observations/review-nits-ci-propose-matrix-enumerates-lifecycle-items-2026-06-17.md`). The work is correct. But the final branch push was REJECTED by GitHub:

```
! [remote rejected] work/slice-ci-propose-matrix-enumerates-lifecycle-items
  refusing to allow a GitHub App to create or update workflow
  `.github/workflows/advance-lifecycle.yml` without `workflows` permission
```

This slice's deliverable is to REGENERATE `.github/workflows/advance-lifecycle.yml` (it edits the generator and re-emits the workflow YAML). The CI runner's GitHub App token deliberately LACKS the `workflows` permission — an autonomous run must never be able to rewrite its own triggers (the `runner-in-ci` PRD states this as a hard safety line: "the running CI job is forbidden from touching `.github/workflows/**`"). So GitHub rejects the WHOLE branch push because it carries a `.github/workflows/` change, and the runner releases the advancing borrow but cannot land the branch — the slug strands in `in-progress/`, and every re-claim re-hits the identical wall (an infinite re-fail loop).

**Therefore this slice can ONLY be completed by a human** (or a non-App credential WITH `workflows` permission): a human checks out a branch off `main`, builds the change (the approved review text is a near-complete spec), and pushes/merges it with their own credentials. `humanOnly: true` stops CI from re-claiming it into the dead end.

NOTE: the approved branch was NEVER pushed (the rejection blocked the whole push), so the CI runner's build is LOST — a human must rebuild from the slice + the approved review.

> POLICY GAP worth capturing separately: ANY slice whose deliverable regenerates a file under `.github/workflows/**` is inherently `humanOnly`, because the autonomous runner is forbidden to push such changes. Future workflow-touching slices should be marked `humanOnly` at SLICING time so they never get auto-claimed into this rejection.

**RESOLVED (2026-06-17) — REBUILT locally by a human, as MODEL B (see below).** All acceptance criteria are met and `pnpm -r build && pnpm -r test && pnpm format:check` is green. The slice's committed deliverable is SOURCE + GENERATOR + TESTS only — NOT the emitted workflow:

- `src/scan.ts` — the per-repo `lifecycle` field + `lifecycleGatesFrom` + `toScannedLifecycle`, on both `repos[]` and `cwd.repo`, reusing `gatherLifecycle*` → `buildLifecyclePools`.
- `src/mirror-pool-scan.ts` — attaches the gathered lifecycle to its `RepoReport`.
- `src/advance-lifecycle-template.ts` — the generator's `jq` lifecycle union + the `propose-enumerates-lifecycle-items` validator assertion.
- `test/scan.test.ts` — lifecycle-pool behaviour on both substrates (inertness, apply-always-on, surface gating, disjointness, pending-not-enumerated, per-repo gate overrides).
- `test/advance-lifecycle-template.test.ts` — the validator regression (the in-memory-generated workflow asserts the new `jq`, so the tests do NOT depend on the committed `.yml`).

**MODEL B (the corrected model): the emitted `.github/workflows/advance-lifecycle.yml` is `install-ci`'s OUTPUT, refreshed by the human running `dorfl install-ci` — it is NOT committed BY this slice.** The CI rejection ("refusing to allow a GitHub App to create or update workflow ... without `workflows` permission") was the system saying exactly this: the workflow is generated artifact a human installs, not slice-committed source. VERIFIED 2026-06-17 that `install-ci --fake` (from this repo's real exported config: models-json + anthropic) emits the workflow BYTE-IDENTICAL to the generator change — so after this slice's generator change lands, the human runs `dorfl install-ci` to refresh the in-repo workflow as a SEPARATE, human-owned step (the same way any downstream repo upgrades). The human owns the commit + push of the source change AND the separate `install-ci` workflow refresh.

## Decisions

- **`scan --json` lifecycle JSON shape (ratifies review nit 1).** Triage items carry only `{slug}` — the `obs:` prefix is FIXED in the matrix `jq` (an observation has no slice/prd namespace) — while surface/apply items carry `{namespace: 'slice'|'prd', slug}` so the `jq` projects the right `slice:`/`prd:` prefix via `.namespace + ":" + .slug`. This asymmetry STANDS: a `namespace: 'observation'` on triage would be dead shape (the prefix is never read from it). Future consumers must not add one and fork the shape. The `ScannedBlockedItem.namespace` is typed `'slice' | 'prd'` (a strict subset of the upstream `SelectedNamespace`); `toScannedLifecycle` narrows + drops any non-slice/prd defensively, since surface/apply pools never carry observations by construction.
- **`lifecycleGatesFrom(config)` mapping (ratifies review nit 2).** `observationTriage !== 'off'` → `triage` ON (BOTH `ask` and `auto` enumerate a triage leg identically — the matrix only decides "is there a leg at all?"; the ask/auto disposition distinction is enforced LATER by the triage rung, not by leg existence), and `surfaceBlockers` → `surface` ON. The ask/auto tri-state is intentionally collapsed to a boolean AT THE SCAN LAYER because that is exactly what the underlying `buildLifecyclePools` gate API takes; `apply` is never gated (consume is always-on, the create-vs-consume invariant, ADR `ci-config-policy-and-gate-family` §4).
- **APPLY enumerated on the propose matrix (the A2 fork, as the slice specified).** The propose matrix DOES enumerate apply legs, so a committed answer is applied on the propose path identically to merge — closing the on-answer `push: work/questions/**` loop. Without it PRD story 4 would be silently merge-only.
- **Policy (DECIDED — the corrected model): a slice that changes a CI WORKFLOW must change the GENERATOR + the validator (autonomously buildable/pushable SOURCE), and must NOT commit the emitted `.github/workflows/**` file.** The emitted workflow is `install-ci`'s OUTPUT; refreshing the in-repo copy is a separate, human-owned `dorfl install-ci` step (the App token cannot push under `.github/workflows/**`, and shouldn't — the `runner-in-ci` safety line). The original slice conflated the two by instructing the builder to regenerate + commit the `.yml`, which is what stranded it. Future workflow-touching slices: edit the generator + validator only; leave the emitted file to `install-ci`. (`humanOnly` is then NOT required for the slice's source change — only the `install-ci` refresh is human-run.)
