<!-- dorfl-sidecar: item=observation:advance-watch-surface-leg-hangs-after-release-never-exits-2026-07-09 type=observation slug=advance-watch-surface-leg-hangs-after-release-never-exits-2026-07-09 allAnswered=false -->

Item: [`observation:advance-watch-surface-leg-hangs-after-release-never-exits-2026-07-09`](../notes/observations/advance-watch-surface-leg-hangs-after-release-never-exits-2026-07-09.md)

## Q1

**What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).**

> The engine records your disposition from the answer (no token needed); an answered promote mints the artifact, resolve keeps the note settled, delete/duplicate discharge it.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Resolve, conditional on the Q2 CI check. If a post-0b0039d0 lifecycle run has shown a surface/triage leg completing promptly after logging RELEASED (see Q2), delete this observation as fixed-and-confirmed. Until such a run is observed, keep it open as a watch item rather than resolving on faith.

## Q2

**Has a live CI lifecycle run since fix commit 0b0039d0 shown an 'advance one item in-place' step on a surface/triage leg going in_progress -> completed promptly (not stuck ~20-55min) after logging RELEASED, so this observation can be dropped?**

> Body 'What remains' section: only the live CI re-confirmation is outstanding; dispatch run 29018787541 was still pending behind a backed-up hosted-runner queue at fix time. The hang mechanism (launchAsync resolving on 'close' vs 'exit' with a grandchild inheriting stdio pipes) is conclusively reproduced and fixed locally with a regression test in pi-harness.test.ts; acceptance gate green. Discharge path named in the body: dorfl drop obs:advance-watch-surface-leg-hangs-after-release-never-exits-2026-07-09.

_Suggested default: If a post-0b0039d0 lifecycle run shows a surface/triage leg completing promptly after RELEASED, resolve/delete this observation; otherwise keep it open until such a run is observed._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
