---
title: in `scan()` the autoBuild and autoSlice pool gates are resolved by TWO DIFFERENT config readers (working-tree reader vs mirror-ref reader), so within one repo iteration they can disagree on a committed per-repo override
type: observation
status: spotted
spotted: 2026-06-20
slug: scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree
needsAnswers: true
---

## What was noticed

Surfaced during triage of the Gate-2 review nits (the
`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` review flagged it
as pre-existing debt "worth its own slice"; it was never captured as a standalone
observation, so recording it here before its nit was discharged).

In `scan()` (`packages/agent-runner/src/scan.ts`), the two propose-matrix pool gates
for ONE repo iteration are resolved by DIFFERENT config readers:

- **autoBuild** (`scan.ts` ~L368): `resolveRepoConfig({repoPath: mirror.path, ...})`
  — the WORKING-TREE reader, pointed at a BARE mirror path.
- **autoSlice** (`scan.ts` ~L397): `resolveRepoConfigFromMirror({mirrorPath: mirror.path, ...})`
  — the MIRROR-REF reader (reads the committed `.agent-runner.json` from the mirror's
  refs).

Because the two gates read the per-repo config through two different mechanisms, a
repo that carries a COMMITTED per-repo `.agent-runner.json` override can have its
`autoBuild` and `autoSlice` gates resolved from DIFFERENT views of that config — the
working-tree reader pointed at a bare mirror path may not see what the mirror-ref
reader sees. So within a single repo iteration the slice pool gate and the PRD pool
gate can disagree.

## Why it matters / scope

- It is PRE-EXISTING debt, not introduced by any one slice; the
  `ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` slice was told NOT
  to touch the `autoBuild` reader, so it correctly left the divergence in place.
- The blast radius is narrow (a repo with a committed per-repo override of one gate
  but not the other, scanned via the bare hub mirror), and `scan` is read-only +
  best-effort (both readers fall back to the global config on fault), so it degrades
  rather than corrupts. But the two pool gates SHOULD resolve from the SAME view.

## Suggested fix shape (decide when slicing)

Make both gates resolve through the SAME reader for a bare-mirror scan — most likely
`resolveRepoConfigFromMirror` for BOTH (the mirror-ref reader is the right one for a
bare mirror that has no working tree), so `autoBuild` and `autoSlice` always agree on
the committed per-repo config. Add a test: a mirror whose committed `.agent-runner.json`
overrides one gate asserts both pool gates observe that same committed view.

## Refs

- `packages/agent-runner/src/scan.ts` ~L368 (`resolveRepoConfig` for autoBuild) vs
  ~L397 (`resolveRepoConfigFromMirror` for autoSlice).
- `packages/agent-runner/src/repo-config.ts` (`resolveRepoConfig`) and the mirror-ref
  reader `resolveRepoConfigFromMirror`.

## Applied answers 2026-06-22

### q1: Triage disposition for this observation: promote to a slice that unifies both pool gates onto the mirror-ref reader, keep as a recorded observation for later, or drop?

promote-slice. Verified live divergence: the autoBuild gate uses the working-tree reader against the bare mirror (which cannot read a committed `.agent-runner.json` → falls back to global/default), while the autoSlice + lifecycle gates use the mirror-ref reader (which CAN read the committed value). So a repo with a committed per-repo override of both gates gets disagreeing gates within one iteration. Fix: point the autoBuild gate at `resolveRepoConfigFromMirror` in the bare-mirror branch + test that a committed override is observed by both. Narrow (read-only scan, degrades to global fallback, never corrupts) but a real correctness divergence. Disposition: promote-slice.
