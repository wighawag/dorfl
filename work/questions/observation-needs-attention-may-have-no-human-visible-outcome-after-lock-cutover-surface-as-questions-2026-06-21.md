<!-- agent-runner-sidecar: item=observation:needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21 type=observation slug=needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21 allAnswered=false -->

## Q1

**Triage disposition for this observation: the doc-vs-state half is RESOLVED in code (lock `state: stuck`, no on-`main` surface) and the body says the surface-via-questions direction is 'likely its own brief, not a fold' into land-time-reverify — but it ALSO flags a shared architectural prereq (can a sidecar key to a lock-ref / branch identity, not only an item file path?) that must resolve before slicing. Promote now to a slice/idea, or KEEP as an observation until the sidecar-keying question is answered (so the slice can be shaped correctly), or fold/drop?**

> Observation confirms in code that needs-attention lost its on-`main` human-visible surface after the per-item-lock cutover; proposes a state-surfacer + answer + apply-dispatches-`requeue [--reset]` shape mirroring merge-questions; notes the missing idea file `work/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md` that `item-lock.ts` already cites; explicitly defers slicing on the shared sidecar-keying architectural question.

_Suggested default: keep — the sidecar-keying architectural question is shared with merge-questions and should resolve before this is sliced; meanwhile this observation is the de-facto capture of the missing idea file_

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

## Q2

**Shared architectural prereq: can the advance sidecar mechanism (`sidecar-apply.ts`, which today writes item-body + sidecar in one commit keyed to an item PATH) attach to a LOCK-REF / branch identity rather than only to a `work/<slug>.md` file path? A stuck item's body still rests in `backlog/` (only transient status left the folder), so keying to that body MAY work for needs-attention; but the sibling merge-questions case surfaces unmerged branches that may have NO `work/<slug>.md` at all, so a path-only keying is insufficient for the generalization.**

> Called out in the observation as the gating question shared with the merge-questions idea (`advance-surface-apply-rungs-can-carry-merge-questions-for-unmerged-branches-2026-06-21`); the answer determines whether needs-attention and merge-questions can be sliced as one generalized surface-state-as-questions mechanism or must each invent their own keying.

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Adjacent cleanups spawned by this observation — handle as part of this item's eventual slice, or split out NOW as independent tiny chores? (a) CONTEXT.md still describes the OLD folder model (`needs-attention/ (stuck) ... Transitions are git mv`) and contradicts `item-lock.ts`/`ledger-write.ts`; (b) `needs-attention.ts` header comment still says 'a folder you can `ls`'; (c) `item-lock.ts` cites `work/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md` but that file DOES NOT EXIST (dangling reference).**

> The observation explicitly labels these as 'Adjacent cleanups this spawned (do independently)'. Splitting them out unblocks doc-truth immediately regardless of when the surface-via-questions slice happens; folding them in couples cheap doc fixes to the architectural-prereq wait.

_Suggested default: split out as independent chores — they are doc/reference fixes whose correctness does not depend on the sidecar-keying resolution_

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
