<!-- dorfl-sidecar: item=observation:word-scan-exempts-prd-cutover-task-bodies-2026-07-10 type=observation slug=word-scan-exempts-prd-cutover-task-bodies-2026-07-10 allAnswered=false -->

Item: [`observation:word-scan-exempts-prd-cutover-task-bodies-2026-07-10`](../notes/observations/word-scan-exempts-prd-cutover-task-bodies-2026-07-10.md)

## Q1

**Has the scope of PROVENANCE_FILE_BASENAMES grown beyond what this decision record contemplated, and if so should the observation be amended (or a follow-up ADR/observation opened) to cover the wider criterion?**

> The recorded decision framed the exemption narrowly as 'task/observation whose own SUBJECT is documenting the retired-vocabulary sweep'. The list in packages/dorfl/test/prd-word-cutover-leak-scan.test.ts now contains 8 basenames including an idea note (prd-to-spec-sweep-beyond-work-tree...), a spec (vocabulary-cutover-prose-sweep-skill.md), and two skill-authoring tasks whose exemption rationale is 'proper-noun skill/command names', not 'sweep subject'. That is a broader criterion than the observation states.

_Suggested default: Amend the observation (or add a short sibling note) to record the broadened criterion — proper-noun references to the prd->spec skill/command names — so the exemption's rationale in the test matches the decision record._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Does the whole-file exemption need a cleanup / expiry signal so the list does not silently rot once the retired `prd` word is fully purged from the codebase?**

> PRESERVE_SLUGS is naturally bounded (a slug only shields lines where the retired word appears with the slug). PROVENANCE_FILE_BASENAMES shields entire files unconditionally, so once the underlying task/spec has served its purpose the exemption stays in place forever. The observation mentions the non-vacuous assertion prevents wrong entries but not stale ones.

_Suggested default: Add a TODO/note that entries whose files have moved to done/tasked can be pruned after the prd-word src prose scan is fully green and the hard-cutover task lands._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Should the observation be marked ratified/linked from the done record now that the code change is merged, or is it still awaiting review?**

> The observation text ends with 'Linked from the done record for ratification.' The decision is clearly implemented (PROVENANCE_FILE_BASENAMES exists with the documented shape and points back to this note), but the observation file itself has no ratification/status marker.

_Suggested default: Treat it as ratified in-situ (the code cites it by filename) and leave the note as-is; no separate status field is used for observations in this repo._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
