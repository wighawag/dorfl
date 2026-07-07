<!-- dorfl-sidecar: item=observation:observation-triage-re-fires-when-task-for-observation-already-exists-2026-06-22 type=observation slug=observation-triage-re-fires-when-task-for-observation-already-exists-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this signal? It documents a real idempotency / CI-noise defect: when an observation has ALREADY been triaged into a task, the triage create-CAS keeps re-losing to the existing task and exits 2 every tick (reds CI forever), because nothing marks the observation as already-triaged so it stays in the triage pool. Should it be promoted to a buildable task (its own fix), folded into the sibling CI-noise family, kept as a watched signal, or dropped?**

> work/notes/observations/observation-triage-re-fires-when-task-for-observation-already-exists-2026-06-22.md, needsAnswers: true, no sidecar yet. Claim verified against current reality: the create-CAS at packages/dorfl/src/advancing-lock.ts:544 returns kind:'lost' ('already exists on <arbiter>/main ... lost the create race (or the slug is taken). Back off.') whenever the target task path is already present, and the promote path maps that to 'left unresolved for a retry' — but the retry is terminal-by-existence, never resolves. The minting task DOES exist: work/tasks/ready/integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21.md (moved todo->ready), and the integratelock observation is now triaged:keep/triaged:promoted, confirming prior triage happened. This is DISTINCT from the already-landed benign-skip in work/tasks/done/observation-identity-is-its-filename-not-a-foreign-slug.md, which only skips an item that VANISHED between enumerate and run; here the observation still EXISTS but its minted task does, so the create-CAS loses forever. Two sibling CI-noise observations took the promote path (advance-leg-on-stale-snapshot -> work/tasks/ready/, advance-matrix-enumerates-held-locked -> still under triage with a sidecar).

_Suggested default: promote-task — the defect is real, narrow, mechanical (distinguish 'lost a genuine concurrent create race' from 'a task for this observation already exists' at the create-CAS step, and stop re-firing), and it sits in the same CI-noise family the operator is already promoting siblings of; the observation is well-scoped and provenance-rich enough to draft a buildable task._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Promote-task. The defect is real, narrow, and mechanical (distinguish "lost a genuine concurrent create race" from "a task for this observation already exists" at the create-CAS step, and stop re-firing exit 2 every tick), and it sits in the same CI-noise family whose siblings are already being promoted. Well-scoped and provenance-rich enough to draft a buildable task. The design sub-questions Q2-Q4 shape that task.

## Q2

**How should 'already triaged' be detected and recorded so the observation leaves the triage pool — by writing a `triaged:` marker into the observation frontmatter (the existing `triaged: keep`/`triaged: promoted` convention), or by deriving already-triaged-ness from the minted task's existence (slug derivation / a back-reference) at gather time?**

> The note flags this as undecided ('how the triage pool decides "already triaged" ... a marker written into the observation frontmatter ... vs deriving it from the minted task's existence'). The repo already uses a `triaged:` frontmatter marker convention widely (e.g. integratelock-...md has `triaged: keep` plus a `triaged: promoted` footer recording the 1:1 map), so a marker-based answer is consistent with existing machinery; deriving from task existence avoids a second write but needs a provable observation->task link. Note: the in-flight task work/tasks/tasked/observation-discharge-by-deletion-self-contained-promotion-and-prd-route.md is RETIRING the `triaged:` resting-state machinery in favour of discharge-by-deletion, so the chosen marker mechanism may need to be reconciled against that direction.

_Suggested default: Prefer deriving 'already triaged' from the minted task's existence (provable observation->task link) rather than adding more `triaged:` frontmatter, since the discharge-by-deletion task is actively retiring the `triaged:` resting-state convention — but this depends on the same human's intent for that task, so confirm rather than assume._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Derive "already triaged" from the minted task's existence (a provable observation->task link), rather than adding more `triaged:` frontmatter. The in-flight task `observation-discharge-by-deletion-self-contained-promotion-and-prd-route` is actively RETIRING the `triaged:` resting-state convention in favour of discharge-by-deletion, so a new marker mechanism would fight that direction. IMPORTANT: this task is dependent on / must be sequenced with that discharge-by-deletion work; the buildable task must state that dependency and reconcile against the final shape (once an observation is discharged-by-deletion after tasking, the source is simply gone and cannot re-fire, which may make the derivation trivial).

## Q3

**When a task for the observation already exists, should the observation be AUTO-marked/auto-resolved as already-triaged (so it silently drops out of the pool), or left for a human to confirm?**

> The note lists 'whether the observation should be auto-marked or left for a human' as an explicit open weigh-point. This touches the autonomy posture: observationTriage defaults to a quiet/ask state and the system's doctrine is 'never auto-promote/auto-delete a judgement call', but 'a task for THIS observation already exists' is arguably a no-judgement idempotency fact (the human already decided when they minted the task), which the conservative auto-disposition bar might cover.

_Suggested default: Auto-treat as already-triaged (benign skip, no human prompt) ONLY when the minting task is provably the one minted from this observation; this is an idempotency fact, not a judgement call, so it fits the conservative no-question auto-disposition bar._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Auto-treat as already-triaged (benign skip, no human prompt) ONLY when the minting task is provably the one minted from this observation. That is an idempotency fact (the human already decided when they minted the task), not a judgement call, so it fits the conservative no-question auto-disposition bar. Anything short of a provable link stays loud.

## Q4

**What exit-code / skip semantics should the leg use when it detects 'already triaged', and should they be made consistent with the sibling already-done / held-lock observations that also want a benign skip rather than exit 2?**

> The note asks for 'the exit-code/skip semantics (consistent with the sibling already-done / held-lock observations, which also want a benign skip rather than exit 2)'. The already-landed observation-identity slice established a 'benign skip' outcome shape (exit 0 / a distinct tolerated non-error outcome the matrix tolerates) for vanished legs; reusing that same outcome shape here (while keeping a LOUD failure for a genuine concurrent-create race where a retry actually helps) would keep the family consistent. src/advancing-lock.ts:544 currently has only the one 'lost'/back-off branch that cannot distinguish the two cases.

_Suggested default: Reuse the existing benign-skip outcome shape from the observation-identity slice (exit 0 / tolerated non-error) for the already-triaged case, and keep the loud exit-2 only for a genuine concurrent-create race (two ticks racing to mint the same new task), so the CI-noise family stays consistent._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Reuse the existing benign-skip outcome shape from the observation-identity slice (exit 0 / a tolerated non-error outcome the matrix accepts) for the already-triaged case, and keep the loud exit-2 only for a genuine concurrent-create race (two ticks racing to mint the same NEW task, where a retry actually helps). This keeps the CI-noise family consistent. src/advancing-lock.ts:544 currently has only the one 'lost'/back-off branch and must be taught to distinguish the two cases.
