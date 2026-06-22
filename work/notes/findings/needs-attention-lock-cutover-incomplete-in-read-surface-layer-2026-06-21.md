# The needs-attention lock cutover is INCOMPLETE: the write side moved to lock `state: stuck`, but folder-reading/writing code still lives in the read/surface layer

2026-06-21

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

## Open questions (do NOT guess; these are CODE decisions, not doc tidy)

1. Is `status`/`scan`'s needs-attention surface ACTUALLY reading lock refs now, or is it still calling `readNeedsAttentionItems` (the dead folder read)? Trace `status.ts`/`scan` -> which surface source they use. If they use the folder read, the human-visible-outcome gap is a LIVE BUG (status shows an empty/stale needs-attention list), not just a doc concern.
2. Is `resolveFromNeedsAttention` truly dead (delete it), or is a caller meant to exist (the resume/reverse path) that was lost in the cutover? `resume`/`returnToBacklog` should be checked for whether the reverse-of-stuck is now a lock amend (`stuck -> active`) with no folder move.
3. Should `readNeedsAttentionItems` + `ledger-read`'s `needsAttention` arm be RE-POINTED at the lock refs (so the surface reads `state: stuck` entries), or removed in favour of a lock-ref reader? This is the read-side completion of the cutover.

## Scope note

This is NOT the doc-drift tidy that was requested. The header/CONTEXT.md doc fixes already landed and are CORRECT about the INTENDED model. This finding is that the CODE has not finished matching that model on the read/surface side. The right next step is a TRACE of `status`/`scan`'s actual needs-attention source (question 1) -- that decides whether this is dead-code cleanup or a live surfacing bug. Likely its own slice/brief, and it directly substantiates the needs-attention-no-visible-outcome observation.
