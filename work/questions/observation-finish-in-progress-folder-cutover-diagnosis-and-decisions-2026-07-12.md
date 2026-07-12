<!-- dorfl-sidecar: item=observation:finish-in-progress-folder-cutover-diagnosis-and-decisions-2026-07-12 type=observation slug=finish-in-progress-folder-cutover-diagnosis-and-decisions-2026-07-12 allAnswered=false -->

Item: [`observation:finish-in-progress-folder-cutover-diagnosis-and-decisions-2026-07-12`](../notes/observations/finish-in-progress-folder-cutover-diagnosis-and-decisions-2026-07-12.md)

## Q1

**What becomes of this observation — is it a historical decision record that should stay as-is (linked from the shipped task), or should its two named follow-ups be minted as tasks (and if so, which) before it is retired?**

> work/notes/observations/finish-in-progress-folder-cutover-diagnosis-and-decisions-2026-07-12.md is a diagnosis+decisions memo recorded by the build of the now-done task finish-in-progress-folder-cutover-remove-legacy-recovery-readers (in work/tasks/done/). It names two explicitly-deferred follow-ups: (1) purge the 'in-progress' member from IntegrationCoreInput.source union + WorkFolderKey and repoint the 4 inert-placeholder call sites (intake x2, tasking, recover-isolated) to 'tasks-ready', as part of retiring the folder + its constants (task step 5); (2) retire the dead 'needs-attention' probe in start.ts folderOnArbiterMain (parent-task cutover already shipped). Docs/protocol were checked and no edit was needed. Originating observation was already deleted in c4c988b1.

_Suggested default: Keep as historical record linked from the done task; mint the two named follow-ups as their own tasks (retire-in-progress-folder-and-union-member and retire-needs-attention-probe-in-folderOnArbiterMain) and then delete this observation once those tasks exist._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
