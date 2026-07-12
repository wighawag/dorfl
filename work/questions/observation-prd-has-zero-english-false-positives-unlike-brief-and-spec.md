<!-- dorfl-sidecar: item=observation:prd-has-zero-english-false-positives-unlike-brief-and-spec type=observation slug=prd-has-zero-english-false-positives-unlike-brief-and-spec allAnswered=false -->

Item: [`observation:prd-has-zero-english-false-positives-unlike-brief-and-spec`](../notes/observations/prd-has-zero-english-false-positives-unlike-brief-and-spec.md)

## Q1

**What becomes of this observation now that the prd→spec cutover it advises has landed?**

> work/notes/observations/prd-has-zero-english-false-positives-unlike-brief-and-spec.md dated 2026-07-09 was written during the prd→spec cutover to justify a safe forward keep-case sweep and flag 7 'prd is a spec' adjacencies that were reworded in-flight. Current tree (HEAD f91c4d54) shows the cutover completed: work/specs/ folders exist, packages/dorfl/src still carries a few benign 'prd' occurrences (advance-ci-template.ts, advance-drivers.ts, advance-lifecycle-template.ts, advance-isolated.ts) and the observations folder itself retains many prd-* filenames as historical provenance. The observation's four points (forward sweep safe, adjacency rewording done, reverse leak scan still needed with an allow-list for refspec/BranchProtectionSpec/remote spec, no sentinel gymnastics needed) are all retrospective advice about a sweep that already ran. Its title is also self-referentially garbled by the cutover (says 'spec has zero false-positives unlike brief/spec' where the first 'spec' was originally 'prd'). Options include: (a) delete as historical/consumed, (b) distil the durable structural claim (coined acronyms have no English collisions; only same-word adjacencies matter) into an ADR or a note under work/notes/findings/ for future cutovers, (c) keep as-is under observations as provenance, (d) mint a task to add/verify the reverse leak-scan allow-list for refspec/BranchProtectionSpec/remote spec if that has not already been done.

_Suggested default: Delete: the cutover is complete, the adjacency reworkings landed, and the structural insight (coined-acronym words do not hide in English) is small enough to re-derive next time; unless the reverse leak-scan allow-list is still open, this signal is consumed._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
