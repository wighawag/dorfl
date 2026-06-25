<!-- dorfl-sidecar: item=task:scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20 type=task slug=scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20 allAnswered=false -->

## Q1

**Should BOTH pool gates in the registry scan() be unified onto the mirror-ref reader (resolveRepoConfigFromMirror) for the bare-mirror path, i.e. switch the autoBuild gate away from the working-tree resolveRepoConfig? Confirm mirror-ref is the intended single reader (not the reverse).**

> The observation's 'Suggested fix shape (decide when slicing)' leaves this as an explicit decision, and the applied triage answer (q1) committed to 'point the autoBuild gate at resolveRepoConfigFromMirror in the bare-mirror branch'. Verified live: in scan() (packages/dorfl/src/scan.ts) the autoBuild gate at ~L392 uses resolveRepoConfig({repoPath: mirror.path,...}) — a working-tree read (loadRepoConfig -> existsSync/readFileSync on disk) against a BARE mirror that has no checked-out .dorfl.json, so it silently falls back to global; while autoTask (~L422) and the lifecycle gates (~L451) use resolveRepoConfigFromMirror({mirrorPath: mirror.path,...}), which reads the COMMITTED .dorfl.json from the mirror's main ref. So a repo with a committed per-repo override resolves the two gates from different views. The mirror-ref reader is the correct one for a bare mirror (no working tree); confirm that is the unification direction.

_Suggested default: Yes — unify both bare-mirror scan() gates onto resolveRepoConfigFromMirror (the mirror-ref reader), per the applied triage answer. Leave the working-tree scanRepoPaths() sibling unchanged: it operates on real checkouts where resolveRepoConfig is correct._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Is the scope strictly the registry scan() bare-mirror path, leaving scanRepoPaths() (the working-tree, in-place run sibling) untouched? And does the fix touch ONLY the reader selection at the autoBuild gate, or is any related call site (e.g. the autoBuild re-read at scan.ts ~L530, or the scoreItems(state, autoBuild,...) consumer at ~L480) also in scope?**

> scanRepoPaths() (scan.ts ~L530) legitimately uses resolveRepoConfig because it reads real working checkouts, not bare mirrors — it should NOT be changed. But within the bare-mirror scan() there is a SECOND resolveRepoConfig call at ~L530 region and the autoBuild value feeds scoreItems at ~L480; the task should state whether the single autoBuild gate read is the only edit or whether sibling reads must move too, so the slice does not leave a second divergent reader behind.

_Suggested default: Scope = the registry scan() bare-mirror autoBuild gate only (move it to resolveRepoConfigFromMirror); explicitly leave scanRepoPaths() on resolveRepoConfig. Audit the other autoBuild reads inside scan() and move any that also read the bare mirror, so no divergent reader remains._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**What is the acceptance test's exact assertion shape? The observation proposes 'a mirror whose committed .dorfl.json overrides one gate asserts both pool gates observe that same committed view' — should the test override BOTH autoBuild and autoSlice/autoTask, or override autoBuild ALONE (the gate that currently mis-reads) and assert it is now honoured from the committed view?**

> The observation's suggested fix says 'a mirror whose committed .dorfl.json overrides one gate asserts both pool gates observe that same committed view.' The sharpest regression test for THIS bug overrides autoBuild specifically (the gate that silently fell back to global) on a bare mirror's committed main:.dorfl.json and asserts scan() now reflects it. The task must pin which committed override the fixture sets and which scan() output field the test reads, so it is verifiable.

_Suggested default: Fixture: a bare hub mirror whose committed main:.dorfl.json sets autoBuild (differing from the global default); assert the scan() report's eligibility reflects the COMMITTED autoBuild value (proving the mirror-ref reader is now used), matching how autoTask is already read._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**This task is a promotion stub and is not yet buildable: it carries needsAnswers:true but has NO '## Open questions' block listing them, and no '## Acceptance criteria' or self-contained '## Prompt' (template violation). It only back-points to the observation. Before it can advance, should the task body be filled out to carry the mechanism + fix shape + acceptance criteria + a self-contained prompt (so an agent could build from the file alone), or is the back-pointer to the observation acceptable?**

> Per task-template.md and WORK-CONTRACT.md, a needsAnswers:true task must LIST its questions under '## Open questions' in the body, and a buildable task needs '## What to build', '## Acceptance criteria', and a self-contained '## Prompt' (WORK-CONTRACT.md: 'an agent could start from the file alone'). The current body is just: 'Promoted from observation ... A human answered "promote": draft this into a buildable task.' The signal currently lives only in the observation note, which is a deletable capture bucket — if it is deleted, the task loses its mechanism. WORK-CONTRACT.md's discharge test requires the spawned task to be SELF-CONTAINED, not a back-pointer.

_Suggested default: Yes — flesh the task body out from the observation: inline the mechanism (the two readers + the bare-mirror divergence), the fix shape (unify on resolveRepoConfigFromMirror), acceptance criteria (the regression test above + verify-green), and a self-contained prompt with the drift-check; list the scoping questions under '## Open questions'. Treat the observation as dischargeable only once the task carries the signal._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

## Q5

**The observation's code references have DRIFTED from the live source — it cites scan.ts ~L368 (autoBuild) and ~L397 (autoSlice), but the gates are now at ~L392 (autoBuild, resolveRepoConfig) and ~L422 (autoTask, resolveRepoConfigFromMirror) with the lifecycle gate at ~L451. Should the task reference modules/concepts (the autoBuild gate read in scan(), the resolveRepoConfig vs resolveRepoConfigFromMirror readers) rather than brittle line numbers?**

> WORK-CONTRACT.md 'Drift is a needs-attention signal' and the template's guidance to 'avoid specific file paths / code snippets (they go stale)'. The divergence itself is unchanged and still real (verified), so this is a stale-reference correction, not a premise invalidation — but the task should cite by module/symbol so it does not send the builder to wrong lines.

_Suggested default: Reference by symbol/concept: 'the autoBuild pool gate inside the registry scan() (packages/dorfl/src/scan.ts), currently resolved via resolveRepoConfig, vs the autoTask/lifecycle gates resolved via resolveRepoConfigFromMirror in repo-mirror.ts' — omit hard line numbers._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):
