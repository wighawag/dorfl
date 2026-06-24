<!-- dorfl-sidecar: item=observation:scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20 type=observation slug=scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20 allAnswered=false -->

## Q1

**Triage disposition for this observation: promote it to a task (a slice that unifies both propose-matrix pool gates onto the mirror-ref reader for a bare-mirror scan, with a test that a committed per-repo override is observed by both gates), keep it as a recorded observation for later, or drop it?**

> Observation at work/notes/observations/scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20.md.
>
> In packages/dorfl/src/scan.ts the two propose-matrix pool gates resolve per-repo config through DIFFERENT readers within one repo iteration:
>  - autoBuild (~L368): resolveRepoConfig({repoPath: mirror.path}) — working-tree reader pointed at a BARE mirror path, which cannot read a committed .dorfl.json and falls back to global/default.
>  - autoSlice (~L397): resolveRepoConfigFromMirror({mirrorPath: mirror.path}) — mirror-ref reader, which CAN read the committed value.
> So a repo with a committed per-repo override of both gates gets disagreeing gates within one iteration. Pre-existing debt (the ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices slice was told NOT to touch the autoBuild reader). Narrow blast radius (read-only scan, both readers fall back on fault — degrades rather than corrupts), but a real correctness divergence: the two pool gates SHOULD resolve from the SAME view.
>
> The observation already carries an 'Applied answers 2026-06-22' section that records a triage decision of 'promote-slice' with a verified live divergence, citing the same fix shape (point the autoBuild gate at resolveRepoConfigFromMirror in the bare-mirror branch + test). That answer is recorded in the body but the observation file still sits in work/notes/observations/ with status: spotted and needsAnswers: false — no follow-up task has been created and no terminal move has occurred. Surfacing the triage question so the disposition is recorded through the sidecar/engine path and the observation can advance to its terminal state.

_Suggested default: promote-task — author the slice exactly as the body's 'Applied answers 2026-06-22' section already endorses: in scan.ts switch the autoBuild gate's bare-mirror branch from resolveRepoConfig to resolveRepoConfigFromMirror so both pool gates share the mirror-ref view, plus a regression test where a mirror's committed .dorfl.json overrides one gate and both pool gates are asserted to observe the same committed view._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

promote-task (translating the applied `promote-slice` answer into the engine's vocabulary). Author the slice the body's Applied-answers section endorses: in `scan.ts` switch the autoBuild gate's bare-mirror branch from `resolveRepoConfig` to `resolveRepoConfigFromMirror` so both pool gates share the mirror-ref view, plus a regression test where a mirror's committed `.dorfl.json` overrides one gate and both pool gates are asserted to observe the same committed view.
