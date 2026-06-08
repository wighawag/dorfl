---
title: the do prd: runner commits only work/backlog/* — agent-authored captured notes (observations/findings) written during slicing are DROPPED (left untracked), so the agent slice path is lossier than a human slicer for captured signals
type: observation
status: spotted
spotted: 2026-06-08
---

# The autonomous slicer can capture a signal, but the runner discards it

Spotted during the `do prd:slicing-coherence` test-drive (2026-06-08). The slicing
agent, doing its `to-slices` drift check, correctly NOTICED that a PRD user story's
premise had drifted and WROTE an observation file
(`work/observations/slicer-prompt-already-uses-set-lens.md`) — exactly the
`capture-signal` reflex. The runner then committed the slicing result, but that
file was left UNTRACKED (`git status` shows it as `??` after the run). The runner's
slicing commit captured the produced slices + the PRD lifecycle move + the marker,
but NOT the agent's captured note.

## Two distinct "runner owns git" rules — only ONE is the gap

This is NOT about removing the human/agent distinction; be precise:

- **Rule A — the agent does NO git itself** (no commit/push/mv; it writes FILES,
  the runner commits). CORRECT and UNCHANGED. The agent writing the observation as
  a file is exactly right; it should not `git add`/commit it.
- **Rule B — what the runner SCOOPS into its commit.** The slicing release commit
  scoops only `work/backlog/*.md` (+ the PRD `slicing/ → prd/` move + the `sliced:`
  marker). It does NOT scoop OTHER legitimate artifacts the agent created during
  the run — here an `work/observations/*.md` note. **That is the gap.**

So the agent path is **lossier than the human path**: a HUMAN running `to-slices`
by hand would `git add` both the slices AND any observation captured during the
drift check (and `capture-signal` explicitly says an autonomous/conductor run
"commits this note too and reports it"). The autonomous `do prd:` runner drops it —
so the "drift is a needs-attention/observation signal" discipline SILENTLY FAILS on
the agent path. If the human does not happen to run `git status` and notice the
stray `??` file, the captured signal evaporates on the next checkout/clean.

## Where (verify — paths may have drifted)

- `src/slicing.ts` `performSlice` step 4 — the completing transition; it snapshots
  the produced `work/backlog/` slices (`emitSlices`) but does not enumerate other
  agent-written files under `work/observations/` or `work/findings/`.
- `src/slicing-lock.ts` `releaseSlicingLock` (`emitSlices`/`markSliced`) — the
  commit construction; it lands the passed `emitSlices` paths only.
- The slicer review loop (`src/slicer-review-loop.ts`) may ALSO have the agent
  emit notes between passes — same drop applies.

## The fix (shape, not yet a decision)

The runner should ALSO capture agent-authored capture-bucket files
(`work/observations/*`, `work/findings/*`) created during the run into the slicing
commit AND REPORT them (path + one-line), matching what a human slicer +
`capture-signal` would do. Keep Rule A intact (the agent still does no git); extend
Rule B (the runner scoops the notes too). This is the same class as the
**advance-loop PRD's agent→runner REPORTING CHANNEL** (the `## Decisions` / STOP
sentinel seam, `work/done/agent-stop-signal.md`): a captured note is another thing
the agent EMITS that the runner must ROUTE/persist, not silently drop. Worth
designing as part of (or alongside) that channel rather than a one-off.

Open sub-questions for the eventual slice:
- Scope: only `observations/` + `findings/`, or any new file the agent writes
  outside `work/backlog/` (excluding the PRD itself)? Probably the capture buckets
  only, to avoid scooping accidental scratch files.
- Same drop almost certainly exists on the BUILD path (`do <slice>`): does the
  build runner commit agent-authored notes, or only the slice's code +
  `in-progress → done` move? Likely the same gap — verify and fold in (one fix for
  both paths, via the shared reporting channel).
- Reporting: the runner's end-of-run summary should LIST captured notes so a human
  sees them even when the commit lands them (visibility, not just persistence).

## Disposition

Spotted, with a clear fix shape. A real `do prd:` (and likely `do <slice>`) defect:
the autonomous path can capture a signal but loses it. Route into the agent→runner
reporting-channel work (advance-loop) or slice standalone. Until fixed, a human
running `do prd:` must `git status` and manually commit any agent-authored note
(as in this very test-drive).
