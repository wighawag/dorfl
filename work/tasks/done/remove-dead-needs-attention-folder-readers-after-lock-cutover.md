---
title: 'Remove the dead folder-based needs-attention readers/writers left by the lock cutover'
slug: remove-dead-needs-attention-folder-readers-after-lock-cutover
blockedBy: []
covers: []
---

## What to build

Retire the vestigial `work/needs-attention/` FOLDER-based code that the per-item-lock cutover (`ledger-status-per-item-lock-refs`, slice `cutover-needs-attention-becomes-lock-stuck-recovery-surface`) orphaned but never cleaned up. The stuck-state surface is now the per-item lock `state: stuck`, and the LIVE `status()` already reads lock refs and returns `needsAttention: []` hardcoded. Bring the module's code in line with its (already-corrected) header + `CONTEXT.md` by removing the folder readers/writers that are genuinely dead and reconciling the rest. NOTE this is partly a judgment call, not a uniform deletion (see the per-item notes); the title says "dead" as shorthand, but one piece is a keep-or-cut DECISION and one is a same-name COLLISION to avoid.

LINE NUMBERS in this task are ORIENTATION ONLY and likely stale (the repo changes under you); always locate code by SYMBOL, not by the `~Lnnn` hints.

This is mostly a dead-code + stale-comment cleanup. NO behaviour change to the live stuck surface: `status`/`scan` already surface stuck items via the lock refs (`lockHeld`), and the reverse-of-stuck capability already lives in `resumeItemLock` (`[action, stuck] -> [action, active]`), so nothing user-facing is lost. BUT it is NOT a uniform "grep and delete": one piece is genuinely dead, one is kept alive by tombstone TESTS (a decision, not a deletion), and there is a same-name FIELD COLLISION you must not trip over. Read the per-item notes below carefully.

Verified scope (see `work/notes/findings/needs-attention-lock-cutover-incomplete-in-read-surface-layer-2026-06-21.md`; RE-VERIFY against current code, it may have drifted):
- `resolveFromNeedsAttention` (in `needs-attention.ts`): does `git mv work/needs-attention/ -> work/in-progress/`; has ZERO callers in src AND test (verified); its capability is covered by `resumeItemLock`. GENUINELY DEAD -> DELETE (plus its options/result types if unused elsewhere).
- `readNeedsAttentionItems` (in `needs-attention.ts`, re-exported via `index.ts`): reads the `work/needs-attention/` folder; `status()` bypasses it with `needsAttention: []`, so it is dead in PRODUCTION. HOWEVER it is NOT orphaned: at least FOUR tests intentionally keep it as a TOMBSTONE that asserts it returns `[]` ("the folder is retired / gone"): `needs-attention.test.ts` (~L219), `ledger-write.test.ts` (~L365), `ledger-read.test.ts` (~L206-215), and it is imported in `complete-needs-attention.test.ts`. So this is a DECISION, not a mechanical delete: EITHER (a) delete the function + de-export from `index.ts` + delete/retarget those tombstone tests, OR (b) KEEP it as an intentional retired-folder reader (rename/comment it as a tombstone) so the tests still guard "the folder stays empty." Pick one, JUSTIFY it in the done record. Default recommendation: (a) delete, since the lock-ref surface is the real guard now, but the agent may choose (b) if it judges the empty-folder regression guard still valuable.
- `ledger-read.ts`'s needs-attention folder arm (`LedgerNeedsAttentionItem`, the `needsAttention` field on the LOCAL-STATE result, `readLocalNeedsAttention`): only removable if NOTHING live still reads it. After (a/b) above, check its consumers. **CRITICAL NAME-COLLISION WARNING:** `run.ts` ALSO has a field named `needsAttention` (on `RunOnceResult`/the tick aggregate, ~L208/L1376) -- it is a per-run OUTCOME COUNTER derived from tick `ItemStatus` (`items.filter(... routed-to-needs-attention ...)`, ~L433), TOTALLY UNRELATED to `ledger-read`'s folder field. Do NOT touch `run.ts`'s `needsAttention`, and do NOT treat `run.ts` as a consumer of the folder arm. The folder arm's only real readers are `readNeedsAttentionItems` + `resolveLocalState`'s assembly; once (a) lands, confirm the arm is dead and remove ONLY `ledger-read`'s folder pieces.
- `status.ts`'s folder-surface remnants: the `RepoNeedsAttention` type, the optional `needsAttention?` field on the status result (always `[]` now, ~L284), and the "folder-native needs-attention surface" / "interim dual-write" comments. Remove the always-empty field + its formatting, after confirming `formatStatus` + any status test does not assert on it (retarget those to `lockHeld` if they do). The lock-ref `lockHeld` surface is UNTOUCHED.
- Any other `work/needs-attention/` / `work/in-progress/` folder references in `needs-attention.ts` that describe the retired folder model in LIVE (non-historical) prose: reconcile to the lock model. Leave the deliberately-historical "there is NO `git mv` to needs-attention/" negative framing as-is (it is correct).

## Acceptance criteria

- [ ] `resolveFromNeedsAttention` (+ its now-unused option/result types) is removed; verified ZERO callers existed (src + test) and none is introduced.
- [ ] A DECISION on `readNeedsAttentionItems` is made and JUSTIFIED in the done record: either (a) deleted + de-exported from `index.ts` + its tombstone tests deleted/retargeted, or (b) explicitly KEPT as a documented retired-folder tombstone with its tests intact. Not left ambiguous.
- [ ] The same-name field collision is respected: `run.ts`'s `needsAttention` (the per-run outcome COUNTER) is UNTOUCHED and was never treated as a folder-arm consumer. (A diff of `run.ts` shows no change to its `needsAttention` logic.)
- [ ] The `ledger-read.ts` FOLDER arm (`LedgerNeedsAttentionItem` + the local-state `needsAttention` field + `readLocalNeedsAttention`) is removed ONLY after its consumers are confirmed dead (post the `readNeedsAttentionItems` decision); if any live consumer remains, it is documented and removal is scoped to the genuinely-dead parts (state which, and why).
- [ ] `status.ts`'s always-empty `needsAttention` field + `RepoNeedsAttention` type + the "folder-native" / "interim dual-write" comments are removed; `formatStatus` and status tests are retargeted to `lockHeld` if they asserted on the old field; the lock-ref `lockHeld` surface behaviour is unchanged.
- [ ] No LIVE folder-read/write code for `work/needs-attention/` remains in `packages/dorfl/src/`. (Use `grep -rn "work/needs-attention" packages/dorfl/src/` as a GUIDE, not a strict pass/fail: deliberately-HISTORICAL references are FINE and must be kept -- negative "no git mv to needs-attention/" framing, ADR-§12 "original folder model" citations. Do NOT delete correct historical comments just to empty the grep.)
- [ ] No behaviour change to the stuck surface: `dorfl status` still lists stuck items (from lock refs); a test asserts a stuck item appears in the lock-ref (`lockHeld`) surface (extend an existing status test rather than inventing a new harness).
- [ ] Tests are green and meaningful: any test that asserted the folder surface is either deleted (if its subject was deleted) or retargeted to the lock-ref surface; no test is left asserting on a removed symbol.
- [ ] The `readNeedsAttentionItems` keep-or-cut decision (and any other non-obvious in-scope choice) is recorded as a `## Decisions` line in the done record / PR description (it is below the ADR bar -- reversible, unsurprising -- so a note suffices, not an ADR).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green (run `pnpm format` first, not `format:check`).

## Blocked by

- None, can start immediately.

## Prompt

> You are removing DEAD code left behind by a completed migration. The per-item-lock cutover (`ledger-status-per-item-lock-refs`, slice `cutover-needs-attention-becomes-lock-stuck-recovery-surface`) moved the "stuck / needs-attention" state OFF a `work/needs-attention/` folder and ONTO a per-item lock ref (`refs/dorfl/lock/<entry>`, `state: stuck`). The WRITE side and the live `status()` READ side are already cut over; what remains is orphaned folder-based read/write code and stale comments. Your job is to delete the dead code so the module matches its already-correct header and `CONTEXT.md`. This is NOT a redesign and NOT a behaviour change.
>
> READ FIRST (your verified brief): `work/notes/findings/needs-attention-lock-cutover-incomplete-in-read-surface-layer-2026-06-21.md` lists exactly what is dead and why, with line-area references. Also skim `work/notes/observations/needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21.md` for context (the stuck surface is now `dorfl status` reading lock refs, a command you run, not folder-native `ls`).
>
> GROUND TRUTH to confirm before deleting (do not trust this file's snapshot blindly, it may have drifted):
> - `status.ts` `status()` returns `needsAttention: []` hardcoded and reads lock refs via `listItemLockEntries` into `lockHeld`. Confirm this still holds.
> - `resolveFromNeedsAttention` has no callers (`grep -rn resolveFromNeedsAttention packages/dorfl/src/`); the reverse-of-stuck capability lives in `resumeItemLock` (`item-lock.ts`, transition `[action, stuck] -> [action, active]`). Confirm before deleting, so the capability is provably not lost, only its dead folder implementation.
> - `readNeedsAttentionItems` is re-exported in `index.ts` but the live `status` path does not use it. Confirm no other live consumer.
> - The `ledger-read.ts` `needsAttention` arm: confirm whether ANY live caller still reads it after the above removals; remove only the genuinely-dead parts and state your finding either way.
>
> WHERE TO LOOK (by concept, not brittle paths): the needs-attention mechanism module (`needs-attention.ts`), the lock state machine + `resumeItemLock` (`item-lock.ts`), the local-state read seam (`ledger-read.ts`), the status dashboard (`status.ts`), the public export surface (`index.ts`). The seam to test at: `status()`'s output (a stuck item should appear in the lock-ref surface), reusing the existing status test fixtures.
>
> WHAT "DONE" MEANS: the dead folder readers/writers and their stale comments are gone; `grep -rn "work/needs-attention" packages/dorfl/src/` shows only deliberately-historical references; `status` still surfaces stuck items from lock refs (proven by a test); `pnpm -r build && pnpm -r test && pnpm format:check` is green; and `pnpm format` was run (not `format:check` first).
>
> CRITICAL NAME-COLLISION (the single most likely way this task goes wrong): there are TWO unrelated things called `needsAttention`. (1) `ledger-read.ts`'s FOLDER arm (`LedgerNeedsAttentionItem` / the local-state `needsAttention` field / `readLocalNeedsAttention`) -- the dead folder reader you are removing. (2) `run.ts`'s `needsAttention` -- a per-run OUTCOME COUNTER (how many items this run routed to needs-attention, `items.filter(...)` mapped from tick `ItemStatus`). These share ONLY the name. DO NOT touch `run.ts`'s `needsAttention`; it is live and correct. A `grep`-and-delete that conflates them will break `run`'s reporting. Verify each `needsAttention` hit's MEANING before touching it.
>
> `readNeedsAttentionItems` is a DECISION, not a mechanical delete: it is dead in production (`status` returns `[]`) but FOUR tests keep it alive as a tombstone asserting "the folder is retired (returns [])". Either delete it AND its tombstone tests, or keep it as an intentional documented tombstone. Make the call, JUSTIFY it in the done record. `resolveFromNeedsAttention`, by contrast, is genuinely dead (zero callers incl. tests) -- delete it outright.
>
> RECORD non-obvious in-scope decisions. If you find a folder consumer that is NOT obviously dead (so removing it WOULD change behaviour), do NOT force the deletion: STOP and route to needs-attention with the specific consumer as the reason, because that would mean the cutover is less complete than this task assumes (a drifted premise). If you keep a borderline piece, note WHY in the done record. An un-recorded keep/cut decision is a review finding, not a silent default.
>
> No em dashes anywhere (prose, comments, commit messages). Do no git yourself if you are a dispatched build agent; the runner owns claim/commit/integration.

---

### Claiming this task

```sh
dorfl claim remove-dead-needs-attention-folder-readers-after-lock-cutover --arbiter origin
git fetch origin && git switch -c work/remove-dead-needs-attention-folder-readers-after-lock-cutover origin/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/todo/remove-dead-needs-attention-folder-readers-after-lock-cutover.md work/tasks/done/remove-dead-needs-attention-folder-readers-after-lock-cutover.md
```
