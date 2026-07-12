<!-- dorfl-sidecar: item=observation:spec-migrate-4c-scope-decisions type=observation slug=spec-migrate-4c-scope-decisions allAnswered=false -->

Item: [`observation:spec-migrate-4c-scope-decisions`](../notes/observations/spec-migrate-4c-scope-decisions.md)

## Q1

**What should become of this observation — keep it as a permanent decision record (e.g. move into work/notes/findings/ or mint an ADR capturing the 'resolver-namespace vs artifact-type vs promote-alias' three-surface distinction), fold its lessons into the follow-up contract/alias-removal task's prompt, or discard it now that sub-batch (c) is done and green?**

> work/notes/observations/spec-migrate-4c-scope-decisions.md records three judgement calls made while completing rename-spec-remaining-src-modules-c (all three sub-batches a/b/c are in work/tasks/done/): (1) selection→arg mappers left unchanged because SelectedNamespace lacked 'spec' at the time and adding it would be TS2367 dead code; (2) renderPrdBody actually lived in buildable-body.ts not spec-complete.ts, so it was renamed at the definition site as an oversight-fix; (3) triage-persist artifact==='spec' and needs-attention {namespace:'spec'} were left as-is because they are artifact-type / promote-alias surfaces, not resolver-namespace consumers. Spot-check of current code shows advance-drivers.ts:387 and do-autopick.ts:204 now DO carry item.namespace==='spec' branches — i.e. SelectedNamespace has since been widened, confirming the observation's reasoning about (1) was time-bounded and its predicted follow-up has landed. The 'three distinct spec surfaces' framing (resolver namespace / artifact-type alias / promote alias) is the reusable insight most likely worth preserving; the per-file mechanical detail is largely obsolete.

_Suggested default: Distil the 'three spec surfaces' distinction into a short findings note (work/notes/findings/) or ADR and discard the per-file mechanics; the sub-batch-specific detail has already been overtaken by (a)/(b)'s SelectedNamespace widening._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Is decision (2) — renaming renderPrdBody→renderSpecBody inside buildable-body.ts even though the task's file list only named spec-complete.ts — worth surfacing as a WORK-CONTRACT clarification (e.g. that a symbol assignment in one sub-batch implicitly authorises edits to whichever file defines that symbol), or is it a one-off that needs no protocol change?**

> Section 2 of the observation notes the task prose omitted buildable-body.ts from the file list while cross-referencing renderPrdBody as a 4c symbol via sub-batch (a). The author judged the symbol assignment unambiguous and edited the definition file anyway. This is a recurring shape for multi-sub-batch renames and could either stay tacit or be pinned down in WORK-CONTRACT.md / the task template.

_Suggested default: One-off; no protocol change — the symbol-assignment-wins-over-file-list heuristic is already implicit in how atomic renames work._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
