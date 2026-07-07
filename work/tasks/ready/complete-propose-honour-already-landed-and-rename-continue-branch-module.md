## Context

Review of `propose-push-survives-stale-lease-on-reaped-work-ref` (Gate 2, approved 2026-06-26) raised two non-blocking nits worth folding into one small follow-up task. Nit #1 (missing `## Decisions` block) is a standing systemic pattern and is intentionally NOT addressed here — do not duplicate that meta-issue.

## In scope

### 1. `complete.ts` must honour `IntegrateResult.alreadyLanded`

Today `packages/dorfl/src/complete.ts` (around lines 1095–1110) unconditionally calls `formatProposeNextStep` with `requestOpened` from the integrate result and IGNORES the new `alreadyLanded` flag set by the integrator's already-landed branch (`packages/dorfl/src/integrator.ts` ~lines 425–435, which also sets a custom `instruction`).

Consequence: a user running `dorfl complete --propose` that hits the benign already-landed race tail is told

> Pushed work/<branch> to arbiter/work/<branch>. Open a PR/MR ...

even though nothing was pushed and there is no ref to PR against. The CI-dominant recovery path (through `performIntegration` / integration-core) is already correct — this is a residual UX misreport on the sibling `complete.ts` caller only.

Fix: when the integrate result has `alreadyLanded: true`, `complete.ts` should surface the integrator's custom `instruction` text instead of the generic push+PR next-step from `formatProposeNextStep`. Cover this with a test that exercises the `complete --propose` path against an already-landed integrate result and asserts the emitted next-step string.

### 2. Tidy `continue-branch.ts` scope

`packages/dorfl/src/continue-branch.ts` now hosts BOTH `pushContinuedBranchWithStaleLeaseRetry` (its original continue/onboard caller) AND the new `pushProposeBranchWithStaleLeaseRetry` (imported by the integrator). The file name no longer matches its contents — it has become a multi-caller "stale-lease work-branch push" module.

Pick ONE of:
- rename the file to something like `stale-lease-work-push.ts` (or split the two helpers into a shared module) and update all imports, OR
- keep the file name and add a top-of-file doc comment explicitly documenting the broadened scope (that it hosts stale-lease retry helpers for multiple callers, not just continue/onboard).

Preference: whichever is the smaller, less churny change that still leaves the file honest. A rename is fine if imports are tractable; otherwise the scope-note is acceptable.

## Out of scope

- Nit #1 from the review (missing `## Decisions` block on `bdbf71ec` / done body). This is the standing systemic pattern across the repo and is tracked separately; do NOT try to retroactively add a Decisions block to the already-integrated task here.
- Any change to the integrator's already-landed detection logic itself — that path is correct; only its consumer in `complete.ts` misreports.

## Acceptance

- `dorfl complete --propose` against an already-landed race tail emits the integrator's `instruction` text (no false "Pushed ... Open a PR/MR" line), covered by a test.
- `continue-branch.ts` either no longer misnames its contents (rename/split) or carries a top-of-file comment declaring the broadened scope.
- `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Pointers

- `packages/dorfl/src/complete.ts` ~lines 1095–1110 (call site of `formatProposeNextStep`).
- `packages/dorfl/src/integrator.ts` ~lines 425–435 (already-landed branch setting `alreadyLanded: true` + custom `instruction`).
- `packages/dorfl/src/continue-branch.ts` (both stale-lease push helpers).

## Decisions to record

Record a `## Decisions` block in the done body for any non-obvious in-scope choice, e.g. rename-vs-scope-note for `continue-branch.ts`, and the exact shape of the `complete.ts` branch (does it call the integrator's `instruction` verbatim, or wrap it?).
