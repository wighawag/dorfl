<!-- dorfl-sidecar: item=observation:release-lock-cannot-name-pre-cutover-slice-prefixed-lock-entries-2026-06-20 type=observation slug=release-lock-cannot-name-pre-cutover-slice-prefixed-lock-entries-2026-06-20 allAnswered=false -->

## Q1

**The 2026-06-22 applied-answer disposition is promote-slice (ship escape-hatch (b) release-lock --entry <literal> + report-literal-names (c) together, leaving migration (a) as follow-up), yet no matching slice appears in work/tasks/ready/ or work/tasks/done/ and the CLI still resolves release-lock <item> only through the task:/prd:/obs:/bare mapping with no --entry option — was the promote-slice ever actually created, and if not should this observation be re-opened (needsAnswers flipped back to true) so the slice gets promoted?**

> needsAnswers: false and the applied answer records a promote-slice disposition, but grep for --entry / literal-entry across work/ and packages/dorfl finds no follow-through: cli.ts release-lock <item> action (lines ~3525+) still only accepts item-forms via releaseItemLock and there is no release-lock-entry / release-lock-escape-hatch task file. The observation therefore reads as triaged-but-not-shipped.

_Suggested default: Re-open (set needsAnswers: true) and promote a single slice bundling (b) release-lock --entry <literal> escape hatch + (c) gc --ledger reporting literal entry names + workaround docs, cross-referencing the sibling reaper-never-clears-a-done-plus-stuck-lock-orphans-forever observation._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Should the sibling observation reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20 be folded into the SAME promoted slice (one orphan, two angles per the note), or promoted independently?**

> The observation explicitly lists that sibling under Refs and the applied answer says 'Cross-ref the reaper orphan sidecar (same orphan, two angles)', but does not state whether they ship as one slice or two — a bundling decision that affects how the slice is scoped.

_Suggested default: Bundle: one slice covering release-lock --entry, gc --ledger literal-entry reporting, AND the reaper's terminal-orphan behaviour, since a single escape hatch + report surface addresses both angles._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
