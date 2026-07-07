<!-- dorfl-sidecar: item=observation:in-progress-folder-also-appears-unwritten type=observation slug=in-progress-folder-also-appears-unwritten allAnswered=false -->

## Q1

**What becomes of this signal — does the repo want to act on the 'in-progress/ folder appears unwritten after the per-item-lock cutover' observation, and if so, how?**

> Observation at work/notes/observations/in-progress-folder-also-appears-unwritten.md (dated 2026-06-25, captured while finishing the now-done task `finish-needs-attention-folder-cutover-remove-legacy-recovery-readers`). The author reports that a grep for real writers into `work/in-progress/` (actual `git mv`/`writeFile`, not comments/log text) under `packages/dorfl/src/` returned only historical/prose hits — the per-item-lock cutover moved claim OFF writing `work/in-progress/`, and the body now rests in `work/tasks/backlog/`. They explicitly call out two surviving probes that may now be dead code if a deeper diagnosis confirms the signal:
>   - `complete.ts`'s `onInProgress` arm
>   - `start.ts`'s `--resume` folder-based decision
> The note was deliberately NOT acted on in the parent task (scope fence) and is filed as a follow-up candidate. No task/PRD currently tracks it; `work/tasks/` does not contain a matching item. The recent done task `finish-needs-attention-folder-cutover-remove-legacy-recovery-readers` shows the repo's precedent for retiring an unwritten lifecycle folder's reader probes in the same shape this observation proposes.
> The surface protocol's observation-triage question is the native one here: what becomes of this signal — mint a task to verify-and-retire the `in-progress/` folder probes (mirroring the needs-attention cutover), mint a PRD if the scope is larger than one task, fold into an existing item, or discard as already-known/won't-fix?

_Suggested default: Mint a small task to (a) confirm via deeper diagnosis that nothing writes `work/in-progress/` post per-item-lock cutover, and (b) if confirmed, retire `complete.ts`'s `onInProgress` arm and `start.ts`'s `--resume` folder-based decision, exactly as `finish-needs-attention-folder-cutover-remove-legacy-recovery-readers` did for `needs-attention/`. Then delete this observation._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Mint a small task mirroring the `finish-needs-attention-folder-cutover-remove-legacy-recovery-readers` precedent: (a) confirm via deeper diagnosis that nothing writes `work/in-progress/` after the per-item-lock cutover, and (b) if confirmed, retire `complete.ts`'s `onInProgress` arm and `start.ts`'s `--resume` folder-based decision. Then delete this observation.
