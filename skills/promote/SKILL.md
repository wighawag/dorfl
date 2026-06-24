---
name: promote
description: 'The pre-promotion checklist: judge ONE staged work/ item (a task in tasks/backlog/, a prd in prds/proposed/) against its acceptance + destination before a human admits it into the agent pool. Emits a promote / keep-staged / drop recommendation; the human (or the runner promote verb) does the move.'
---

# promote

**Staging is the human review-gate.** In the `work/` contract, `tasks/backlog/` and `prds/proposed/` are STAGING (untrusted / agent-authored output lands here); the agent POOL is `tasks/ready/` and `prds/ready/`. Items enter staging by a runner-deterministic placement decision; they leave it ONLY when a human promotes them. This skill is the **discipline a human applies to ONE staged item before promoting it** — it is the checklist that makes the gate a real review, not a rubber stamp.

It is a thin **methodology skill** (prose you follow), a sibling of `review`. It does NOT move anything: the promotion `git mv` (`tasks/backlog/ → tasks/ready/`, `prds/proposed/ → prds/ready/`) is a runner-owned transition (a future `agent-runner promote <item>` verb, or the human's own move). You EMIT a verdict; the caller acts on it. Per the contract, an agent never sets position.

## When to use vs. not

- **Use** before admitting a staged task/prd into the pool: when reviewing what an agent (tasking / intake) emitted into `tasks/backlog/` or `prds/proposed/`, to decide promote / keep-staged / drop for each. `orchestrate` composes this in its survey (the "awaiting promotion" set); a human also reaches for it directly to clear a staging backlog.
- **Don't** use it to judge an item already IN the pool (that is plain `review`), to build a ready task (`drive-tasks`), or to task a prd (`to-task`). It is the ONE gate-crossing judgement: staging → pool.

## How to use

For each staged item, run the `review` discipline FIRST (it is the body of this check), then add the promotion-specific gate:

1. **Review the artifact** — apply `review` (i.e. `work/protocol/REVIEW-PROTOCOL.md`'s lenses + the destination check) to the staged task/prd exactly as you would any `work/` artifact. This already covers: does it deliver its stated goal, is it coherent, does it match the prd/ADR it descends from.
2. **Freshness / drift** — staging items are often agent-authored ahead of time. Spot- check the load-bearing premises against current reality (`tasks/done/` + `src/`): does anything it says is "not yet built / still TODO / has no consumers" already hold? A drifted staged item is NOT promotable as-is — it is keep-staged with the stale premise named (the same drift check `drive-tasks`/`orchestrate` run on ready tasks, applied one step earlier).
3. **Pool-readiness gate** — once in the pool, can the item rest there SAFELY? Promote if yes. The bar is "safe in the pool", NOT "claimable this instant":
   - **`blockedBy` is NOT a promotion gate — it is machine-ENFORCED at claim time, so a blocked task is safe in the pool.** Do NOT keep a task staged merely because a `blockedBy` slug has not yet reached `tasks/done/`. The claim predicate already refuses an item whose `blockedBy` is unresolved, so a blocked-but-otherwise-ready task simply WAITS in `tasks/ready/` until its blocker lands, then becomes claimable automatically — no human re-check needed. Holding it in staging for an unresolved dependency duplicates an enforced invariant and needlessly strands ready work behind a human round-trip. (The blocker slug does not even need to exist yet; `blockedBy` resolves lazily against `tasks/done/` whenever a claim is attempted.) Promote a well-formed blocked task NOW; the dependency graph sequences it for you.
   - **Task → the real gates are the UNENFORCED, human-owned ones:** `needsAnswers` is false (no open question a human must answer first — an open question is NOT machine-enforced, so a `needsAnswers:true` task promoted into the pool would be picked up blind), and `humanOnly` is correctly set (off unless never-for-agents-by-nature). A staged task carrying open questions is keep-staged until they are answered, not promoted-then-blocked. (Contrast `blockedBy` above: that one IS enforced, so it is not a reason to keep-stage.)
   - **Prd** → `humanOnly`/`needsAnswers` correct and it is genuinely taskable (not still a design sketch). Like `blockedBy`, `prdAfter:` is ENFORCED against `prds/tasked/` residence by the auto-tasker, so an unsatisfied `prdAfter:` is NOT a reason to keep a taskable prd staged — promote it and let the tasker sequence it. An unready (design-sketch / question-bearing) prd stays `prds/proposed/`.
4. **No collision / no duplicate** — confirm no item with the same `(umbrella, slug)` already rests in the destination pool or a terminal, and the work isn't already covered by a done item.
5. **Verdict** — emit ONE of:
   - **PROMOTE** — review passed, fresh, pool-ready, no collision. State the move the caller should make (`agent-runner promote <item>`, or the `git mv`).
   - **KEEP-STAGED** — a fixable gap that is NOT machine-enforced: a drifted premise, an open question (`needsAnswers`), a wrongly-set `humanOnly`, or a prd that is still a design sketch. (An unresolved `blockedBy` / `prdAfter:` is NOT such a gap — it is enforced, so it is a PROMOTE, not a keep-staged.) State the SPECIFIC gap so it can be resolved, then re-checked.
   - **DROP** — superseded / out-of-scope / duplicate. Route to the regime terminal (`tasks/cancelled/` / `prds/dropped/`) with the `reason:`, per the contract.

You WRITE nothing and you MOVE nothing — you surface the verdict; the human or the runner's `promote` verb performs the transition (and a DROP is its own runner-owned move to the terminal). Batch the verdicts when judging several staged items at once, ordered by leverage (what each promotion unblocks downstream).

> Why position is human-gated and runner-moved: placement is runner-deterministic on the way IN (the `originTrust` stamp + policy decide STAGING vs POOL); promotion OUT is the human's review-gate. The agent never sets the folder. See `work/protocol/WORK-CONTRACT.md` (staging → pool).
