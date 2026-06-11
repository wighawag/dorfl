---
title: review-gate non-blocking nits for 'advance-verb-resolver' (Gate 2 approve)
date: 2026-06-11
status: open
slug: advance-verb-resolver
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-verb-resolver' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the cross-command behaviour change: `do obs:<slug>` (and the other do-family slice-only commands) now THROW a clear SlugResolutionError pointing at `advance obs:`, where previously `obs:foo` parsed as a literal bare slug named 'obs:foo'. Is turning `do obs:…` into a helpful redirect (rather than a 'no such slice' failure) the intended surface?
  (slug-namespace.ts: `resolveSlug` and `resolveSliceOnlyArg` gained explicit `observation` rejection branches; do.ts calls `resolveSlug` at lines 482 and 1363, so this is LIVE on the `do` command, not just `advance`. The slice text ('the do-only resolveSliceOnlyArg path stays rejecting prd:/obs: as today') implies this is intended, and the new behaviour is strictly more helpful (a clear redirect vs a confusing 'slice obs:foo not found'). Recording it because it is an in-scope, user-visible cross-command choice the agent made on its own and there is no `## Decisions` block on the artifact to ratify it from.)
- The slice's acceptance criteria required the bare-eligible-set stub seam to be 'recorded in a ## Decisions block', and the agent SHOULD have surfaced its in-scope decisions in a PR-description Decisions block. Neither exists (this was a WIP-saved aborted run finished later; the slice file has only a Requeue note). The decisions ARE thoroughly documented in code comments — confirm that satisfies the 'record the seam' requirement, or add the Decisions block for the record.
  (advance.ts documents the bare-form stub ('needs the driver slice') and the orchestrate-vs-duplicate decision extensively in JSDoc, and a dedicated test pins the bare-form error. So the decision is captured where it matters (the code), just not in the protocol's `## Decisions` location. Purely a bookkeeping gap, not a correctness defect.)
- `resolveAdvanceArg` and `performAdvance` are NOT re-exported from `packages/agent-runner/src/index.ts`, whereas the sibling dependency slice DID export `classifyTick`/`isAdvanceable` from `advance-classify`. Intentional (the verb's API surface stays CLI-internal until the drivers land), or an oversight to align before the family is complete?
  (index.ts re-exports `classifyTick, isAdvanceable` (advance-classify) but nothing from advance.ts; cli.ts imports `performAdvance` directly from './advance.js', so nothing breaks. Minor consistency nit, harmless for this slice.)
