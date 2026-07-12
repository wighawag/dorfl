<!-- dorfl-sidecar: item=observation:prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename type=observation slug=prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename allAnswered=false -->

Item: [`observation:prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename`](../notes/observations/prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename.md)

## Q1

**What becomes of this signal — should the value-vs-symbol alias distinction be backported into a durable artefact (the convert-from-prd-to-spec skill and/or the reusable-cutover-pattern idea note), or is it dischargeable as historical now that 4a/b/c have landed?**

> The observation diagnosed a C-audit blind spot during the Prd→Spec cutover: value tokens (fm fields, namespace strings, config keys) migrate incrementally under a dual-accepting alias, but exported TS symbols/type names have no such alias and must be renamed atomically with all importers. The immediate remediation (re-scoping 4a to an atomic exported-symbol rename, serialising 4a→4b→4c) has fully landed — rename-spec-remaining-src-modules-{a,b,c}.md and rename-spec-residual-exported-symbols-and-prdslandIn-plumbing.md are all in work/tasks/done/, and the tasked spec prd-to-spec-vocabulary-cutover-and-migration-command.md is presumably discharged. However the underlying lesson — a rename-cutover author must CLASSIFY each identifier as VALUE (aliasable, incremental) vs NAME/SYMBOL/FILE-IDENTITY (atomic, no alias, migrate with full blast radius in one commit) — is not encoded in skills/convert-from-prd-to-spec/SKILL.md (grep for 'atomic'/'value alias'/'symbol alias' returns nothing), nor is it in the sibling idea note work/notes/ideas/prd-to-spec-sweep-beyond-work-tree-and-reusable-cutover-pattern.md which explicitly aims to generalise this cutover. So the residue is: does the lesson get promoted (skill edit task + idea-note update, or an ADR on rename-cutover mechanics), or is it acceptable to delete this observation as spent since the concrete work already applied it?

_Suggested default: Promote the lesson: mint a small task to add a 'classify each identifier: VALUE vs SYMBOL/NAME/FILE-IDENTITY' lens to skills/convert-from-prd-to-spec/SKILL.md (and cross-reference it from the reusable-cutover-pattern idea note), then delete this observation. The next cutover will not have the benefit of the same humans; the skill is where the lesson lives._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Backport the value-vs-symbol alias distinction into the shared cutover-lessons note under work/notes/findings/ (the same note collecting the 4d/4e C-audit lessons), then delete this observation. 4a/b/c have landed, so the operational residue is discharged; the distinction is worth keeping as reusable cutover guidance but does not need its own ADR.
