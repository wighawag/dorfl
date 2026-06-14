---
title: review-gate non-blocking nits for 'reap-merged-remote-work-branches' (Gate 2 approve)
date: 2026-06-14
status: open
slug: reap-merged-remote-work-branches
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'reap-merged-remote-work-branches' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the slice instructed the builder to record its in-scope design choices in a `## Decisions` block in the PR description, but there is no PR description and no `## Decisions` block (the work is uncommitted on the branch). The following decisions were made on the builder's own initiative and should be ratified: (1) flag shape = a `--remote-branches` sub-mode on the existing `gc` command (vs a separate command); (2) addition of `--cwd` and `--dry-run` companion flags NOT named in the slice; (3) a `main-unresolved` retain reason (retain-everything when arbiter main can't be resolved); (4) treating an 'already gone' remote ref (concurrent reap) as a successful reap rather than a retain. Are these all acceptable as built?
  (The slice repeatedly says 'decide + document this in the `## Decisions` block'. Absent that block, a human should explicitly ratify these choices. None look wrong; `--dry-run` and the safe-direction `main-unresolved` retain are sensible additions, but they are user-visible surface the slice did not enumerate.)
- Ratify: the GitHub `delete_branch_on_merge` 'belt-and-suspenders' is only DOCUMENTED (as a CI-template comment) and is not actually enabled by install-ci or setup. Is documentation-only the intended depth?
  (The slice marked enabling the GitHub setting as OPTIONAL ('may ALSO enable ... as an additive convenience, NOT a replacement'), so documentation-only is within scope. Flagging for explicit confirmation since the acceptance criterion phrased it as 'optionally documents enabling', which this satisfies.)
- Two defensive branches in `sweepRemoteMergedBranches` are unexercised by tests: the `main-unresolved` retain path (when `<arbiter>/main` cannot be fetched) and the `alreadyGone` tolerance (a delete that fails because the ref was concurrently removed counts as reaped). Should at least the `main-unresolved` safe-direction path get a test, given it is a safety-bearing fallback?
  (The happy paths, the in-flight-retain invariant, dry-run, idempotency, bare arbiter, and non-namespaced filtering are all well covered. The two untested branches are both fail-safe directions, so this is a coverage gap rather than a correctness risk, hence non-blocking.)
- Ratify cross-surface interaction: `integration-core.ts` sets `deleteMergedHead: true` UNCONDITIONALLY on the complete transition for both propose and merge modes, relying on the integrator to ignore it outside `mode === 'merge'`. This is correct today, but it couples the propose path to an integrator implementation detail (that propose never reads the flag). Was passing it unconditionally (vs only on the merge path) a deliberate choice?
  (Verified the integrator only reads `deleteMergedHead` inside the `mode === 'merge'` branch, so propose is genuinely unaffected. The risk is purely future-proofing: a later integrator change that reads the flag in propose would silently start reaping the review-surface branch. Worth a human nod, not a block.)
