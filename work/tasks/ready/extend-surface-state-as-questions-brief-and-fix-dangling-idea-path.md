## Why

The observation `needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21` was answered. The human's decision (Q1+Q4, resolve together): spin/keep a dedicated brief for the **surface-state-as-questions** generalization — a deterministic STATE surfacer (NOT the judgement `surface-questions` skill) that enumerates stuck lock-refs + their recorded reason into a question whose apply dispatches the EXISTING `requeue` verb (optional `--reset` = discard saved wip and rebuild from clean; default = continue-from-wip). Q2 folds into the same brief: the shared sidecar-keying architectural question is resolved for needs-attention (sliceable now) and gated for merge-questions (needs apply-primitive extension first).

**Correction to the observation:** the observation asserts `work/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md` DOES NOT EXIST. It actually exists at **`work/notes/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md`** (created 2026-06-18). The problem is a stale PATH cited in code and a done-task, from before the `work/notes/` folder taxonomy. So this task is (a) EXTEND the existing brief with the new material, and (b) fix the dangling path references — NOT create a new file (that would fork the artifact).

## Scope

### 1. Extend `work/notes/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md`

Add sections carrying the new material from the observation + answers, so the brief captures the surface-state-as-questions generalization end-to-end and is slice-ready for the needs-attention case:

- **Sharpen the surfacer classification.** The stuck-lock surfacer is a **deterministic STATE surfacer**, NOT the judgement `surface-questions` skill. The reason (gate-failed / rebase-conflict / prepare-failed / timeout / rejected review) is ALREADY recorded on the lock entry — nothing to "gather", no agent/model needed. Mechanical enumeration of stuck lock-refs → one question per stuck item, of the shape: `"<slug> is stuck: <reason>. requeue? reset-and-retry? drop? hold?"`.
- **Apply dispatches an EXISTING verb.** The apply rung invents no new action: it dispatches `requeue` (already the protocol verb per CONTEXT.md: "needs-attention → backlog; the defer-don't-finish verb"), with optional `--reset` for discard-wip-and-rebuild-from-clean vs the default continue-from-wip. (This is a small sharpening of the existing brief's "stuck→released via requeue/release" line — spell out `--reset`.)
- **Add the generalization section.** Three+ cases now share ONE shape — surface a thing needing a human decision → answer → apply dispatches the action via disposition:
  - `merge-questions` ← unmerged branches/PRs (state) → apply LANDS
  - `needs-attention` ← stuck lock-refs + reason (state) → apply REQUEUES [--reset]
  - `triage` (exists) ← observations → apply PROMOTES/DROPS
  - `surface` (exists) ← spec/judgement residue → apply EDITS body
  The sidecar question loop is emerging as the UNIVERSAL human-visible-outcome mechanism for runner state that no longer has a folder. The folder→lock-ref cutover removed the folder-native surface; the question loop is the candidate replacement.
- **Add the sidecar-keying architectural resolution (from Q2).** This is the shared architectural gate for the whole generalization:
  - **needs-attention: sliceable now.** A stuck item's slice body still rests in `backlog/` while claimed (only the transient STATUS left the folder in the cutover). `sidecar.ts` keys on `<type>-<slug>` (identity resolver), NOT folder path, so the sidecar CAN attach to the backlog body. No apply-primitive change needed.
  - **merge-questions: gated.** An unmerged branch may have NO `work/<slug>.md` body at all. `sidecar-apply.ts` `applyAtomic` currently REQUIRES `options.itemPath` and reads/writes the body there. So the apply primitive must be extended first to key to a lock-ref / branch identity with no body-file. **Sequence the merge-questions surface AFTER that apply extension.**
- **Add a "do not fold" note.** This is NOT part of the land-time-reverify brief (wighawag: "a different story, but you see the pattern") — it is its own signal, its own brief.

Keep the existing brief's `## Why it composes cleanly` and `## The one subtlety to get right` sections intact (they still apply — the stuck-clear apply is a tree-less TRANSITION on an already-held lock, not a fresh `acquire`).

### 2. Fix the dangling `work/ideas/…` path references

Search: `grep -rn 'work/ideas/advance-surfaces-and-self-clears'` currently finds hits in at least:
- `item-lock.ts` — the code comment cited by the observation (need to locate; grep against the actual sources)
- `work/tasks/done/cutover-needs-attention-becomes-lock-stuck-recovery-surface.md` lines 45 and 126

Update each to the actual path `work/notes/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md`. (The `done/` task is historical — updating the path there is fine, it is just a pointer fix, not a rewrite of the task.) After the fix, `grep -rn 'work/ideas/advance-surfaces-and-self-clears'` should return no hits outside the answered observation + its question sidecar (which are frozen history).

## Explicitly out of scope (do independently)

- **Adjacent cleanup #1 (Q3):** update `CONTEXT.md` (~lines 19/26 folder-model prose) and the `needs-attention.ts` header ("a folder you can ls") to the lock-`state: stuck` model. The human confirmed this is a standalone doc-sync task, low-risk text-only, may bundle with other stale needs-attention prose cleanup. Not part of this task — leave it for its own item.
- Actually SLICING the needs-attention surface-state-as-questions rung. That is the promote-to-PRD/slice step called out in the brief's `## Scope note`, which follows the substrate cutover and this brief-extension. Out of scope here.
- Actually SLICING the merge-questions surface. Gated on the apply-primitive extension (see Q2 resolution above). Out of scope here.

## Done when

- `work/notes/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md` carries the four additions above (state-vs-judgement sharpening, `requeue [--reset]` apply spelling, the four-case generalization, the Q2 sidecar-keying resolution + merge-questions sequencing gate).
- No path-drift `work/ideas/advance-surfaces-and-self-clears-…` references remain in live code or live docs (the `done/` task, `item-lock.ts` — anywhere `grep` still turns them up outside the frozen observation + its question sidecar).
- Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.
