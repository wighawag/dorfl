<!-- dorfl-sidecar: item=observation:observation-triage-re-fires-when-task-for-observation-already-exists-2026-06-22 type=observation slug=observation-triage-re-fires-when-task-for-observation-already-exists-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this observation — slice a task to fix the triage idempotency gap (observation triage re-fires every tick once a task for the observation already exists on main, reding CI forever), drop it, or just keep it as a signal?**

> The observation reports a concrete, reproducible CI-noise defect verified in this repo on 2026-06-22:
>
> - The `observationTriage: auto` rung promotes untriaged observations to new tasks, guarded by a create CAS on `work/tasks/todo/<slug>.md` not existing on `<arbiter>/main`.
> - For `obs:integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21`, the minted task already exists at `work/tasks/todo/integratelock-...-2026-06-21.md` (plus a matching question sidecar), proving prior successful triage.
> - The lifecycle gather (`src/lifecycle-gather.ts` → `src/lifecycle-pools.ts buildLifecyclePools`) still enumerates the observation as untriaged, so every tick re-runs the promote, the create CAS in `src/advancing-lock.ts:527` re-fails, and the leg exits 2.
> - The 'left unresolved for a retry' message is misleading: the state is terminal-by-existence, not a transient race — retry can never succeed until a human edits/deletes the observation.
>
> It is explicitly framed as an idempotency / CI-noise defect (no double-mint — the CAS correctly refuses), and sibling observations describe the same red-CI-noise pattern: `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md` and `work/notes/observations/advance-matrix-enumerates-held-locked-items-so-legs-fail-every-tick-2026-06-22.md` — there is a coherent cluster of 'benign-skip vs exit-2' triage decisions the operator is being trained to ignore.
>
> The item's '## The idea (NOT decided here)' section names a concrete fix shape (distinguish 'already-triaged-by-this-observation' from 'genuine concurrent create race'; either mark the observation `triaged:` per the existing convention in `build-slice-advance-may-waste-a-build-before-losing-at-inner-claim-2026-06-19.md`, or have the gather exclude observations whose minted task already exists) and the open weighings a human must settle (marker-in-frontmatter vs derived-from-task-existence; auto-mark vs human-mark; exit-code / skip semantics consistent with the sibling observations). `needsAnswers: false` and no pre-existing open-questions block — the only open judgement is this triage disposition.

_Suggested default: promote-slice — the observation is concrete, verified against current code and on-disk artefacts, sits in a coherent cluster of CI-noise defects, and already proposes a workable fix shape with clearly-scoped open weighings; slicing a task lets that fix-shape and its open weighings be settled in the normal task lifecycle (review + sidecar) rather than discarded._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
