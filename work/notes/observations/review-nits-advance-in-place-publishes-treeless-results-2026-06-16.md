---
title: review-gate non-blocking nits for 'advance-in-place-publishes-treeless-results' (Gate 2 approve)
date: 2026-06-16
status: open
reviewOf: advance-in-place-publishes-treeless-results
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-in-place-publishes-treeless-results' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the in-place tree-less publish hook is a new exported wrapper `runAdvanceTickWithTreelessPublish` in `advance-drivers.ts` (used by both `runSelectedInSequence` and the CLI single-named-arg path) rather than inline blocks at each site. Was the wrapper the intended shape (slice prompt asked to record exactly where the hook sits)?
  (packages/agent-runner/src/advance-drivers.ts lines 282–334 introduce `runAdvanceTickWithTreelessPublish`; `cli.ts` line 2563 wraps the single-arg `performAdvance` through it. The slice has no `## Decisions` block recording this placement.)
- Ratify: the in-place gate adds `options.arbiter !== undefined` as a third condition, where the `--isolated` driver does not gate on arbiter at all and the loop driver falls back to `'origin'`. This is consistent with the slice's stated "do NOT push when no arbiter is configured" laptop-case rule, but it is a small divergence from the literal "match byte-for-byte" framing. Confirm this is the right place for the no-arbiter short-circuit.
  (advance-drivers.ts lines 319–325 vs advance-isolated.ts lines 194–203 and advance-loop-driver.ts lines 204–215. The CLI in-place context resolves `arbiter: flags.arbiter ?? config.defaultArbiter` (cli.ts line 2490), so undefined is a real possibility in-place but not in the per-tick-clone substrates.)
- Should the existing `--isolated` and loop driver call sites be refactored to share the new `runAdvanceTickWithTreelessPublish` wrapper in a follow-up? The slice explicitly forbade forking and the wrapper happens to be the third near-identical block, not a forked helper, so this is fine as-is — flagging only as a future-tidy candidate.
  (advance-isolated.ts lines 194–204 and advance-loop-driver.ts lines 204–217 still inline the same gate-and-push block; the new wrapper in advance-drivers.ts is a fourth subtle variation (the loop one threads `options.env` and `options.context.cwd !== undefined`, the isolated one has no arbiter gate).)
