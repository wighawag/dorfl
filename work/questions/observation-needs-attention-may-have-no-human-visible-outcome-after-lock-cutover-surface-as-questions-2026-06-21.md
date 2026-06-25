<!-- dorfl-sidecar: item=observation:needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21 type=observation slug=needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21 allAnswered=false -->

## Q1

**What should become of this signal: spin it into its own brief/idea for the surface-state-as-questions generalization (surface stuck lock-refs as questions whose apply dispatches requeue [--reset]), keep it as a captured observation for now, or fold/drop it?**

> Observation (needsAnswers: true). The doc-vs-state ambiguity it opened with is RESOLVED and confirmed in code: item-lock.ts has LockState = 'active' | 'stuck' with the lock entry as the SOLE stuck record and 'a work branch cut from main inherits no lock state', and ledger-write.ts applyNeedsAttentionTransition does a state: stuck amend with 'no git mv to needs-attention/ ... NOT an on-main surface'. So a stuck item is silent on main; the only surface is `dorfl status`/`scan` (a command a human must run). wighawag's proposed shape: a deterministic STATE surfacer (not the judgement surface-questions skill) enumerates stuck lock-refs + their recorded reason into a question, answer = the human decision, apply dispatches the EXISTING requeue verb (optional --reset). wighawag flagged it as 'its own signal, likely its own brief', NOT a fold into the land-time-reverify brief.

_Suggested default: Spin a dedicated idea/brief for surface-state-as-questions (needs-attention requeue case), keeping this observation as its de-facto capture until that brief exists._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Can the advance sidecar mechanism key to a LOCK REF / branch identity (a stuck item with no work/<slug>.md body in a status folder), not only an item file PATH? Resolve before either the needs-attention or merge-questions surface-state direction is sliced, since it is the shared architectural question for the whole generalization.**

> Carried verbatim from the observation's '## Open question to NOT guess'. Partial evidence from code: sidecar.ts resolveSidecarIdentity already keys the sidecar on identity (<type>-<slug>), NOT folder path, and item-lock.ts uses that SAME resolver and anticipates rendering lock-entry questions into a work/questions/ sidecar (a stuck slice's body still rests in backlog/ while claimed, so a sidecar MAY key to that body). BUT sidecar-apply.ts applyAtomic still requires options.itemPath and reads/writes the item body there ('cannot read item body for <itemPath>'), so the merge-questions case (an unmerged branch with possibly NO work/<slug>.md body at all) is genuinely unresolved — the apply primitive currently assumes a file path to live beside.

_Suggested default: For needs-attention specifically the sidecar can likely key to the still-present backlog/ body via the identity resolver; the no-body branch-identity case (merge-questions) needs the apply primitive extended before it can be sliced._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Adjacent cleanup #1 (do independently): update CONTEXT.md and the needs-attention.ts header to the lock-`state: stuck` model — should this be tasked now as its own small fix?**

> Confirmed doc drift: CONTEXT.md still describes the OLD folder model ('needs-attention/ (stuck) ... Transitions are git mv' ~line 19; 'the post-claim stuck state (work/needs-attention/) ... the runner git mv's it here ... Folder-native surfacing' ~line 26), and needs-attention.ts's header still says 'a folder you can ls' (legacy text). Both contradict the lock-state: stuck reality in item-lock.ts/ledger-write.ts. The observation calls this a separate signal to do independently of the surface generalization.

_Suggested default: Yes, task it as a standalone doc-sync fix independent of the architectural surface question._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Adjacent cleanup #2 (do independently): item-lock.ts CITES work/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md as where the surface-via-questions direction lives, but that file DOES NOT EXIST. Should the missing idea file be created, or the dangling code reference fixed/removed?**

> Confirmed: `find work/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md` = no file; the path is referenced in item-lock.ts AND in work/tasks/done/cutover-needs-attention-becomes-lock-stuck-recovery-surface.md (lines 45, 126). So the idea wighawag re-derived in this observation is cited in code as 'planned' yet captured nowhere. Note: if cleanup #1's answer is to spin a dedicated brief, that brief likely IS the artifact this dangling reference should point to (resolve the two together to avoid a second dangling pointer).

_Suggested default: Create the missing idea file as the captured artifact for the surface-state-as-questions direction (ideally the same brief from the triage answer above), so item-lock.ts's reference resolves._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
