<!-- agent-runner-sidecar: item=observation:advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 type=observation slug=advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 allAnswered=false -->

## Q1

**Triage this observation: is the benign-race-reds-CI + already-done/wrong-slug-conflation worth promoting to a slice, promoting to an ADR (exit-code semantics policy), keeping as a note, or dropping?**

> Observation captures two defects in `agent-runner advance`: (1) a stale-snapshot matrix leg whose item already moved to `tasks/done/` exits 2 and reds CI even though ADR `ci-config-policy-and-gate-family` §7 explicitly calls this race benign and expected; (2) the message + exit at `src/claim-cas.ts:270`/`:332` (mapped by `src/do.ts` ~L553) CONFLATES `already done/removed` with `wrong slug`, so a typo and a benign race are indistinguishable. Both small, scoped, improve the autonomous CI experience the `runner-in-ci` PRD targets. Not a correctness bug.

_Suggested default: promote-slice (small, well-scoped fix touching `claim-cas.ts` + `do.ts` exit mapping + workflow expectations; conflation fix and benign-skip exit are both concrete)_

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

## Q2

**Should a stale-snapshot leg whose item is already in a TERMINAL folder exit 0 (silent benign skip, leg green) or exit a NEW distinct non-zero code that the workflow specifically tolerates (skip recorded, but still observable)?**

> The observation proposes three outcomes (terminal → benign skip; staged-but-not-pool → distinct message; nowhere → loud exit 2) but explicitly leaves OPEN which exit code the matrix LEG should carry so the workflow run goes green on a pure benign race. Exit 0 is simplest but loses the signal that something was skipped; a dedicated exit code keeps the signal but requires workflow-side handling.

_Suggested default: exit 0 with a clear SKIP message — matches ADR §7 intent that the race is benign-by-design, keeps CI green without workflow-side special-casing_

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Should the benign-skip behaviour be the DEFAULT for all callers, or gated behind an opt-in flag (e.g. `--quiet-if-gone`) that CI sets while interactive humans keep the loud exit-2?**

> Observation flags the tension: an interactive operator who typos a slug WANTS the loud error; a CI matrix leg wants the quiet skip. Options are (a) change the default for everyone (simpler, but interactive typos of an already-done slug become silent), (b) flag-gated (CI workflow sets it, interactive unchanged), (c) auto-detect (e.g. `CI=true` env). The conflation fix — separating `already done/removed` from `wrong slug` in the MESSAGE — is orthogonal and arguably wanted regardless.

_Suggested default: flag-gated (`--quiet-if-gone` or similar) set by `advance-lifecycle.yml`'s matrix leg; keep interactive default loud. Independently, ALWAYS fix the message conflation so the three cases (terminal / staged / nowhere) are distinguishable in output._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
