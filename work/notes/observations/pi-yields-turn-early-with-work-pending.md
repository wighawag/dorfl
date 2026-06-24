---
title: 'pi occasionally yields the turn back to the user (waiting for input) when the agent still has queued work, instead of continuing autonomously; a manual "continue" resumes it'
date: 2026-06-14
status: open
needsAnswers: true
---

## The signal

During an interactive `pi` session (this repo's supervised drive-backlog work), the agent had more work queued to do but pi **ended the turn and handed control back to the maintainer**, waiting for user input, rather than continuing on its own. The maintainer jumped into the session and sent a single message, `continue`, and the agent resumed and finished the job normally.

Observed by the maintainer (wighawag) live, 2026-06-14.

CLARIFICATION (corrects an earlier framing): this is NOT a tool call that hung or that pi failed to register as complete. The session was NOT stuck waiting on a tool result. The tool work had returned and pi had **yielded the turn**: the session was accepting user input (that is how the maintainer was able to type `continue`). So the bug is that pi **stopped early / gave the turn back to the user** when the agent still had pending work to do, instead of proceeding autonomously. The `continue` simply tells it to keep going.

## Why it matters

- It is a **pi harness-level behaviour**, NOT an dorfl protocol issue: nothing in the `work/` contract or the runner caused it, and the runner cannot detect or recover from it (the runner does not own the conversation turn; pi decided to yield).
- It **silently pauses an otherwise-healthy session**. A long autonomous stretch (e.g. a conductor drive working through several steps) can look "done" or hung when in fact pi has just handed the turn back early with work still pending, indistinguishable at a glance from the agent legitimately finishing. The only recovery seen is a human typing `continue`, which is impossible in a truly unattended run.
- It is **rare but recurring**: the maintainer reports seeing this "time to time when in conversation, quite rare but it happens." So it is intermittent and not reproducible on demand, which makes it easy to misread as the agent being finished.

## Scope / provenance

- This is an EXTERNAL (harness) behaviour, captured as a spotted signal, not verified ground truth about a known pi code path. It is filed here so the pattern is recorded and can be correlated if it recurs (e.g. against pi version, session length, or what the agent was mid-doing when it yielded).
- Distinct from `pi-harness-jsonl-reliance.md` (that is about dorfl's `.jsonl`-scraping coupling); this one is about pi's own turn-ending / yield-to-user decision.
- Cross-ref: the drive-backlog `interrupt footgun` is a DIFFERENT failure (a killed wrapper leaving a live child still editing); this is roughly the inverse, a live session that ends its turn early and waits for the user when it could have continued.

## Candidate follow-ups (not actioned)

- If it recurs, capture the session id / `.jsonl` around the early yield and the pi version, to give pi maintainers a concrete repro lead (in particular, what the last assistant/tool step was before it handed the turn back).
- Any auto-`continue` watchdog would belong in pi (it owns the turn), not in the runner; and it would need to distinguish a genuine "agent is done" turn-end from this premature one, which is the hard part.
