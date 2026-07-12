---
needsAnswers: true
---

# finish-in-progress-folder-cutover: diagnosis + decisions (2026-07-12)

Recorded by the build of `finish-in-progress-folder-cutover-remove-legacy-recovery-readers` so its cut/keep choices are discoverable (linked from the done record / PR body).

## Diagnosis (step 1): no code path writes `work/in-progress/`

Confirmed under `packages/dorfl/src/` (grep for real `git mv` / `writeFile` / `mkdir` INTO the folder, not prose/comments/log strings): NOTHING writes a body into `work/in-progress/`.

- Claim is a pure per-item-lock acquire; the body STAYS in `tasks/backlog/` (`claim-cas.ts` documents the interim `git mv backlog→in-progress` dual-write as GONE). Liveness is the held lock (`action: implement`, `state: active`), not a folder file.
- The only integration-core `git mv` is `work/<source>/<slug>.md → work/done/<slug>.md` — it moves OUT of a source folder, never INTO `in-progress/`.
- The four sites that pass `source: 'in-progress'` to the integration core (`intake.ts` ×2, `tasking.ts`, `recover-isolated.ts`) are INERT: the value is IGNORED because they set `lifecycle` (intake/tasking) or `committedRecovery: true` (recover-isolated), both of which bypass the step-2 `git mv`. They never produce a `work/in-progress/` file.

So the two named legacy READER arms could no longer fire in the normal flow, and are retired.

## What was removed

- `complete.ts`: the `onInProgress` FOLDER PROBE (`const inProgress = workItemPath(cwd,'in-progress',slug)` + `existsSync(inProgress)`) and its uses in the source-resolution chain, the `sourcePath` chain, and the `folderShapeStranded`/`onDone` branch-tree checks. The local `source` union narrowed to `'tasks-ready' | 'tasks-backlog' | 'done'`. The default/refusal branch is unchanged (falls to `'tasks-ready'`, whose absent file fires the existing "nothing to complete" `CompleteRefusal`).
- `start.ts`: the `'in-progress'` entry in `folderOnArbiterMain`'s probe array (the `cat-file -e work/in-progress/<slug>.md` read). The `--resume` decision now reaches `startFromInProgress` ONLY via `dispatchFolder`'s LOCK re-key (`lock.state === 'active' ⇒ 'in-progress'`), the live lock-based path. Stale "the decision is folder-based (WORK-CONTRACT rule 6)" doc/inline comments were corrected to say lock-based.

## Decisions (record, per the surprise bar)

1. **Kept `'in-progress'` in the shared `IntegrationCoreInput.source` union and the `WorkFolderKey` folder-map / resolution constants** (`work-layout.ts`, `item-path.ts`, `advance.ts`, `ledger-read.ts`, `prompt.ts`). WHY: those are NOT the two reader arms this task names, and four still-live sites pass `source: 'in-progress'` as an inert placeholder for a required field. Removing the member would force changing those placeholders (intake/tasking/recover), expanding scope into other commands. The inert-placeholder smell and the wider "retire the folder + its constants" cleanup are a separate, cheaper follow-up (the task's step 5 explicitly defers removing the folder itself). ALTERNATIVE considered: purge the union member now + repoint the 4 placeholders to `'tasks-ready'` — rejected as out-of-scope scope-creep touching other commands.

2. **Left `needs-attention` in `folderOnArbiterMain`'s probe array untouched.** It is also dead (that folder is likewise unwritten post-cutover), but `needs-attention/` handling is explicitly OUT of this task's scope ("that cutover already shipped in the parent task"). Retiring that probe belongs to its own follow-up.

3. **Retargeted the `gate-readiness.test.ts` fixture** (`onWorkBranchWithInProgress` → `onWorkBranchWithBody`) from `git mv`-into-`work/in-progress/` to the lock-based shape (body rests in `tasks/ready/`), so the same scenario (a live item hitting the gate-precondition refusal) is exercised through the surviving lock-based source resolution, not the removed arm. Assertions that checked `work/in-progress/alpha.md` exists were repointed to `tasks/ready/`.

## Docs / protocol (step 4)

No protocol edit needed. `skills/setup/protocol/WORK-CONTRACT.md` (and its byte-identical `work/protocol/` copy) already describe `in-progress` ONLY as a lock-ref STATE, explicitly "lock-ref state, not folders" — never as a location code writes to. `diff -r skills/setup/protocol work/protocol` is clean apart from the `VERSION` file that legitimately lives only in `work/protocol/`.

## Originating observation

`observation:in-progress-folder-also-appears-unwritten` (and its question sidecar) was ALREADY deleted by the advance commit that created this task (`c4c988b1`), so the acceptance criterion "the originating observation is deleted" is already satisfied — nothing left to delete.
