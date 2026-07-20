---
'dorfl': minor
---

Surface WHICH gate command failed and its output in a bounced item's needs-attention reason.

When an item bounces because the acceptance gate (`verify`) fails — including the land-time re-verify on the rebased tip — the surfaced `work/questions/<slug>.md` reason was an opaque `acceptance gate failed (exit N) on the rebased tip`. A maintainer could not tell WHICH step of a multi-command gate (`build && test && format:check && changeset status …`) failed, or WHY, without re-running the whole gate by hand.

`runVerify` now captures, on a failing gate, the exact `failedCommand` (the first non-zero-exit command, matching `&&` short-circuit semantics) and a bounded `outputTail` (the last non-empty lines of that command's combined stdout+stderr, capped by the new `VERIFY_OUTPUT_TAIL_LINES`). A new pure `formatGateFailureContext()` helper turns those into an appendable tail, wired through every gate-failure site (front gate, rebased-tip fresh-worktree gate, committed-recovery). The bounce reason now reads e.g. `acceptance gate failed (exit 1) on the rebased tip — the failing step was: \`pnpm changeset status --since=main\`; its last output was: … no changesets were found. Run \`changeset add\` …`, so the surfaced question is actionable (and often self-documents the fix) instead of a bare exit code.
