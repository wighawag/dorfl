# The needs-attention lock cutover left DEAD folder-reading/writing code (NOT a live bug): `status` already reads lock refs; orphaned folder helpers + one stale comment remain

2026-06-21

RESOLVED (open question 1 traced): NOT a live surfacing bug. `status()` reads LOCK REFS and HARDCODES `needsAttention: []` (it never calls the folder readers). So the live surface is correct; the folder helpers are DEAD CODE. Details + corrected severity below; the original (more alarmed) framing is kept for the trail but superseded by the RESOLUTION section.

Discovered while attempting a "full internal consistency" pass on `needs-attention.ts` (after the doc-drift fixes that updated the file HEADER + CONTEXT.md to the lock model). Attempting to make the in-function comments match the lock-model header REVEALED that the inconsistency is in the CODE, not the comments: some needs-attention code is still folder-based. So the file is internally inconsistent because the cutover is half-done, NOT because comments drifted. Editing the comments to claim a complete cutover would make the docs LIE. Captured instead of edited (stop-and-ask, not guess).

## Verified state (grep + read, packages/agent-runner/src/)

WRITE side (correctly cut over):
- `routeToNeedsAttention` (+ its header, just doc-fixed): a bounce is a PURE LOCK AMEND via the seam (`bounceToStuckLock` -> `markStuckItemLock`), `state: active -> stuck`, reason/questions on the lock entry. NO `git mv`, NO on-`main` surface. Header + inner comments consistent. GOOD.
- `requeue` path (~L520): reads the LOCK ref ("stuck-state is the per-item lock `state: stuck`, NOT a `needs-attention/` folder file"). Consistent. GOOD.

READ / SURFACE side (NOT cut over):
- `resolveFromNeedsAttention` (~L1412): still does `git mv work/needs-attention/<slug>.md -> work/in-progress/<slug>.md` and commits a move-only transition. BUT it is DEAD CODE: grep shows NO caller anywhere (`grep -rn resolveFromNeedsAttention src/` matches only its own definition). Leftover from the pre-cutover folder model; the cutover replaced its callers but never deleted it.
- `readNeedsAttentionItems` (~L1449): STILL LIVE (re-exported via `index.ts:621`). It reads a `work/needs-attention/` FOLDER through `ledgerRead.resolveLocalState().needsAttention`. Its doc says it is "the 'look here' surface `status` renders."
- `ledger-read.ts`: still carries a whole folder-reading arm for needs-attention: `LedgerNeedsAttentionItem`, `needsAttention: LedgerNeedsAttentionItem[]`, "Read `work/needs-attention/*.md` (filename-sorted) from the local tree", `resolveLocalState({...}).needsAttention`. So the READ seam still surfaces a `work/needs-attention/` folder that the WRITE seam no longer populates.

## The contradiction this creates

The just-corrected `needs-attention.ts` header + CONTEXT.md now (correctly) say stuck is lock-`state: stuck` with NO `work/needs-attention/` folder and NO on-`main` surface, and that the human surface is `agent-runner status`/`scan` reading lock refs. But the LIVE `readNeedsAttentionItems` + `ledger-read`'s `needsAttention` arm still read a `work/needs-attention/` FOLDER as the "look here" surface. If the write side never writes that folder, this read path now surfaces NOTHING (or only stale pre-cutover files) -- which is EXACTLY the "needs-attention has no human-visible outcome" gap captured in `work/notes/observations/needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21.md`. This finding is the CODE-LEVEL ROOT of that observation: `status`'s needs-attention surface is reading a folder that is no longer populated.

## RESOLUTION (question 1 traced in `status.ts`)

`status()` (`status.ts` ~L244-L285) is EXPLICIT and already cut over:
- Comment L244: "The STUCK-STATE surface is now the PER-ITEM LOCK `state: stuck` ... the `needs-attention/` folder is RETIRED -- NO code reads `work/needs-attention/`. `status` reads the lock refs per mirror."
- It calls `listItemLockEntries(mirrorPath, 'origin', env)` and populates `lockHeld` (active + stuck entries + reasons/questions).
- The SMOKING GUN: `status()` returns `needsAttention: []` HARDCODED. It does NOT call `readNeedsAttentionItems`. The folder surface is empty by construction.

So the live surface is CORRECT and reads lock refs. Therefore:
1. **Not a live bug.** `status`/`scan` DO surface stuck items, via `lockHeld` from lock refs, exactly as the corrected docs say. (The UX point from the sibling observation still stands -- it is a COMMAND you run, not folder-native `ls` -- but the surface is present, not broken. This finding DOWNGRADES that observation's severity: the outcome is visible via `status`, just not via `ls`.)
2. **It IS dead code.** `resolveFromNeedsAttention` (no callers), `readNeedsAttentionItems` (exported via `index.ts` but the live `status` path bypasses it with `[]`), and `ledger-read`'s `needsAttention` folder arm are VESTIGIAL leftovers of the pre-cutover model.
3. **One stale COMMENT confirmed**: `status.ts` L86-L131 still carries `RepoNeedsAttention` types + "folder-native needs-attention surface" / "interim dual-write" comments describing a folder surface that `status()` now returns empty. Plus `readNeedsAttentionItems`'s own doc ("the 'look here' surface `status` renders") is now FALSE -- `status` renders `lockHeld`, not this.

## What this actually is (corrected scope)

A DEAD-CODE + STALE-COMMENT cleanup, NOT a bug and NOT the doc-drift tidy that was requested:
- DELETE (or deprecate) the orphaned folder readers/writers: `resolveFromNeedsAttention`, `readNeedsAttentionItems`, the `ledger-read` `needsAttention` arm, the `status.ts` `RepoNeedsAttention`/`needsAttention?` field + its "interim dual-write" comments.
- Confirm no OTHER live caller depends on the `needsAttention: []` field shape before removing it (it is `?optional` in the result type, so removal is low-risk, but check `formatStatus`/tests).
- This is a CODE change (a removal slice), so it does NOT belong in the doc-tidy pass. It is its own small slice/brief.

The needs-attention-no-visible-outcome observation is now better understood: the outcome IS surfaced (lock refs via `status`), the folder readers are just dead. The "surface stuck as questions" idea remains a genuine UX improvement on top of `status`, not a fix for a missing surface.

## Remaining (smaller) open question

- Is `resolveFromNeedsAttention` ROUTE meant to be replaced by a lock amend (`stuck -> active`) on `resume`, and does that lock-amend reverse path already exist elsewhere (so the folder version is simply deletable)? Check `resume`/`returnToBacklog` for the lock-amend reverse before deleting, to be sure the capability is not lost, only the folder implementation of it.
