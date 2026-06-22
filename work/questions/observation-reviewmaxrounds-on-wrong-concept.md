<!-- agent-runner-sidecar: item=observation:reviewmaxrounds-on-wrong-concept type=observation slug=reviewmaxrounds-on-wrong-concept allAnswered=false -->

## Q1

**Does this observation's HOLD still stand, or has the build-path Gate-2 situation changed enough to act now (e.g. design the builder revise↔review loop and MOVE `reviewMaxRounds` there, or just delete it from the gate)?**

> The observation flags that `reviewMaxRounds` is live on the build-path review GATE (`integration-core.ts` ~L437 loop with no revise step between iterations — same diff re-reviewed N times, a no-op). Maintainer twice decided HOLD (2026-06-08 triage, re-verified 2026-06-12): do NOT remove in isolation; re-home onto a future revise↔review loop when that loop is designed/built. The slicer-side half is already settled — the slicer edit loop landed with its own `slicerLoopMax`, and the slice acceptance gate (slicing-coherence) is one-shot and does NOT inherit the bound. The remaining orphan is purely on the BUILD gate. The natural triage answer is to keep this note as the standing record until the builder revise loop is on the table.

_Suggested default: keep — HOLD still stands; leave the observation as the standing record of the orphan until a builder revise↔review loop is designed, then MOVE the bound rather than delete it in isolation_

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

KEEP — the HOLD still stands; the situation is unchanged. Verified: the build-path Gate-2 loop still has NO revise step between rounds (the loop re-reviews up to `reviewMaxRounds`, with a comment marking where "a future builder-revise step plugs in here"), and the config docstring still flags `reviewMaxRounds` as an orphan belonging to that future loop. Re-reviewing the same unchanged diff N times is a no-op, so acting now is premature; deleting the parameter in isolation would lose what the future revise↔review loop needs. The natural resolution remains MOVE-when-the-loop-is-designed, not delete-in-isolation. Disposition: keep.
