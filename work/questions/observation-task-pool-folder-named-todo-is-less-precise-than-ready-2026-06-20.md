<!-- dorfl-sidecar: item=observation:task-pool-folder-named-todo-is-less-precise-than-ready-2026-06-20 type=observation slug=task-pool-folder-named-todo-is-less-precise-than-ready-2026-06-20 allAnswered=false -->

## Q1

**What is the terminal disposition of this naming observation: drop it, keep it as a cheap Tier-1 gloss in WORK-CONTRACT.md, or promote it to an ADR for a Tier-2 rename `tasks/todo/` → `tasks/ready/`?**

> The observation itself explicitly defers this — 'The question to decide (NOT decided here)... a human decides whether Tier 1 / Tier 2 / drop.' Tier 1 = one-line gloss reinforcing that `todo/` means the committed/claimable Kanban-`Ready` pool, no behaviour change. Tier 2 = rename touching WORK-CONTRACT.md (source + byte-identical `work/protocol/` copy), `to-task`/`drive-backlog`/`orchestrate` skills, the `slicesLandIn` enum + placement resolver (`src/config.ts`, `src/placement.ts`), tests, CONTEXT.md, and website docs — non-cosmetic blast radius. The observation also notes the existing adjacent contract text ('the AGENT POOL... eligible to claim') already mitigates the misread, so Tier 1 is 'arguably optional'. Marked lowest-priority, naming/clarity signal, not a bug.

_Suggested default: promote-adr for Tier 2 (rename to `tasks/ready/`) — the folder name is load-bearing on the claimable predicate, the originating conversation already shows an agent misreading it, and an ADR is the right forum to weigh the rename's blast radius vs. the Tier-1 gloss alternative without pre-committing to either._

<!-- q1 fields: id=q1 disposition=promote-adr -->

**Your answer** (write below this line):
