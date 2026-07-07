# Finish in-progress/ folder cutover — remove legacy recovery readers

Mirror the precedent set by `finish-needs-attention-folder-cutover-remove-legacy-recovery-readers`: after the per-item-lock cutover, `work/in-progress/` appears to no longer be written by any code path. Confirm this, then retire the last folder-based readers.

## Background

A 2026-06-25 grep under `packages/dorfl/src/` for real writers into `work/in-progress/` (actual `git mv` / `writeFile` INTO that folder, not comments or log strings) returned only historical/prose hits. The per-item-lock cutover moved claim OFF writing `work/in-progress/`; task bodies now rest in `work/tasks/backlog/` with liveness expressed via the per-item lock, not folder location.

The parent task deliberately fenced this out of scope, so it lives here as its own task.

## Scope

1. **Diagnose (confirm the observation).** Under `packages/dorfl/src/`, verify there is no remaining code path that writes into `work/in-progress/` — i.e. no `git mv` into it, no `writeFile`/`mkdir` that lands a body there, no move-on-claim / move-on-start behavior. Prose, comments, historical log strings, and test fixtures that only READ the name don't count. Record what you found (even a one-paragraph note in the task's done-writeup is fine) so the retirement is grounded, not assumed.

2. **If confirmed, retire the legacy readers.** Specifically the two call-outs from the parent task's scope fence:
   - `complete.ts`'s `onInProgress` arm — the branch that handles "body is in `work/in-progress/`" during completion.
   - `start.ts`'s `--resume` folder-based decision — the branch that decides resume behavior by checking whether the body sits in `work/in-progress/`.
   Remove these arms (and any now-dead helpers/types they were the sole caller of). Keep the remaining, lock-based paths as the single source of truth for "is this item live?".

3. **Tests.** Update or delete tests that asserted the folder-based behavior; add/adjust coverage so the lock-based path is what's exercised for the same scenarios (completion of a live item, `--resume` of a live item). Do not leave tests that only pass because the retired arm is still present.

4. **Docs / protocol.** If any doc under `skills/setup/protocol/` or `work/protocol/` still describes `work/in-progress/` as a location code writes to, update it — and remember the source-of-truth rule from `AGENTS.md`: edit `skills/setup/protocol/` and mirror byte-identically into `work/protocol/`. If no such doc text exists, say so in the writeup; don't invent edits.

5. **Do NOT** delete the `work/in-progress/` directory itself as part of this task unless the diagnosis in step 1 also shows nothing READS it for legitimate reasons (e.g. tooling, gitignore anchoring). Removing the folder is a separate, cheaper follow-up if wanted.

## Out of scope

- Revisiting the per-item-lock design itself.
- Any changes to `needs-attention/` handling — that cutover already shipped in the parent task.
- Renaming or restructuring `work/tasks/backlog/`.

## Acceptance

- Diagnosis note recorded (in the task writeup or a short findings file) showing no writers into `work/in-progress/` remain, OR — if writers ARE found — this task pivots to "document why they must stay" and closes without the removals.
- Assuming confirmation: `complete.ts`'s `onInProgress` arm and `start.ts`'s `--resume` folder-based decision are gone, along with any code that existed solely to serve them.
- Tests updated; `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- The originating observation (`observation:in-progress-folder-also-appears-unwritten`) is deleted as part of the follow-up chain (this task supersedes it).
