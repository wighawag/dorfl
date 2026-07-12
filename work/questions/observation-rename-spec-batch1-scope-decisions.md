<!-- dorfl-sidecar: item=observation:rename-spec-batch1-scope-decisions type=observation slug=rename-spec-batch1-scope-decisions allAnswered=false -->

Item: [`observation:rename-spec-batch1-scope-decisions`](../notes/observations/rename-spec-batch1-scope-decisions.md)

## Q1

**Can this observation be closed as ratified now that batches 3 (rename-spec-config-and-intake) and 4 (rename-spec-remaining-src-modules-a/b/c) have all landed done, or does it still want an explicit reviewer/human ACK before archival?**

> The note asks the reviewer/human to ratify-or-reverse three scope calls: (1) touching key-literal call sites inside batch 1, (2) leaving PrdsLandIn for batch 3, (3) keeping close-job/ledger-read internal Spec* aliases for batch 4. Batches 3 and 4 are now in work/tasks/done, so decisions 2 and 3 are effectively vindicated by the fact that the follow-on batches landed green against the seam this observation drew. Decision 1's only consequence was that batch 1's diff was wider than the task's domain-note implied — no downstream breakage.

_Suggested default: Yes — close as ratified-by-history; the successor batches landing done is the ratification signal._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Should the domain-note miscue in the batch 1 prompt (the claim that 'every call site references keys, never raw strings, so renaming a folder should not re-touch call sites') be lifted into task-authoring guidance so future KEY-rename tasks don't understate their blast radius?**

> Decision 1 explicitly flags a tension between the task's domain note and the reality that renaming a WorkFolderKey union member IS a hard TS break at every literal call site. The observation resolved it correctly in-flight, but the underlying authoring pattern (conflating VALUE-flip with KEY-rename in the domain note) could recur in any future registry-key rename. A one-line lesson in the tasking/refactor guidance would prevent the next author from writing the same misleading note.

_Suggested default: Yes — capture as a small note under refactor/task-authoring guidance: 'renaming a keyed-union member re-touches every literal call site; only the VALUE flip is call-site-free.'_

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
