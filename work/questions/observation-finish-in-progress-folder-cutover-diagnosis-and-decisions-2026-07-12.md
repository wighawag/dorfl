<!-- dorfl-sidecar: item=observation:finish-in-progress-folder-cutover-diagnosis-and-decisions-2026-07-12 type=observation slug=finish-in-progress-folder-cutover-diagnosis-and-decisions-2026-07-12 allAnswered=false -->

Item: [`observation:finish-in-progress-folder-cutover-diagnosis-and-decisions-2026-07-12`](../notes/observations/finish-in-progress-folder-cutover-diagnosis-and-decisions-2026-07-12.md)

## Q1

**What becomes of this observation — is it a historical decision record that should stay as-is (linked from the shipped task), or should its two named follow-ups be minted as tasks (and if so, which) before it is retired?**

> work/notes/observations/finish-in-progress-folder-cutover-diagnosis-and-decisions-2026-07-12.md is a diagnosis+decisions memo recorded by the build of the now-done task finish-in-progress-folder-cutover-remove-legacy-recovery-readers (in work/tasks/done/). It names two explicitly-deferred follow-ups: (1) purge the 'in-progress' member from IntegrationCoreInput.source union + WorkFolderKey and repoint the 4 inert-placeholder call sites (intake x2, tasking, recover-isolated) to 'tasks-ready', as part of retiring the folder + its constants (task step 5); (2) retire the dead 'needs-attention' probe in start.ts folderOnArbiterMain (parent-task cutover already shipped). Docs/protocol were checked and no edit was needed. Originating observation was already deleted in c4c988b1.

_Suggested default: Keep as historical record linked from the done task; mint the two named follow-ups as their own tasks (retire-in-progress-folder-and-union-member and retire-needs-attention-probe-in-folderOnArbiterMain) and then delete this observation once those tasks exist._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Mint the two named follow-ups as their own tasks, keep this note as their linked provenance, then delete it once those tasks exist. The two deferred follow-ups are real code-debt: (1) retire-in-progress-folder-and-union-member (purge the 'in-progress' member from IntegrationCoreInput.source union + WorkFolderKey and the repo layout), and (2) retire-needs-attention-probe-in-folderOnArbiterMain. They are legitimate standalone slices; this diagnosis memo is their provenance and can retire once they are tracked.

## Q2

**Your answer says to mint TWO follow-up tasks (retire-in-progress-folder-and-union-member, and retire-needs-attention-probe-in-folderOnArbiterMain), then retire this note. But this decision step can emit only ONE outcome per cycle. Pick one: (A) Mint them as ONE combined task (e.g. `retire-post-cutover-dead-folder-probes`) covering both retirements as sibling sections — cheaper, one PR, and they share the same underlying rationale (dead post-cutover residue). (B) Mint task #1 (`retire-in-progress-folder-and-union-member`) this cycle, and I re-surface this observation on the next advance to mint task #2 (`retire-needs-attention-probe-in-folderOnArbiterMain`) — keeps them as separate slices per your literal answer, at the cost of two advance cycles before this note can be deleted. (C) Same as (B) but reversed order (mint the `needs-attention` probe retirement first because it is the smaller/more isolated slice, then the union+folder purge). Which — A, B, or C?**

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
