<!-- agent-runner-sidecar: item=observation:scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20 type=observation slug=scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20 allAnswered=false -->

## Q1

**Triage disposition for this observation: promote to a slice that unifies both pool gates onto the mirror-ref reader, keep as a recorded observation for later, or drop?**

> Observation records pre-existing debt in `scan()` (packages/agent-runner/src/scan.ts ~L368 vs ~L397): the autoBuild pool gate is resolved via `resolveRepoConfig` (working-tree reader pointed at a bare mirror path), while the autoSlice pool gate is resolved via `resolveRepoConfigFromMirror` (mirror-ref reader). For a repo with a COMMITTED per-repo `.agent-runner.json` override, the two gates can therefore disagree within a single repo iteration. Blast radius is narrow and `scan` is read-only with global-config fallback (degrades, not corrupts), but the two gates should share one view. The observation already proposes a fix shape: route BOTH gates through `resolveRepoConfigFromMirror` for bare-mirror scans, plus a test that a committed override of one gate is observed by both pool gates. The originating review (`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`) called this 'worth its own slice' but out of scope for that nit.

_Suggested default: promote-slice — fix shape and test are already sketched, and the divergence is a latent correctness bug on committed per-repo overrides_

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

promote-slice. Verified live divergence: the autoBuild gate uses the working-tree reader against the bare mirror (which cannot read a committed `.agent-runner.json` → falls back to global/default), while the autoSlice + lifecycle gates use the mirror-ref reader (which CAN read the committed value). So a repo with a committed per-repo override of both gates gets disagreeing gates within one iteration. Fix: point the autoBuild gate at `resolveRepoConfigFromMirror` in the bare-mirror branch + test that a committed override is observed by both. Narrow (read-only scan, degrades to global fallback, never corrupts) but a real correctness divergence. Disposition: promote-slice.
