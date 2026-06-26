---
title: The runner's continue/integration rebase disables git directory-rename detection (scoped `-c merge.directoryRenames=false`) — over a per-folder sentinel
status: accepted
created: 2026-06-26
decided: 2026-06-20
supersedes:
superseded_by:
---

# ADR: Disable git directory-rename detection on the runner's own continue/integration rebase — chosen over the per-folder sentinel route

## Context

The runner re-bases a kept `work/<slug>` branch onto the freshly-fetched main
on two paths: the continue-rebase
(`rebaseContinuedBranchOntoMain` in `packages/dorfl/src/continue-branch.ts`,
and its stale-lease push retry loop) and the integrate-tail rebase
(`performIntegration` + `recoverAlreadyCommitted` in
`packages/dorfl/src/integration-core.ts`). Each work branch typically carries
ONE durable folder-transition `git mv` (e.g.
`work/tasks/ready/<slug>.md → work/tasks/done/<slug>.md`,
`work/prds/ready/<slug>.md → work/prds/tasked/<slug>.md`,
the `cancelled`/`dropped` siblings, …).

When the source folder is SPARSE at branch-time (0–1 items) and the lone item
is moved out, git's directory-rename heuristic infers a whole-DIRECTORY rename
(`work/tasks/ready/ → work/tasks/done/`) from that single file move. If main
later ADDED unrelated sibling files into that same source folder, the rebase
applies the inferred directory rename and flags each new file as
`CONFLICT (file location): … added in HEAD inside a directory that was
renamed … suggesting it should perhaps be moved to <to>/<slug>.md`. That
conflict is SPURIOUS (byte-identical content, branch never touched the files)
but indistinguishable from a real conflict without judgement; the runner
correctly aborts and stuck-locks the branch as needs-attention — a FALSE
positive. The taxonomy reorg makes this MORE likely, not less: more folders,
several often holding 0–1 items (`tasks/cancelled/`, `prds/dropped/`,
`prds/proposed/`).

(Empirically verified on git 2.47.3 against this exact scenario:
`-Xno-renames`, `-c merge.renames=false`, and `-c diff.renames=false` all
still CONFLICT; only `-c merge.directoryRenames=false` is CLEAN. The
content-rename family is the wrong knob; directory-rename detection is its
own thing.)

## Decision

Front every runner-owned rebase on the continue/integration path with
`-c merge.directoryRenames=false`, scoped to the invocation (NEVER a
persistent `git config` write). Three sites:

1. `rebaseContinuedBranchOntoMain` (continue-branch).
2. `performIntegration`'s rebase-onto-`<arbiter>/main` (integration-core).
3. `recoverAlreadyCommitted`'s rebase retry loop — the small `rebaseArgs()`
   thunk carries the flag so EVERY retry of the loop carries it too.

A GENUINE same-path content conflict still surfaces and still routes to
`{kind: 'conflict'}` / needs-attention — directory-rename detection is the
only thing turned off.

### Rejected: per-folder sentinel (`.gitkeep` / `README.md` in every work/ folder)

A sentinel committed to each work/ folder would keep it non-empty and stop
the heuristic from firing. Rejected because:

- It FIGHTS the case where a user (or the protocol itself) prefers genuinely
  empty/deleted folders. Empty `work/tasks/cancelled/` is a valid resting
  state; a sentinel forces a non-empty resting state for a runner-internal
  reason.
- It adds a non-`*.md` companion file every item-scan predicate would have to
  learn to exclude (status surface, ledger reads, item enumeration). A new
  load-bearing convention to maintain forever in every consumer of the work
  tree.
- It is a workaround at the wrong layer — fixing a rebase-time inference at
  source-tree-shape time. Rename-off addresses the actual mechanism.

### Rejected: setting `merge.directoryRenames=false` in the repo's git config

It would leak into the user's interactive `git rebase` / `git merge` against
their own repo. The runner's own rebases must not change the user's git
behaviour.

### Rejected: the content-rename knobs (`-Xno-renames`, `merge.renames`, `diff.renames`)

Verified ineffective for this directory-rename conflict on git 2.47.3.
Documented inline in the rebase invocations so a future reader does not
re-derive the wrong knob.

## Consequences

- Sparse-source-folder done-moves replay cleanly through both the
  continue-rebase and the integrate-tail rebase; the false-needs-attention
  failure shape that prompted this task no longer fires.
- The runner loses one form of automatic "did this commit move a directory?"
  inference — but the runner has never relied on directory-rename inference;
  every move it makes is an explicit `git mv` of a single item path.
- Real content conflicts on the same path still abort and still route to
  needs-attention; rename-off does not mask real clashes (covered by the
  regression test in `packages/dorfl/test/continue-branch.test.ts`).
- The repo's persistent git config stays untouched; an interactive
  `git rebase` by a human is unaffected.
- If a future site grows a NEW runner-owned rebase on the same kept-branch
  replay, it MUST carry `-c merge.directoryRenames=false` too. The three
  current sites carry it; the rename-off-aware comment on each site names
  the task so the convention is greppable.
