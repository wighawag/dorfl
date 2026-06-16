---
title: review-gate non-blocking nits for 'ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices' (Gate 2 approve)
date: 2026-06-16
status: open
slug: ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the in-scope decision: the human `agent-runner scan` text formatter (`format.ts`) was NOT updated to surface the new sliceable-PRD pool — it still reads only `.items[]`. This is consistent with the slice's stated scope ("only that the propose enumerator can SEE the sliceable-PRD pool") but means a maintainer running `agent-runner scan` interactively still sees no PRDs even when CI would now enumerate them. Intended? If yes, fine. If a follow-up is desired (human surface parity), capture it as its own slice/observation.
  (packages/agent-runner/src/format.ts categoriseItems/formatReport — only reads section.repo.items; no `prds[]` rendering. PR description carries no `## Decisions` block recording this choice.)
- PR description / commit message contains no `## Decisions` block — the AGENTS guidance asks the build agent to record in-scope decisions it made on its own. The maintainer's pre-resolved decisions are present in the slice body, but the agent's own choices (e.g. the formatter omission above; the try/catch+warn fallback shape on autoSlice resolution in `scan()`) are not surfaced. Consider asking the runner to append a Decisions block on integration so the next reviewer does not have to re-derive them.
  (git log -1 0caecc5 shows only the title line; no Decisions block. scan.ts lines ~225–253 introduce the warn-and-fall-back autoSlice resolution that the slice told the agent to mirror from scanMirrorPool — correctly done, just not noted.)
- Minor coherence nit (pre-existing, not introduced by this slice but worth flagging): inside `scan()` the loop now resolves `autoBuild` via `resolveRepoConfig({repoPath: mirror.path,...})` (working-tree reader pointed at a BARE mirror path) while resolving `autoSlice` via `resolveRepoConfigFromMirror` (the mirror-ref reader). Within one repo iteration two different readers can therefore disagree if a repo has a committed per-repo override. The slice told the agent not to touch the autoBuild path, so this is correctly out of scope, but it is debt that should get its own slice — left as-is the two pool gates can diverge.
  (packages/agent-runner/src/scan.ts ~lines 222–252 — `resolveRepoConfig({repoPath: mirror.path...})` for autoBuild vs `resolveRepoConfigFromMirror({mirrorPath: mirror.path...})` for autoSlice.)
