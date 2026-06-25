<!-- dorfl-sidecar: item=observation:review-nits-slicing-protocol-doc-and-vocabulary-fix-2026-06-22 type=observation slug=review-nits-slicing-protocol-doc-and-vocabulary-fix-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this observation overall? It records three non-blocking Gate-2 nits from the now-done task 'slicing-protocol-doc-and-vocabulary-fix'. Since it was written (2026-06-22) the repo executed the slicing -> tasking clean-break rename: `slicing.ts` is now `tasking.ts` and `SLICING-PROTOCOL.md` is now `TASKING-PROTOCOL.md`, so every `file:line` reference in this observation is stale and finding 1's specifically-named pre-rename tokens are now gone. Do you want to (a) discharge/delete it as overtaken by the rename, (b) keep it open pending the per-finding answers below, or (c) mint a single small follow-up task from whatever residue survives?**

> Verified against current tree: `packages/dorfl/src/slicing.ts` no longer exists (renamed to `tasking.ts`); grep for the truly-stale tokens the observation named (`work/prd/`, `work/prd-sliced/`, `work/backlog/`, `work/pre-backlog/`, `to-slices`, `PRD` as a noun) returns ZERO hits in `tasking.ts`. The >25 surviving `work/prds/...|pre-backlog|tasked` hits are now the LIVE/current vocabulary, not stale. Dedicated rename observations already exist (e.g. `review-nits-rename-protocol-doc-slicing-to-tasking-2026-06-23`, `review-nits-rename-slicing-modules-and-symbols-to-tasking-2026-06-23`). A prior sidecar for this item was deleted to rebuild it under the new binary format (git adac3e8).

_Suggested default: Discharge/delete as largely overtaken by the slicing->tasking clean-break rename, EXCEPT carry forward only finding 2 (see its question) if it is still genuinely open._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Finding 1 (stale JSDoc/comments sweep): is this now closed by the slicing -> tasking rename, or is there residual stale comment vocabulary in `tasking.ts` still worth a sweep?**

> Original nit: the slice de-staled only the assembled prompt body + two `note(...)` messages, leaving >25 stale-path hits in comments of `slicing.ts`. Current reality: that file is renamed to `tasking.ts` and the specifically-named pre-rename tokens (`work/prd/`, `work/prd-sliced/`, `work/backlog/`, `to-slices`, `PRD` noun) are GONE; remaining `work/prds/ready/` / `pre-backlog` / `work/prds/tasked/` mentions are the current, correct vocabulary. The original line citations (54-82, 131-158, 322-329, 394, 457-471) no longer correspond.

_Suggested default: Closed — the clean-break rename overtook this nit; no separate sweep task needed._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Finding 2 (setup SKILL.md doc enumeration drift): `skills/setup/SKILL.md` still lists the propagated protocol docs as the old six (`WORK-CONTRACT.md, ADR-FORMAT.md, task-template.md, prd-template.md, CLAIM-PROTOCOL.md, REVIEW-PROTOCOL.md`) in three places and never names `SURFACE-PROTOCOL.md` or `TASKING-PROTOCOL.md`, both of which now ship in `work/protocol/`. Ratify the prose as intentionally descriptive/non-load-bearing, or mint a doc-touchpoint fix to add the two missing docs to the enumeration?**

> Confirmed STILL OPEN against current tree: grep of `skills/setup/SKILL.md` for `SURFACE-PROTOCOL|TASKING-PROTOCOL|SLICING-PROTOCOL` returns nothing (exit 1); lines 13/110/225 still enumerate the old set. `work/protocol/` actually contains WORK-CONTRACT, CLAIM-PROTOCOL, REVIEW-PROTOCOL, SURFACE-PROTOCOL, TASKING-PROTOCOL, ADR-FORMAT, task-template, prd-template, VERSION. Propagation is data-driven (the vendor step), so the live copy is correct; only the human-readable prose enumeration drifts. The finding's own doc names (SLICING-PROTOCOL) are themselves now stale -> TASKING-PROTOCOL.

_Suggested default: Ratify as descriptive prose, OR fold a one-line enumeration fix into the existing setup-skill doc-touchpoint work rather than minting a standalone task._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Finding 3 (prompt 'no git' vs doc's `git mv` surface conflict): is the intent settled that the tasker prompt's blanket 'Do NOT perform any git operations' wins and the runner (not the spawned agent) owns the prd `git mv` + the one-time trim, per TASKING-PROTOCOL §6's runner-path carve-out? If yes, ratify the prompt staying silent on trim+move; if no, does the prompt need to mention them?**

> Confirmed STILL PRESENT (renamed file): `packages/dorfl/src/tasking.ts:1300` emits 'Do NOT perform any git operations - do not stage, commit, push, or move any...'. `work/protocol/TASKING-PROTOCOL.md` §3b/§6 (lines 63-76) describes the one-time prd trim + `git mv work/prds/<src>/<slug>.md -> work/prds/tasked/<slug>.md` and EXPLICITLY carves it out: line 76 says when the runner spawns the agent it EDITS files only and 'the RUNNER owns every git-state transition ... Do not stage, commit, push, or move any files yourself.' So the doc already resolves the apparent conflict in the prompt's favour for the spawn path. The question is whether to record that as a deliberate decision (ADR/ratify) so a future reader is not confused.

_Suggested default: Ratify as already-resolved: the prompt's 'no git' wins for the spawned agent; the runner owns the trim + `git mv`, exactly as TASKING-PROTOCOL §6 line 76 states. No code/doc change needed._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
