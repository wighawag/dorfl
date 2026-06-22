---
title: reviewMaxRounds was built onto the review GATE by miscommunication — it belongs to the slicer EDIT LOOP, not the gate
date: 2026-06-06
status: open
needsAnswers: false
triaged: keep
---

## The signal

The `review-gate-pr` slice (Gate 2, shipped in PR #11) added a **`reviewMaxRounds`** config knob to the GATE: the gate invokes the reviewer up to N rounds and, on a persistent `block`, forces needs-attention. Reviewing #11 already smelled this: "`reviewMaxRounds` is a loop without a revise step — it just re-reviews the same diff N times, which does nothing useful."

Maintainer clarified (2026-06-06) that this was a **miscommunication**: the review GATE does NOT need a round bound. A gate is **one-shot pass/fail** — approve (proceed) or block (→ needs-attention). There is no revise step _inside a gate_, so re-reviewing the same artifact N times is meaningless (same input → same verdict).

## Where the bound actually belongs

The thing that genuinely LOOPS is the **slicer edit loop** (a SEPARATE concept from the gate — see `work/findings`/the eventual `review` PRD grilling pass note): review → feed findings back into EDITS → re-review → converge. THAT loop needs a ceiling so an unattended review↔edit cycle can never run forever. So:

- **`reviewMaxRounds` belongs to the SLICER EDIT LOOP**, per-repo configurable (the usual flag > env > per-repo > global > default chain), as its infinite-loop safety ceiling. Its natural terminator is still "a pass finds no NEW blocking issue" (passes taper to zero — see the idea file); `reviewMaxRounds` is only the hard cap on top.
- **It does NOT belong to the review GATE** (impl or slice). The gate is terminal.

## Disposition (do NOT act yet — maintainer will call the slicing pass)

- **Keep the parameter for now** (it is live in the Gate-2 code; removing it is a separate change). Do NOT delete it in isolation.
- **Later: remove `reviewMaxRounds` from the review GATE** (`complete`/`do` Gate-2 path: `review`/`reviewModel` stay; the rounds loop + `reviewMaxRounds` go). The gate becomes a single reviewer invocation → verdict. (`autoMerge` is GONE — hard-deleted by slice `remove-automerge-merge-means-auto-on-gate-pass`: `merge` auto-lands on gate pass, `propose` = a human merges; it is no longer a gate knob.)
- **Later: (re)introduce `reviewMaxRounds` on the SLICER EDIT LOOP** when that is built — same name, NEW home + meaning (loop ceiling, not gate retries), per-repo. So this is a MOVE + reframe, not a pure deletion.
- Until the slicer edit loop exists and the gate is simplified, the parameter is an orphan on the wrong concept — flagged here so it does not silently calcify into "load-bearing."

(Captured 2026-06-06 during the review-gate / slicer-review discussion, immediately after PRs #11+#12 landed the gate + the agent-output seam.)

## Update 2026-06-08 (the slicing-coherence design re-confirms this — and one duplicate folded in)

The `slicing-coherence` design session (during the `do prd:advance-loop` test-drive) independently re-derived this exact signal and a SHORT-LIVED duplicate observation was written, then DELETED in favour of this one (richer + the maintainer's clarification). Folding in what was new there:

- **The gate↔loop split is now a DECIDED, named model** (see `work/prd/slicing-coherence.md` D3 + the `## DECIDED 2026-06-08` section of `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`): a one-shot GATE (`--review`/`--no-review`, terminal pass/fail) vs a looping IMPROVER that EDITS between passes (the slicer loop: `--slicer-loop`/`--slicer-loop-max`/ `--slicer-loop-model`). This is the SAME split this observation called for — the rounds bound belongs to the looping improver (which edits between passes), NOT the terminal gate.
- **CORRECTION to a wrong turn made during that session:** the slicing-coherence PRD draft initially said the slice acceptance GATE would "inherit `--review-max-rounds` for free (latent)" via `performIntegration`. That is the SAME mistake this observation flags — a gate should be ONE-SHOT, with no rounds. The correct disposition: `--review-max-rounds` is an ORPHAN ON THE GATE to be REMOVED (not inherited by the slice gate). Any future build-side revise↔review LOOP gets its OWN loop-family flag (mirroring `--slicer-loop-max`), exactly as this observation prescribes (MOVE + reframe, not keep-on-the-gate). The slicing-coherence PRD/idea are corrected to say so.
- **Status remains: do NOT act in isolation.** The gate simplification (remove the rounds loop + `reviewMaxRounds` from the Gate-2 path) is still a separate change; it is a natural sibling to the slicing-coherence review work (both are "make gate and loop distinct concepts"), but build-path gate cleanup is out of slicing-coherence's slice scope unless the slicer chooses to pull it in. Flag for the eventual triage pass.

## Triage 2026-06-08 — HOLD

Maintainer decision: **HOLD the build-path Gate-2 cleanup** (removing the rounds loop + `reviewMaxRounds` from `integration-core.ts`). The slice-gate side is already handled by `slicing-coherence` (the slice acceptance gate is one-shot, does NOT inherit `--review-max-rounds`). Removing the live config axis from the BUILD gate is a breaking change better RE-HOMED onto a future revise↔review loop than deleted in isolation — hold until that loop is designed/built, then move the bound rather than drop it. Keep this note as the standing record of the orphan. NOT promoted to a slice now.

## Update 2026-06-12 (re-verified during triage — HOLD still stands)

Re-checked against current code: the orphan is STILL LIVE and the HOLD is still correct. The build-path Gate-2 still runs the `for (round = 1..reviewMaxRounds)` loop (`integration-core.ts` ~L437) with NO revise step between rounds — it re-invokes `reviewGate` on the IDENTICAL diff (same slug/cwd; nothing mutates between iterations), exactly the "re-review the same artifact N times → does nothing useful" orphan. The code comment itself marks it: "a future builder-revise step plugs in here" (~L461) — i.e. that revise loop does NOT exist yet. Meanwhile the SLICER edit loop DID land with its OWN distinct bound `slicerLoopMax` (`config.ts` ~L256, `slicer-review-loop.ts`), settling the "where the bound belongs" half — but that does NOT resolve the build-gate orphan. So: keep this note as the standing record; remove `reviewMaxRounds` from the build gate (or give it a REAL builder-revise step) only when that revise↔review loop is designed/built — never delete the live config axis in isolation.

## Applied answers 2026-06-22

### q1: Does this observation's HOLD still stand, or has the build-path Gate-2 situation changed enough to act now (e.g. design the builder revise↔review loop and MOVE `reviewMaxRounds` there, or just delete it from the gate)?

KEEP — the HOLD still stands; the situation is unchanged. Verified: the build-path Gate-2 loop still has NO revise step between rounds (the loop re-reviews up to `reviewMaxRounds`, with a comment marking where "a future builder-revise step plugs in here"), and the config docstring still flags `reviewMaxRounds` as an orphan belonging to that future loop. Re-reviewing the same unchanged diff N times is a no-op, so acting now is premature; deleting the parameter in isolation would lose what the future revise↔review loop needs. The natural resolution remains MOVE-when-the-loop-is-designed, not delete-in-isolation. Disposition: keep.

disposition: keep
