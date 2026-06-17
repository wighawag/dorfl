---
title: review-gate non-blocking nits for 'complete-builds-on-already-done-moved-continue' (Gate 2 approve)
date: 2026-06-17
status: open
reviewOf: complete-builds-on-already-done-moved-continue
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'complete-builds-on-already-done-moved-continue' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the originTrust EXEMPTION on `source: 'done'`: a continue-build on an untrusted slice with a `merge` config will NOT re-checkpoint to propose, on the rationale that the prior attempt already did. The ADR explicitly notes this trade-off cuts against the `untrusted-origin-build-checkpoint` ADR's "follow the build wherever it integrates from" principle and invites a flip. Confirm or flip.
  (`integration-core.ts` adds `source !== 'done'` to the untrusted-origin propose guard; ADR `continue-build-already-done-moved.md` § Consequences explicitly flags this. Reversible by removing one term in the guard, but worth a conscious sign-off because it crosses an existing ADR's principle.)
- Ratify the NAME `source: 'done'` (extending the existing folder-name `source` axis) and the user-visible state name "continue-build" used in the LOUD note and the ADR. CONTEXT.md vocabulary uses `committedRecovery` / `recovering`; "continue-build" is a new term — fine on the axis side but worth confirming the human-facing label.
  (`note('>> continue-build on '<slug>': …')` in `complete.ts`; `IntegrationCoreInput.source` doc in `integration-core.ts`; ADR title.)
- Ratify the sibling-ledger reconcile being KEPT active for `source: 'done'` while the divergent-done-move reconcile is EXEMPTED. The ADR articulates the split (sibling-ledger covers OTHER slugs and is independent of this slug's move); confirm this is the intended boundary.
  (`integration-core.ts` ~L924/L980: `if (!lifecycle && source !== 'done') readArbiterLedgerPlacement / divergent reconcile`, while the sibling-ledger auto-resolve branch (the `else if` immediately preceding the divergent-reconcile abort) is unconditional.)
- PR DESCRIPTION did not carry a `## Decisions` block — the commit body is just the slice title. The ADR records the same decisions in detail, but a reader landing on the PR will not see them inline. Consider amending PR description to mirror the ADR's three bullets so they surface in review history alongside the diff.
  (Commit `6fe5dbf` body is bare; `docs/adr/continue-build-already-done-moved.md` carries the decisions.)
