---
title: F2 — `surfaceStaging` (default true): surface questions on STAGING too, for tasks and briefs (build/claim unchanged)
slug: f2-surface-staging-config-and-pool-extension
brief: staging-surface-and-apply-promote-safety
blockedBy:
  - f3a-apply-resolves-item-by-identity-at-write-time
  - f3b-promote-takes-per-item-advancing-lock
covers: [2, 3, 4, 7]
---

## What to build

Separate the SURFACE polarity from the BUILD polarity in the lifecycle pool: surfacing is read-only-ish (it mints a question sidecar, writes nothing to `main`, touches only the item's per-item lock), so it is safe to inspect STAGING for `needsAnswers` items even though staging is untrusted for BUILDING. With this slice, questions are minted BEFORE promotion, so a human promotes an already-clarified item rather than promoting blind and getting asked after.

- New config key `surfaceStaging: boolean`, camelCase, default **true**. Resolution precedence matches the gate family: `flag > env > per-repo > global > default`. Add it to `env-config.ts` with the same schema/precedence pattern as the existing gate-family keys.
- In `lifecycle-gather.ts` / `buildLifecyclePools`, the SURFACE candidate set draws from STAGING + POOL when `surfaceStaging:true`, and from POOL only when `surfaceStaging:false`. APPLY stays always-on (unchanged). BUILD/claim eligibility is UNCHANGED — still pool-only, still trust-gated — even with `surfaceStaging:true`.
- Briefs symmetrically (PRD q4 answer): the brief surface pool draws from `briefs/proposed/` (staging) when `surfaceStaging:true`, not only `briefs/ready/`. A `needsAnswers` brief in staging surfaces its questions before promotion, exactly like a task.
- `scan --json`'s `lifecycle.surface[]` reflects the expanded pool so the CI matrix enumerates staging surface legs.

Why this lands AFTER F3 (PRD q3): F3's correctness fixes (folder-agnostic apply + promote-respects-lock) must be in place first, because once a staged `needsAnswers` item surfaces and gets answered, the subsequent apply runs alongside the human's promote — exactly the interleaving F3 closes. F2 tests assert the F3 invariants are green as a precondition (i.e. the e2e surface→answer→apply happy path runs without a manual promote AND without split-brain).

## Acceptance criteria

- [ ] `surfaceStaging` config key exists, camelCase, default `true`, resolved `flag > env > per-repo > global > default` (matches existing gate-family precedence pattern).
- [ ] With `surfaceStaging:true`: a `needsAnswers` task in `tasks/backlog/` appears in `scan`'s `lifecycle.surface[]`; a surface tick mints its sidecar.
- [ ] With `surfaceStaging:true`: a `needsAnswers` brief in `briefs/proposed/` appears in the brief surface pool; a surface tick mints its sidecar.
- [ ] With `surfaceStaging:false`: neither staged tasks nor staged briefs appear in the surface pool; existing pool-only behaviour is preserved.
- [ ] BUILD/claim eligibility is UNCHANGED in both modes: staged items remain non-claimable (the trust model is untouched).
- [ ] End-to-end test (throwaway repo): a freshly sliced `needsAnswers` task in `tasks/backlog/` surfaces → is answered → applies cleanly WITHOUT a manual promote first, and a concurrent promote during apply does NOT split-brain (F3 preconditions hold).
- [ ] Existing surface / advance-apply / claim-cas / slicing-lock tests do not regress.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `f3a-apply-resolves-item-by-identity-at-write-time`
- `f3b-promote-takes-per-item-advancing-lock`

Both must land first: F2's surface→answer→apply path on staging is only SAFE once apply×promote can no longer corrupt each other (PRD q3 answer: F3 strictly before F2, separate slices).

## Prompt

> Open SURFACING into staging without opening BUILDING into staging. Today, a sliced `needsAnswers` task born in `tasks/backlog/` never surfaces its questions because the surface pool is trust-gated identically to the build pool — so humans are forced to promote BLIND and get asked after. The surface polarity is different: it emits a question, writes nothing to `main`, and touches only the item's per-item lock — safe on staging.
>
> Add a `surfaceStaging: boolean` config key (camelCase) to `env-config.ts`, default **true**, resolved with the existing gate-family precedence chain (`flag > env > per-repo > global > default`). In `lifecycle-gather.ts` / `buildLifecyclePools`, change ONLY the SURFACE candidate set: when `surfaceStaging:true`, include STAGING + POOL; when `false`, POOL only. Do NOT touch the BUILD/claim candidate set — staged items stay non-claimable, the trust model is untouched.
>
> Briefs symmetrically (per the PRD q4 answer): the brief surface pool must include `briefs/proposed/` (staging) when `surfaceStaging:true`, not only `briefs/ready/`.
>
> `scan --json`'s `lifecycle.surface[]` must reflect the expanded pool so the CI matrix enumerates staging surface legs.
>
> Tests: throwaway git repos. Cover (a) staged task surfaces under default `true`, (b) staged brief surfaces under default `true`, (c) both disappear from the surface pool under `false`, (d) BUILD/claim never sees staged items in EITHER mode, (e) end-to-end happy path: a freshly sliced `needsAnswers` task in `tasks/backlog/` surfaces → answer → apply WITHOUT a manual promote, and (f) a concurrent promote during that apply does not split-brain (asserts the F3 preconditions are in place — if these tests fail, the blockers `f3a` / `f3b` did not actually land what F2 needs, and this slice should route to needs-attention rather than be patched around).
>
> Per the task template, FIRST check current reality — has the lifecycle-gather shape, the gate-family precedence, or the `scan` JSON contract changed? RECORD non-obvious in-scope decisions (e.g. the exact field name in `scan` output, how the brief surface pool key was extended). Verify with `pnpm format && pnpm -r build && pnpm -r test && pnpm format:check`.
