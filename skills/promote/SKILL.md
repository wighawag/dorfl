---
name: promote
description: 'The pre-promotion checklist: judge ONE staged work/ item (a task in tasks/backlog/, a brief in briefs/proposed/) against its acceptance + destination before a human admits it into the agent pool. Emits a promote / keep-staged / drop recommendation; the human (or the runner promote verb) does the move.'
---

# promote

**Staging is the human review-gate.** In the `work/` contract, `tasks/backlog/` and `briefs/proposed/` are STAGING (untrusted / agent-authored output lands here); the agent POOL is `tasks/todo/` and `briefs/ready/`. Items enter staging by a runner-deterministic placement decision; they leave it ONLY when a human promotes them. This skill is the **discipline a human applies to ONE staged item before promoting it** — it is the checklist that makes the gate a real review, not a rubber stamp.

It is a thin **methodology skill** (prose you follow), a sibling of `review`. It does NOT move anything: the promotion `git mv` (`tasks/backlog/ → tasks/todo/`, `briefs/proposed/ → briefs/ready/`) is a runner-owned transition (a future `agent-runner promote <item>` verb, or the human's own move). You EMIT a verdict; the caller acts on it. Per the contract, an agent never sets position.

## When to use vs. not

- **Use** before admitting a staged task/brief into the pool: when reviewing what an agent (slicing / intake) emitted into `tasks/backlog/` or `briefs/proposed/`, to decide promote / keep-staged / drop for each. `orchestrate` composes this in its survey (the "awaiting promotion" set); a human also reaches for it directly to clear a staging backlog.
- **Don't** use it to judge an item already IN the pool (that is plain `review`), to build a ready task (`drive-backlog`), or to slice a brief (`to-task`). It is the ONE gate-crossing judgement: staging → pool.

## How to use

For each staged item, run the `review` discipline FIRST (it is the body of this check), then add the promotion-specific gate:

1. **Review the artifact** — apply `review` (i.e. `work/protocol/REVIEW-PROTOCOL.md`'s lenses + the destination check) to the staged task/brief exactly as you would any `work/` artifact. This already covers: does it deliver its stated goal, is it coherent, does it match the brief/ADR it descends from.
2. **Freshness / drift** — staging items are often agent-authored ahead of time. Spot- check the load-bearing premises against current reality (`tasks/done/` + `src/`): does anything it says is "not yet built / still TODO / has no consumers" already hold? A drifted staged item is NOT promotable as-is — it is keep-staged with the stale premise named (the same drift check `drive-backlog`/`orchestrate` run on ready tasks, applied one step earlier).
3. **Pool-readiness gate** — would this item be agent-actionable the MOMENT it lands in the pool? Promote only if yes:
   - **Task** → every `blockedBy` is resolvable, `needsAnswers` is false (no open question a human must answer first), `humanOnly` is correctly set (off unless never-for-agents-by-nature). A staged task carrying open questions is keep-staged until they are answered, not promoted-then-blocked.
   - **Brief** → `humanOnly`/`needsAnswers` correct, `briefAfter:` satisfied, and it is genuinely sliceable (not still a design sketch). An unready brief stays `briefs/proposed/`.
4. **No collision / no duplicate** — confirm no item with the same `(umbrella, slug)` already rests in the destination pool or a terminal, and the work isn't already covered by a done item.
5. **Verdict** — emit ONE of:
   - **PROMOTE** — review passed, fresh, pool-ready, no collision. State the move the caller should make (`agent-runner promote <item>`, or the `git mv`).
   - **KEEP-STAGED** — a fixable gap (drifted premise, open question, not-yet-sliceable brief). State the SPECIFIC blocker so it can be resolved, then re-checked.
   - **DROP** — superseded / out-of-scope / duplicate. Route to the regime terminal (`tasks/cancelled/` / `briefs/dropped/`) with the `reason:`, per the contract.

You WRITE nothing and you MOVE nothing — you surface the verdict; the human or the runner's `promote` verb performs the transition (and a DROP is its own runner-owned move to the terminal). Batch the verdicts when judging several staged items at once, ordered by leverage (what each promotion unblocks downstream).

> Why position is human-gated and runner-moved: placement is runner-deterministic on the way IN (the `originTrust` stamp + policy decide STAGING vs POOL); promotion OUT is the human's review-gate. The agent never sets the folder. See `work/protocol/WORK-CONTRACT.md` (staging → pool) and the governing ADR `placement-is-runner-deterministic-humanonly-is-agent-judgement.md`.
