---
'dorfl': patch
---

The build agent's prompt now names the paths the task body and its source spec were actually resolved from. Under `do --allow-backlog` it says `work/tasks/backlog/<slug>.md` instead of `work/tasks/ready/<slug>.md`, and a tasked spec is named at `work/specs/tasked/<spec>.md` instead of `work/specs/ready/<spec>.md`. Build agents no longer stop to file observations about the mismatch. A normal pool build's prompt is unchanged.
