---
title: Test — clean-rebase-but-semantically-broken merge is caught at the rebased tip
slug: test-clean-rebase-semantic-break
spec: land-time-reverify-and-parallel-merge-ceiling
blockedBy: []
covers: [12]
---

## What to build

The load-bearing test for the whole prd's thesis: two work branches,
disjoint files, NO textual conflict, where A renames a symbol and B adds
a caller of the OLD name. Both rebase clean onto each other. The test
asserts that the SECOND to land FAILS `verify` ON THE REBASED TIP and
routes to needs-attention (or, in a host-ceiling variant, is blocked
from merging) — i.e. the clean rebase is NOT trusted.

This test EXISTS already in spirit via the `freshWorktreeGate` tests in
`integration-core`; the gap is the SPECIFIC clean-rebase-but-semantic-
break scenario that proves the headline. Prior art: existing
`integration-core` fresh-worktree-gate tests + `advance-ci-template.test.ts`.

Assertions are external-behaviour:

- `main` does NOT contain a tree that would fail `verify` after the
  second land.
- The second item's lock ends in `state: stuck` with a reason that names
  the failure as a re-verify failure on the rebased tip, NOT a rebase
  conflict.
- `verify` actually ran on the rebased tree (some observable byproduct
  proves this — e.g. a marker the fake `verify` writes).

Do NOT assert on which private function was called.

## Acceptance criteria

- [ ] New test in the integration test suite that constructs the
      rename-vs-add-caller scenario with disjoint files and asserts the
      three external behaviours above.
- [ ] Test passes against the current engine (it should — the engine
      already implements `freshWorktreeGate`).
- [ ] If the test FAILS unexpectedly against current engine code, route
      this task to needs-attention per WORK-CONTRACT "Drift is a needs-
      attention signal" rather than weakening the test.
- [ ] Acceptance gate green.

## Blocked by

- None — the engine surfaces this test exercises (`performIntegration`,
  `freshWorktreeGate`) are landed.

## Prompt

> Read Story 12 + the Testing Decisions section of the prd. Read the
> existing fresh-worktree-gate tests in `integration-core.test.ts` (or
> equivalent) to mirror their style and fixture pattern. Build the
> minimal rename-vs-caller scenario — a tiny TS or JS source where A
> renames an exported function and B adds an import/caller of the old
> name; the project's own `verify` (build+test) should fail on the
> merged tree. Tests must isolate any global location they touch per
> task-template's shared-location rule (use temp dirs / scratch repos).
> Verify with the AGENTS.md acceptance gate.
