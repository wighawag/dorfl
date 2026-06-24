<!-- dorfl-sidecar: item=observation:stale-work-observations-path-in-log-and-jsdoc-after-notes-taxonomy-reorg-2026-06-24 type=observation slug=stale-work-observations-path-in-log-and-jsdoc-after-notes-taxonomy-reorg-2026-06-24 allAnswered=false -->

## Q1

**What becomes of this observation — fix the misleading runtime log line at packages/dorfl/src/integration-core.ts:2042 and sweep the ~30 stale `work/observations/` JSDoc/comment paths to `work/notes/observations/`?**

> Verified: `grep -n 'work/observations' packages/dorfl/src/integration-core.ts` shows the log site at L2042 (`in work/observations/${filename}.`) — the WRITE goes via `workFolderPath(cwd, 'observations')` (correctly → `work/notes/observations/`) but the printed path is the old short form. `grep -rln 'work/observations' packages/dorfl/src/` lists 14 files (integration-core, ledger-read, lifecycle-pools, lifecycle-gather, triage-persist, registry, failure-cause, needs-attention, run, mirror-pool-scan, session-path, tasking, tasking-lock, advance-isolated) — JSDoc/comment residue of the `notes/` taxonomy reorg. The canonical layout is confirmed (`work-layout.ts` resolves `observations: 'notes/observations'`). The related PRD `work/prds/tasked/folder-taxonomy-reorg-and-rename.md` exists and is still tasked — the observation itself proposes folding the sweep into that PRD's follow-up rather than minting a standalone task. Concrete impact already demonstrated: a prior agent on this PRD wrote a note into the stray top-level `work/observations/` (relocated as ad50a56).

_Suggested default: promote-task — small, mechanical, two-part fix (log line + comment sweep). Either mint a fresh task or, as the note suggests, fold into the existing `folder-taxonomy-reorg-and-rename` PRD's follow-up so the comment-residue tail ships with the rest of the reorg._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
