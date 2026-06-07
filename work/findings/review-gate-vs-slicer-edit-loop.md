---
title: The three distinct review concepts — gate (impl + slice) vs slicer edit-loop vs the orphaned maxRounds — framing for the review PRD grilling pass
date: 2026-06-06
status: open
---

# Framing for the eventual `review` PRD grilling pass (maintainer to call when ready)

A maintainer discussion (2026-06-06, after PRs #11+#12 landed Gate 2 + the
agent-output seam) sharpened the review story into **THREE distinct concepts** that
the current artifacts (`work/prd/review.md`, `work/ideas/review-gate-default-for-
autoslicing.md`, `work/backlog/autoslice-confidence.md`) currently CONFLATE. Pin
these down in the grilling pass BEFORE slicing `review-gate-spec` / the edit loop.

## 1. The review GATE — for BOTH implementation AND slice generation

- **One-shot, terminal: approve (proceed) or block (→ needs-attention).** NOT a
  loop. (See concept #3 — the rounds param does not belong here.)
- **Impl-review (Gate 2, built: #11/#12) and slice-review (Gate 1, not built) are
  ~the SAME mechanism**, differing essentially by **PROMPT** (review a diff vs.
  review generated slices) — "arguably the same thing except maybe a different
  prompt" (maintainer). So `review-gate-spec` should REUSE the Gate-2 machinery
  with a slice-framed prompt, not a parallel mechanism.
- **The destination / goal-check is a PROMPT-FRAMING aspect of the gate, not a
  separate mechanism.** Maintainer: the goal-check for the slicing review gate "is
  a question about the best prompt for a thorough review of the generated slices —
  useful, and can be COMBINED with other aspects as part of the same review gate."
  So the gate stays one pass; HOW thoroughly it checks (incl. "do these slices
  reach the PRD goal?") is a matter of the best review prompt, not a second step.
  → Open work for the pass: **what is the best single review prompt** (lenses +
  destination-check folded in) for slice-generation review?

## 2. The slicer EDIT LOOP — a separate concept; NOT a gate

- **The observed phenomenon:** slices kept IMPROVING while the maintainer asked for
  review — i.e. review findings fed back into EDITS, repeatedly. That is an
  improver loop, not a pass/fail gate.
- **Shape:** review → feed findings back into edits → re-review → … → converge.
  **The goal/destination-check is PART OF this loop** and can ITSELF trigger
  further edits (which is precisely why it is a loop, not a terminal check).
- This is the M×N multipass material in the idea file (§3/§4/§4a) — but the idea
  file frames it ambiguously as a "gate." It is NOT a gate; it is the slicer
  producing better slices BEFORE any gate verdict.
- **Open work for the pass (the crux that makes it real):** the EDIT-FEEDBACK
  mechanism — WHO applies revisions between rounds (the slicer re-running with the
  findings? a dedicated revise step?), and how the goal-check's edits compose with
  the angle-pass edits. Plus how M (fresh-context reviews) × N (in-context angle
  passes) map onto this loop.

## 3. `reviewMaxRounds` — belongs to the EDIT LOOP, not the gate

- Built onto the GATE by miscommunication (see
  `work/observations/reviewmaxrounds-on-wrong-concept.md`). The gate is terminal →
  no rounds.
- **Belongs to the slicer EDIT LOOP** as its infinite-loop ceiling, **per-repo
  configurable** (flag > env > per-repo > global > default, as usual). Natural
  terminator is "no NEW blocking issue"; `reviewMaxRounds` is the hard cap on top.
- Disposition: keep for now; later REMOVE from the gate and (re)introduce on the
  edit loop (a move + reframe, not a pure delete).

## Relation to `autoslice-confidence` (already in backlog) — keep them DISTINCT

- `autoslice-confidence` = the slicer's own ONE-SHOT self-confidence check (low
  confidence → `needsAnswers`/needs-attention). The idea file itself calls this
  "necessary but weak — a model rubber-stamping its own decomposition."
- The slicer EDIT LOOP (#2) is the INDEPENDENT, adversarial improver the self-check
  cannot be. They are complementary, NOT the same: confidence-check = cheap
  producer humility; edit loop = independent review→revise improvement.
- The grilling pass should state the relationship explicitly so neither is built as
  the other.

## Additional insertion points raised 2026-06-06 (fold into the pass)

The review MECHANISM (one protocol) plugs in at MULTIPLE points — the pass should
treat "where review runs" as a set of insertion points, not one gate:

- **(A) slice-generation** — review/edit-loop at SLICING time (concepts #1/#2 above).
- **(B) PRE-BUILD slice check (NEW — maintainer point 1)** — a slice-review step
  INSIDE `do <slug>` implementation, BEFORE the agent builds. Rationale: slices are
  assumed coherent, but one can slip through with a missed judgement (e.g. a human
  authored it without review). Today a slice is "trusted" once in `backlog/`; nothing
  re-checks it at BUILD time. This lets the implementer CHECK + refine (or raise
  `needsAnswers`) before implementing. Same mechanism, new insertion point + prompt
  ("review the slice you are about to build; refine or flag before implementing").
  Distinct from the slice-gen gate (slicing time) and the impl gate (post-build).
- **(C) post-build impl review** — Gate 2, already built (#11/#12).
- **(D) run coverage (NEW — maintainer point 3)** — review must cover `run`, which
  has a SEPARATE integrate path (see
  `work/findings/run-and-do-have-separate-integrate-paths.md`). Resolve: converge
  `run` on `performComplete`, or explicitly wire the gate into `run` too.
- **(E) issue-thread surface (NEW — maintainer point 2)** — for issue-to-prd /
  issue-intake CI: run the SAME review/edit loop on the generated PRD/slices and
  surface its findings as QUESTIONS (and edits where sensible) into the ISSUE
  COMMENT THREAD, so the human-in-thread loop is FED BY the adversarial review and
  the generated slice is high-quality. Same engine as the slicer edit loop, routed
  to a comment thread instead of `needsAnswers`. Belongs in the issue-intake /
  issue-to-prd design; SHARES the review mechanism (define once, consume from
  multiple surfaces). NOT necessarily the same PRD/slice set as the core review
  work, but should reuse it.

**Principle:** define the review protocol + the slicer edit loop ONCE; the gate, the
pre-build check, the run path, and the issue-thread surface are all CONSUMERS of it
at different insertion points. Avoid N copies of the mechanism.

## What to produce in the grilling pass

1. Promote the idea file's M×N + edit-loop + destination content into `review.md`
   PROPERLY, re-framed per the three concepts above (the PRD currently undersells
   `review-gate-spec` as just "spec/slice review").
2. Resolve the edit-feedback mechanism (concept #2 crux) and the best slice-review
   PROMPT (concept #1 goal-check framing).
3. Record the `reviewMaxRounds` move (gate → edit loop).
4. THEN (separate, on maintainer's go-ahead) slice: `review-gate-spec` (reuse Gate-2
   machinery, slice-framed prompt) and the slicer edit loop (with the maxRounds
   ceiling), keeping `autoslice-confidence` distinct.

(Not slicing now — maintainer will confirm when ready. This note exists so the pass
starts from the resolved framing, not the conflated one.)
