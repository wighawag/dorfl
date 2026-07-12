<!-- dorfl-sidecar: item=observation:spec-sidecartype-forced-three-more-record-maps-2026-07-09 type=observation slug=spec-sidecartype-forced-three-more-record-maps-2026-07-09 allAnswered=false -->

Item: [`observation:spec-sidecartype-forced-three-more-record-maps-2026-07-09`](../notes/observations/spec-sidecartype-forced-three-more-record-maps-2026-07-09.md)

## Q1

**What should become of this observation now that the additive spec-member changes to APPLY_LIFECYCLE_FOLDERS, FOLDERS_FOR_TYPE, and ANALYSE_RUNG_FOR_TYPE have landed with the expand-spec task — file it as an informational note (leave in observations/), fold it into the done record for expand-spec-lock-and-sidecar-namespace as a scope-broadening postscript, mint a follow-up task (e.g. lint that flags every Record<SidecarType,…> so future SidecarType widenings enumerate ALL sites up-front rather than being discovered by tsc), or discard?**

> Observation records that adding 'spec' to SidecarType forced three MORE Record<SidecarType,…> maps to gain a spec member beyond the sites the task named (item-path.ts APPLY_LIFECYCLE_FOLDERS, advance.ts FOLDERS_FOR_TYPE, advance-classify.ts ANALYSE_RUNG_FOR_TYPE). Each mirrors the prd entry (same folders / same task-spec analyse rung). Grep confirms all three files now carry a spec: member and the task sits in work/tasks/done/. Change is purely additive, behaviour-preserving, and forced by TS totality. The signal worth surfacing is the meta-pattern (task enumerations of total-map sites are systematically under-counted), not the local fix.

_Suggested default: File as informational (leave the observation in place) — the local fix is landed and correct; no follow-up task unless the reviewer wants the enumeration-completeness lint._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Discard. The additive spec-member changes (APPLY_LIFECYCLE_FOLDERS, FOLDERS_FOR_TYPE, ANALYSE_RUNG_FOR_TYPE) have landed with the expand-spec task. Do NOT mint the 'lint every Record<SidecarType,...>' follow-up: tsc already forces exhaustiveness on a SidecarType widening (that is how these three were found), so a dedicated lint adds low value for its upkeep. No informational note needed beyond the done record.
