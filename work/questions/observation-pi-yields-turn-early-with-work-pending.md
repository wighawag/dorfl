---
item: observation:pi-yields-turn-early-with-work-pending
type: observation
slug: pi-yields-turn-early-with-work-pending
allAnswered: false
---

## Q1
id: q1
question: |
  What is the terminal disposition for this observation — keep it as a passive recurrence log, mark it out-of-scope (it is explicitly a pi-harness behaviour, not an agent-runner protocol issue), or delete it as not actionable here?
context: |
  The note itself argues this is a pi-harness-level behaviour that the runner cannot detect or recover from, and that any auto-continue watchdog 'would belong in pi, not in the runner.' It is intermittent ('rare but recurring'), not reproducible on demand, and has no candidate follow-ups that are actioned — only correlation hints if it recurs. So there is nothing here to promote to a slice or ADR in agent-runner; the live judgement is whether it stays as a recorded pattern, gets reframed as out-of-scope for this repo, or is dropped.
default: |
  keep — leave it as an open recurrence log so future sightings can be correlated against pi version / session context, since the cost is low and the signal is genuinely external to the protocol
answered: false
answer: |
disposition: keep
