---
item: observation:pi-harness-jsonl-reliance
type: observation
slug: pi-harness-jsonl-reliance
allAnswered: false
---

## Q1
id: q1
question: |
  What should happen to this observation — promote it to a slice for a pi-harness polish pass, keep it open as a future-polish marker, or close it?
context: |
  Observation flags that pi adapter scrapes pi's internal session .jsonl in three load-bearing places: --watch (src/watch-session.ts), liveness/audit (src/pi-harness.ts piSessionExists, sessionPointer), and the new harness-agent-output reader. All three depend on pi's evolving internal persistence format; a format change could silently break watch + output + audit at once. The author explicitly frames it as 'worth noting (not fixing now)' and the body's own 'Disposition' paragraph names a 'future pi-harness-polish pass' that should (a) study the best channel per capability (pi structured output mode / SDK / IPC / HTTP, vs scraping), (b) revisit existing call sites not just the new reader, and (c) keep the LaunchResult.output cross-harness seam (Option C) intact so opencode (stdout stream / HTTP export, no persisted file) fits. Captured 2026-06-06 during batch-qa/review-gate work; maintainer explicitly flagged the future polish pass. No pre-existing needsAnswers or ## Open questions block on the item.
default: |
  promote-slice (a dedicated pi-harness-jsonl-polish slice, since the body already sketches concrete scope: audit the three call sites, evaluate non-scraping channels, preserve the LaunchResult.output seam)
answered: false
answer: |
disposition: promote-slice
