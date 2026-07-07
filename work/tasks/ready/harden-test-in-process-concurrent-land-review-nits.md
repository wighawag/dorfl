## Context

Gate 2 (code review) APPROVED the landed task `test-in-process-concurrent-land` with three non-blocking nits recorded in observation `review-nits-test-in-process-concurrent-land-2026-06-26`. The human triage decision: promote nits #1 and #2 into this single follow-up task, and carry nit #3 as an optional hardening line. The originating observation is being deleted after this task is minted — this task is its durable home and must stand on its own.

The target test file is the one added by `test-in-process-concurrent-land` that exercises the in-process concurrent-land engine path (two workers racing on disjoint items with a green verify). Locate it via `rg -l 'claimedAndDone' test/ src/` (it is the test asserting `result.claimedAndDone === 2`).

## Scope (must do)

### 1. Record the disjoint+green tightening as an explicit design choice

The original task spec allows the loser of a concurrent land to EITHER land cleanly OR end `stuck` with a real cause. The current test, however, pins the stricter assertion `result.claimedAndDone === 2` and `every item.status === 'claimed-done'` for the disjoint-items + green-verify scenario. That is intentional (regression-sensitive: in this scenario there is no legitimate reason for the loser to be bounced) but it is currently an unrecorded design choice.

Record it durably. Preferred: add a short `## Decisions` block to the landed `test-in-process-concurrent-land` task body (in `work/done/`… follow repo convention for amending a landed task's docs, or add a sibling ADR under `docs/adr/` if amending done-tasks is disallowed) that states:

> For the disjoint-items + green-verify scenario specifically, both workers MUST land `claimed-done` (`result.claimedAndDone === 2`). The broader allowed outcome set (`needs-attention` / `tests-failed` / `stuck`) applies only when there is a real cause (verify failure, genuine contention). Bouncing the loser for lock contention alone in the disjoint+green case is a regression.

Also add a short in-test comment above the strict assertion pointing at this Decisions block / ADR so a future reader understands why the narrower assertion is used after the broader allowed-set check.

### 2. Replace the trivial `sh -c 'exit 0'` post-land re-verify with a real signal (or drop it)

Near the end of the test there is a re-run: `const verifyRun = spawnSync('sh', ['-c', PASS], …)` against the post-land tip. It is trivially green by construction and adds ~nothing over what the green-engine path already asserts (the existing comment even acknowledges the circularity).

Pick ONE:

- **Preferred**: replace with a non-trivial assertion — e.g. check that a content marker each worker's item was supposed to write is actually present at the post-land tip (a file, a line in a file, or a committed marker unique per item). This turns the re-verify into a real "the tree on main is not broken and contains both landed changes" check.
- **Acceptable fallback**: delete the re-verify block entirely and expand the comment to say why (the green-engine path already covers it).

Do NOT keep the current `sh -c 'exit 0'` shape.

### 3. (Optional hardening — nit #3) Strengthen the per-item post-land lock check

Currently: `if (lock !== undefined) expect(lock.state).not.toBe('stuck');` after `readItemLock`. The spec says the loser must not be bounced for lock contention alone, so if the lock carries a `reason` field, also assert that `reason` (when present) does not match `/lock|contention/i`. Skip if `readItemLock`'s returned shape has no `reason` field — do not invent one.

## Acceptance

- Design choice from nit #1 is recorded in a durable, discoverable place (Decisions block on the landed task OR a new ADR under `docs/adr/`), and the strict assertion in the test has an inline comment pointing at it.
- The `sh -c 'exit 0'` re-verify is either replaced with a content/marker assertion or removed (with an explanatory comment), per the choice above.
- If `readItemLock`'s return type carries a `reason`, the post-land loop also asserts `reason` does not indicate lock contention. Otherwise this bullet is explicitly noted as N/A in the PR description.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green (repo `verify` gate per AGENTS.md).
- No behavior change to the engine itself — this is a test-hardening + docs task.

## Non-goals

- Do NOT re-open the concurrent-land engine semantics; this task only tightens the test and records the existing intent.
- Do NOT introduce cross-file refactors of the concurrency harness.

## Prompt

> Build the task 'harden-test-in-process-concurrent-land-review-nits', described above.
