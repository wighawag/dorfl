---
needsAnswers: true
---

# needs-attention has NO on-main human-visible outcome after the lock cutover (CONFIRMED in code); surface stuck items as questions whose apply requeues (optional --reset)

2026-06-21

UPDATE (same day): verified against the code. The ambiguity below is RESOLVED — CONTEXT.md is stale; the code has moved to lock `state: stuck` with NO on-`main` surface. The intended fix (surface-via-questions) is even REFERENCED in code, but its idea file is MISSING. Details inline.

## The noticed gap (the trigger)

Before the per-item-lock cutover, `needs-attention` was a FOLDER (`work/needs-attention/`) and the human-visible "look here" surface was just `ls`. The `ledger-status-per-item-lock-refs` work moved transient status to per-item LOCK REFS (`state: stuck`), specifically so a work branch cut from `main` inherits no transient marker (it dissolved the rename/rename rebase-conflict class). The trade (CONFIRMED in code, below): `main` no longer carries any visible record of a stuck item. The only surface left is `dorfl status` / `scan` reading the lock refs — a COMMAND a human must run, not something that lands in their face. So for a human not running `status`, a stuck item is effectively SILENT now. (Spotted by wighawag.)

## CONFIRMED in code (the doc-vs-state drift, resolved)

The stuck mechanism HAS moved to the per-item lock, and the code says so explicitly:
- `item-lock.ts`: `LockState = 'active' | 'stuck'`; `in-progress` = lock held active, `needs-attention` = lock held `stuck`; "a work branch cut from `main` inherits no lock state"; "the lock entry is the SOLE stuck record (slice `cutover-needs-attention-becomes-lock-stuck-recovery-surface`)".
- `ledger-write.ts`: `applyNeedsAttentionTransition` now does a `state: stuck` amend; "there is no `git mv` to `needs-attention/` and NOT an on-`main` surface"; "The OBSERVABLE half is now the per-item lock `state: stuck`."
So the human-visible-outcome loss is CONFIRMED BY THE CODE'S OWN COMMENTS: stuck is NOT surfaced on `main`; the only surface is `dorfl status`/`scan` reading lock refs (a command you must run).

DOC DRIFT (separate signal, also confirmed): CONTEXT.md is STALE — it still describes the OLD folder model: "needs-attention/ (stuck) ... Transitions are git mv" (line 19); "the post-claim stuck state (`work/needs-attention/`) ... the runner git mv's it here ... Folder-native surfacing (no labels)" (line 26). `needs-attention.ts`'s HEADER comment likewise still says "a folder you can `ls`" (legacy text). These contradict the lock-`state: stuck` reality in `item-lock.ts`/`ledger-write.ts`. CONTEXT.md (and the needs-attention.ts header) need updating to the lock model.

MISSING IDEA FILE (the gap is wider than expected): `item-lock.ts` REFERENCES `work/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md` as the place this surface-via-questions direction lives — but THAT FILE DOES NOT EXIST (`ls` = no such file). So the very idea wighawag re-derived here is cited in code as planned, yet is NOT actually captured anywhere. This observation is its de-facto capture until a proper idea/brief exists.

## The proposed shape (wighawag): same surface->answer->apply pattern as merge-questions

Make stuck items VISIBLE + RESOLVABLE through the advance sidecar loop, exactly like the merge-question idea (`work/notes/findings/advance-surface-apply-rungs-can-carry-merge-questions-for-unmerged-branches-2026-06-21.md`):

- SURFACE: a STATE surfacer (not the judgement `surface-questions` skill) enumerates stuck lock-refs and turns each + its already-recorded REASON into a question ("`<slug>` is stuck: <reason: gate-failed/rebase-conflict/prepare-failed/...>. requeue? reset-and-retry? drop? hold?"). Mechanical + deterministic (no agent/model needed) — the reason already lives on the lock entry.
- ANSWER: the human's decision (the visible outcome that is missing today).
- APPLY: dispatch the EXISTING action via disposition — `requeue` is ALREADY the protocol verb (CONTEXT.md: "needs-attention → backlog; the defer-don't-finish verb"). Optional `--reset` = discard the saved wip branch and rebuild from clean, vs the default continue-from-wip. So apply invents nothing; it dispatches `requeue [--reset]`.

## The generalization (why this matters beyond needs-attention)

Three+ cases now share ONE shape — surface a thing needing a human decision -> answer -> apply dispatches the action via disposition:
- merge-questions  <- unmerged branches/PRs (state)        -> apply LANDS
- needs-attention  <- stuck lock-refs + reason (state)      -> apply REQUEUES [--reset]
- triage (exists)  <- observations                         -> apply PROMOTES/DROPS
- surface (exists) <- spec/judgement residue               -> apply EDITS body
So the sidecar question loop is emerging as the UNIVERSAL human-visible-outcome mechanism for runner state that no longer has a folder. The folder→lock-ref move removed the folder-native surface; the question loop is the candidate replacement.

## The sharp distinctions (so this is not "make everything a question" overreach)

- A stuck item is OPERATIONAL FAILURE (gate red / conflict / prepare-failed / timeout / rejected review), NOT spec judgement. So it is a STATE surfacer (like merge-questions), NOT the `surface-questions` skill. The reason is already recorded; nothing to "gather."
- Apply dispatches the EXISTING `requeue` verb (+ optional `--reset`), not a new action.

## Open question to NOT guess (architectural, shared with merge-questions)

Can a sidecar attach to a LOCK-REF item (a stuck item with no `work/<slug>.md` body in a status folder), or does the sidecar mechanism (`sidecar-apply.ts` writes item-body + sidecar in one commit, keyed to an item PATH) assume a `work/` FILE to live beside? NOTE: a stuck item's body DOES still rest somewhere (the slice body stays in `backlog/` while claimed, per the cutover — only the transient STATUS left the folder), so a sidecar MAY be able to key to that body even though the stuck-ness is a lock ref. But merge-questions surface things (an unmerged branch) that may have NO `work/<slug>.md` body at all. So the sharper question: can the sidecar key to a LOCK REF / branch identity, not only an item file path? Resolve before either is sliced; it is the shared architectural question for the whole surface-state-as-questions generalization.

Not a fold into the land-time-reverify brief (wighawag: "a different story, but you see the pattern") — its own signal, likely its own brief. The doc-vs-state question is RESOLVED (lock `state: stuck`, no on-`main` surface, confirmed); what remains before slicing is the sidecar-keying architectural question above + deciding the surface/requeue UX. Adjacent cleanups this spawned (do independently): (1) update CONTEXT.md + the `needs-attention.ts` header to the lock model; (2) create the missing `work/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md` that `item-lock.ts` already cites (or fix the dangling reference).
