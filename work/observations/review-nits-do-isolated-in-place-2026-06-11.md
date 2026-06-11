---
title: review-gate non-blocking nits for 'do-isolated-in-place' (Gate 2 approve)
date: 2026-06-11
status: open
slug: do-isolated-in-place
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'do-isolated-in-place' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the redundancy default: `--isolated` + `--remote <url>` is accepted as a no-op with `--remote` winning (isolation implied), rather than erroring to keep the two flags strictly exclusive. The slice flagged this as the one open micro-choice. Confirm 'remote wins' is the intended default, or request strict-exclusive (error on the combination).
  (Implemented at the branch guard: when both flags are set, `isolatedNoRemote` is false so the form resolves to `--remote` and the cwd arbiter is never consulted; covered by the 'remote wins' test (reaches the remote pipeline / missing-agentCmd guard from a cwd with no arbiter). This is the maintainer's stated model — flagged only because the slice explicitly required it be ratified.)
- The slice required the redundancy decision to be recorded in a `## Decisions` block in the PR description, but the code only references one ('see `## Decisions`') and no PR description / Decisions block is present in the diff (the work is uncommitted; only a claim commit exists). Add the `## Decisions` block to the PR description so the human's ratification is anchored where the slice mandated.
  (Process/contract item, not a behaviour defect. cli.ts comments say 'so we accept it and `--remote` WINS (see `## Decisions`)' but there is no such block to point at. Without it the decision is implicit in code comments and tests only.)
- Minor doc-comment drift: `resolveDefaultArbiterForCwd` is titled 'Resolve the arbiter URL for `do --isolated`' but actually returns the arbiter remote NAME (`config.defaultArbiter`); the URL is obtained one step later by `resolveArbiterUrlFromCheckout`. Consider retitling the header to '…the arbiter remote NAME…' to match the body (the inline body comment is already correct).
  (packages/agent-runner/src/cli.ts ~L194: function header says URL, return is `resolveRepoConfig(...).config.defaultArbiter` (a name). Harmless — the call site does `arbiterName = flags.arbiter ?? resolveDefaultArbiterForCwd(...)` then resolves the URL — but the header could mislead a future reader.)
- Ratify the deferral of the ADR `command-surface-and-journeys` §3 'pending build (slice do-isolated-in-place)' marker flip to a follow-up observation (`work/observations/adr-isolated-pending-build-marker-now-shipped.md`) rather than editing the ADR in this slice. The slice's Follow-up section authorised leaving it as a captured note; confirm that's acceptable so the stale 'pending build' caveat gets dropped when convenient.
  (The slice scope said 'do NOT edit the ADR' and the observation correctly records the one-line edit to make once this lands. No code impact; surfaced so the doc marker is not forgotten.)
