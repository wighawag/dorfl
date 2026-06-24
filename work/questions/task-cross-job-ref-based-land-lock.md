<!-- dorfl-sidecar: item=task:cross-job-ref-based-land-lock type=task slug=cross-job-ref-based-land-lock allAnswered=false -->

## Q1

**Stale-lock reclaim mechanism: which of (a) TTL encoded in the lock-ref's value with a wall-clock check, (b) a holder-liveness check (and against what signal — the per-item lock model explicitly has no heartbeat), or (c) a human-only reclaim verb (`release-lock`-style) that refuses to ship without admin opt-in? Pick one and justify.**

> Open questions #1 in work/tasks/backlog/cross-job-ref-based-land-lock.md. A ref-lock held by a crashed job must be reclaimable, or it becomes a self-inflicted deadlock strictly worse than the floor's spurious bounce. The prd's Applied Answer q1 conditions shipping this slice on a SOUND, cheap reclaim story.

_Suggested default: (a) TTL-in-value with wall-clock check — simplest, no extra signal, degrades cleanly to the mergeRetries floor; pair with a conservative TTL (e.g. 2× expected land tail) so reclaim is only ever triggered for a clearly-dead holder._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**In-scope-now vs follow-on: given the answer to the reclaim question, is this slice cheap enough to ship inside the `land-time-reverify-and-parallel-merge-ceiling` prd, or should it be split into a follow-on prd and this task cancelled?**

> Open questions #2. The prd (Applied Answer q1) explicitly allows splitting this slice out if reclaim is not cheap. Decision gates whether this task proceeds at all.

_Suggested default: Ship in-scope only if the reclaim answer is (a) TTL-in-value; if (b) or (c) is chosen, split into a follow-on prd and cancel this task — keep this prd anchored on the mergeRetries floor._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Lock granularity: one global land-lock per repo, or per-target-branch?**

> Open questions #3. Per-repo is simpler; per-branch matches future multi-branch land flows. Affects the ref name shape (e.g. `refs/dorfl/land-lock` vs `refs/dorfl/land-lock/<branch>`) and contention profile.

_Suggested default: Per-target-branch — same implementation cost (just key the ref by branch) and future-proofs for multi-branch land; per-repo is a strict subset when only one branch is targeted._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
