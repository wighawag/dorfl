---
'dorfl': patch
---

Propose PR bodies now point at the file the PR really carries. A tasking PR names `work/specs/tasked/<slug>.md` instead of a `work/tasks/done/<slug>.md` path that never exists. An intake PR is no longer blank: it names the staged task or spec (for example `work/tasks/backlog/<slug>.md` or `work/specs/proposed/<slug>.md`) and the source issue, with no closing keyword, so merging it leaves the issue open. Task build PR bodies are unchanged.
