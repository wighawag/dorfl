<!-- dorfl-sidecar: item=observation:pi-harness-jsonl-reliance type=observation slug=pi-harness-jsonl-reliance allAnswered=false -->

## Q1

**What should become of this signal: the observation that pi's harness adapter now relies on scraping pi's internal session .jsonl format in three load-bearing places (--watch in src/watch-session.ts, liveness/audit in src/pi-harness.ts piSessionExists/sessionPointer, and the merged agent-output reader)? Mint a backlog task/PRD for the proposed pi-harness-polish pass, keep it as a deferred observation, or drop it?**

> work/notes/observations/pi-harness-jsonl-reliance.md, status: open, needsAnswers: true. The claim is verified against current code: the three call sites exist (pi-harness.ts lines 90, 325-341 read the .jsonl for liveness pointer and last-assistant output; watch-session.ts tails it for the live view), and harness-agent-output is now MERGED (PR #12, tasks/done/harness-agent-output.md), so the third .jsonl consumer the note worried about is live on main. The risk named is real: a single pi-internal session-PERSISTENCE format change could silently break watch + output + audit at once (watch-session.ts comments already record a vocabulary mismatch that once made `do --watch` a silent no-op). The note's own Disposition section scopes a dedicated pass: (a) study the best channel for output/liveness/watch rather than assuming .jsonl, (b) revisit the existing call sites not just the new reader, (c) keep the cross-harness LaunchResult.output (Option C) seam intact so opencode (stdout-stream/HTTP, no persisted file) fits. The maintainer explicitly flagged this as a FUTURE polish pass, not a fix-now item.

_Suggested default: Mint a deferred backlog task `pi-harness-polish` carrying the note's three-point disposition verbatim (study best channel per need; revisit watch-session.ts + pi-harness.ts call sites; preserve the LaunchResult.output cross-harness seam), then close the observation. It is a coherent, maintainer-flagged future improvement, not an immediate defect, so it belongs queued rather than acted on now or discarded._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
