<!-- dorfl-sidecar: item=observation:drop-glossary-stale-disposition-premise type=observation slug=drop-glossary-stale-disposition-premise allAnswered=false -->

Item: [`observation:drop-glossary-stale-disposition-premise`](../notes/observations/drop-glossary-stale-disposition-premise.md)

## Q1

**What becomes of this observation — drop it now that the glossary fix has landed and is captured in the done record, or promote it to something more durable (e.g. a tiny ADR/spec note that the observation-triage token vocabulary is retired) before discarding?**

> The observation records a self-contained factual gap resolved in-flight while building task drop-verb-cleanup-dead-config-flag-and-glossary: the task's premise pinned 'dropped' as a triage-disposition TOKEN, but that vocabulary has been retired (SURFACE-PROTOCOL.md: sidecar is binary no-answer|answered, no disposition= field; triage-observations/SKILL.md:38: no delete/dropped token to stamp). Current CONTEXT.md:74 already carries the corrected glossary entry with a parenthetical noting the token retirement and pointing at SURFACE-PROTOCOL + triage-observations. The observation is linked from the done record for reviewer ratification, so its signal is already consumed there.

_Suggested default: Drop (git rm) after the done record's reviewer ratifies the in-flight decision — the fix is landed in CONTEXT.md:74, the linked done record carries the reasoning, and no further durable artefact is warranted for a stale-sub-clause correction._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete. The glossary fix has landed and is captured in the done record. Do NOT mint an ADR/spec note that the observation-triage token vocabulary is retired: the binary answered-slot sidecar model already supersedes the disposition tokens, so the done record suffices.
