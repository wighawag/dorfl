<!-- dorfl-sidecar: item=observation:task-pool-folder-named-todo-is-less-precise-than-ready-2026-06-20 type=observation slug=task-pool-folder-named-todo-is-less-precise-than-ready-2026-06-20 allAnswered=false -->

## Q1

**This observation is already resolved by shipped work — what becomes of it: delete it as discharged, or is there residual follow-up you still want kept open?**

> The observation (spotted 2026-06-20, needsAnswers: true) raises whether the claimable task-pool folder should be renamed `tasks/todo/` -> `tasks/ready/` (Tier 2) and/or glossed (Tier 1). Current reality shows that rename has ALREADY been done as a clean break:
> - On disk the pool folder is `work/tasks/ready/`; there is NO `work/tasks/todo/` (ls work/tasks/ => backlog, cancelled, done, ready).
> - The protocol docs use `tasks/ready/` throughout (WORK-CONTRACT.md layout/rule-6/claimable-predicate, CLAIM-PROTOCOL.md:9 "the body is in the pool tasks/ready/", TASKING-PROTOCOL.md, task-template.md, prd-template.md) in BOTH skills/setup/protocol/ (source) and work/protocol/ (copy).
> - The enum value is renamed: `TasksLandIn = 'pre-backlog' | 'ready'` (packages/dorfl/src/config.ts:38); config.ts:29 and placement.ts:23 document the value was renamed `'backlog'` -> `'todo'` -> `'ready'` under ADR `rename-task-pool-folder-todo-to-ready`, and tasking.ts:354-355 records the legacy `'backlog'`/`'todo'` spellings are NOT accepted (clean break).
> - A grep for residual `tasks/todo` / `'todo'` pool references in protocol + skills returns nothing.
> So the observation's open question (Tier 1 / Tier 2 / drop) has been answered by Tier 2 + the ADR, and the body's premise ("the pool folder is named todo") no longer matches the repo. There is no remaining decision the signal points at.

_Suggested default: Delete the observation as discharged: the rename it proposed shipped (ADR rename-task-pool-folder-todo-to-ready, folder is tasks/ready/, 'todo' is a retired legacy spelling). Per WORK-CONTRACT.md a note leaves the inbox by deletion once it stops being a live signal; remove the source note (and its sidecar) in one revertible commit._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete as discharged. The rename it proposed already shipped (ADR `rename-task-pool-folder-todo-to-ready`; the pool folder is `tasks/ready/`; `todo` is a retired legacy spelling not accepted by the clean-break parser). The observation's premise no longer matches the repo and there is no residual decision. Remove the source note and its sidecar in one revertible commit.
