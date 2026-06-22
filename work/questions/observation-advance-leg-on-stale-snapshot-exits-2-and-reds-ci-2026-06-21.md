<!-- agent-runner-sidecar: item=observation:advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 type=observation slug=advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 allAnswered=false -->

## Q1

**Triage this observation: is the benign-race-reds-CI + already-done/wrong-slug-conflation worth promoting to a slice, promoting to an ADR (exit-code semantics policy), keeping as a note, or dropping?**

> A stale-snapshot `advance` matrix leg (item already moved to `done/` between enumerate and fan-out) exits 2 and reds CI, and the message conflates a benign already-done race with a real wrong-slug typo (both `src/claim-cas.ts` sites emit the identical "not found on origin/main (already done/removed, or wrong slug)" + exit 2). ADR `ci-config-policy-and-gate-family` §7 calls the race benign-by-design. The message-conflation fix is uncontested and wanted regardless; the benign-skip-exit change needs Q2/Q3 baked into the slice spec.

_Suggested default: promote-slice (carrying the Q2/Q3 decisions below)_

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

promote-slice. Verified: the two claim-CAS sites emit the IDENTICAL "not found on main (already done/removed, or wrong slug)" message and both exit 2, conflating a benign already-done race with a real typo; ADR `ci-config-policy-and-gate-family` §7 calls the race benign-by-design. The message-conflation fix is uncontested and wanted regardless; the benign-skip-exit change needs Q2/Q3 baked into the slice spec. Disposition: promote-slice (carrying the Q2/Q3 decisions below).

## Q2

**Should a stale-snapshot leg whose item is already in a TERMINAL folder exit 0 (silent benign skip, leg green) or exit a NEW distinct non-zero code that the workflow specifically tolerates (skip recorded, but still observable)?**

> The codebase already distinguishes `contended` (exit 3, a tolerated "this is fine" outcome) from gone-from-main (exit 2), and the matrix workflow already tolerates `contended` legs.

_Suggested default: a NEW distinct tolerated non-zero code (skip recorded, still observable), consistent with the existing `contended` design_

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Lean: a NEW distinct tolerated non-zero code (skip recorded, still observable), rather than a silent exit 0. Rationale: the codebase ALREADY distinguishes `contended` (exit 3, a tolerated "this is fine" outcome) from gone-from-main (exit 2), and the matrix workflow already tolerates `contended` legs, so a distinct tolerated code for "item already terminal" is consistent with the existing design and keeps the skipped-leg signal visible, whereas exit 0 loses it. (Exit 0 with a clear SKIP message is also defensible and matches §7 intent; either is acceptable, but I prefer the observable code.)

## Q3

**Should the benign-skip behaviour be the DEFAULT for all callers, or gated behind an opt-in flag (e.g. `--quiet-if-gone`) that CI sets while interactive humans keep the loud exit-2?**

> An interactive human who typos an already-done slug wants the loud error; a CI leg wants the quiet skip. INDEPENDENTLY, the message conflation (terminal / staged-but-not-pool / nowhere) should be fixed regardless of the flag.

_Suggested default: flag-gated (`--quiet-if-gone`) set by the matrix leg; keep interactive default loud; ALWAYS fix the message conflation regardless_

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Flag-gated (e.g. `--quiet-if-gone`) set by the matrix leg in the workflow; keep the interactive default LOUD so a human who typos an already-done slug still gets the error. INDEPENDENTLY and regardless of the flag, ALWAYS fix the message conflation so the three cases (terminal / staged-but-not-pool / nowhere) are distinguishable in output, that fix is wanted on its own merits.
