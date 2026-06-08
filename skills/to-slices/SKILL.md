---
name: to-slices
description: "Break a PRD, plan, or design doc into independently-grabbable, file-based work slices stored as markdown in a repo's work/ folder, using tracer-bullet vertical slices. Use when the user wants to turn a plan into work items, create implementation tickets as files (not an issue tracker), slice a design into AFK-grabbable units, or set up file-based work tracking for parallel agents."
---

# to-slices

Turn a plan/PRD/design doc into **tracer-bullet vertical slices**, written as one
markdown file per slice into a repo's `work/backlog/` folder. This is the
file-based equivalent of converting a plan into issues — the source of truth is
**git markdown**, not an external issue tracker, so it stays versioned with the
code and works offline.

This skill is the **producer** of `work/` items. The **runner** consumes them —
`agent-runner claim`/`start`/`do`/`complete` walk a slice claim → in-progress → done
(driven across a backlog by the `drive-backlog` / `orchestrate` conductor skills).
This skill defines the on-disk contract they share.

## When to use vs. not

- **Use** when slicing a `work/prd/*.md`, a design doc, or a plan into grabbable
  units for solo-with-agents (incl. parallel AFK) work.
- **Don't** use to *write* the PRD (that's a separate step) or to *claim/run* a
  slice (that's the runner: `agent-runner claim`/`do`/`complete`, or the
  `drive-backlog` conductor). Don't introduce a shared index file or a status field
  — status is the folder (see [WORK-CONTRACT.md](WORK-CONTRACT.md)).

## Process

### 1. Locate / confirm the source

Work from a `work/prd/<slug>.md`, a design doc, or the conversation context. If
the source is a path, read it fully. The `work/` folder lives **inside the target
project repo** (versioned with its code), like the existing `tasks/` convention.

### 2. Explore the codebase (if not already)

Slice titles and descriptions use the project's domain glossary. Respect ADRs /
findings in the area you're touching.

**Check the PRD against reality first (drift = a needs-attention signal).** A PRD
is a launch snapshot and may have DRIFTED from what has since landed (`done/`,
ADRs, sibling slices). Before slicing, verify its assumptions still hold. If it
has drifted such that slicing it as-is would emit slices built on a false premise,
do NOT slice it: set `needsAnswers: true` on the PRD with the discrepancy in its
body (or fix a small certain factual error first). See WORK-CONTRACT.md “Drift is
a needs-attention signal”. Never emit slices from a stale spec.

### 3. Draft vertical slices

Each slice is a **tracer bullet** — a thin path through ALL layers end-to-end, not
a horizontal slice of one layer.

- Each slice delivers a narrow but COMPLETE path (schema → logic → API/UI → tests).
- A completed slice is demoable/verifiable on its own.
- Prefer many thin slices over few thick ones.
- Set the **two gate axes** ONLY where they apply (both default to OMITTED on
  most slices): **`humanOnly: true`** = a HUMAN must drive the build
  (product/design/security/judgement — the DECIDED axis); **`needsAnswers: true`**
  = unresolved questions block autonomous work (the DISCOVERED axis — list the
  questions in the slice body). Omitted on either means "undeclared"; whether an
  agent may then claim is the *repo's* `allowAgents` policy. Mark `blockedBy` for
  ordering. See [WORK-CONTRACT.md](WORK-CONTRACT.md) for the two-axis semantics,
  the predicate, and the `allowAgents` precedence.
  - **A slice's `humanOnly` is decided from the nature of BUILDING THAT SLICE —
    never inherited from the PRD.** Evaluate each slice on its own merits (does
    *building it* need human judgement/security/secrets?), AS IF the PRD's
    `humanOnly` field did not exist. (The two flags are disjoint — see §3b.)
  - **Do NOT be shy about `needsAnswers` — when genuinely unsure, FLAG, don't
    guess.** `needsAnswers` is cheap (a human clears it in seconds) and a
    confidently-underspecified slice is expensive (an agent builds the wrong thing,
    convincingly). Empirically, defects concentrate in SLICING far more than in
    implementation: an ambiguous premise, an unresolved design fork, a "reuse X"
    where X's shape is unverified, or a seam you *assume* exists — each is a
    `needsAnswers` with the open question written in the body, NOT a guess dressed
    as a spec. The asymmetry is the whole point: a false `needsAnswers` costs one
    human glance; a false confidence ships wrong-but-compiling work.
- **Prefer file-orthogonal slices to minimise merge conflicts.** `blockedBy`
  encodes logical ordering, but two independent slices that edit the SAME files
  will conflict when the second integrates after the first. Parallel agents make
  this real. So: slice along file/module boundaries where you can; and when two
  slices are known to touch the same module, add a `blockedBy` to **serialize**
  them even if there's no strict logical dependency. The runner only
  rebases-or-surfaces conflicts (it never auto-resolves), so avoiding them at
  slice time is the cheap win.

### 3b. PRD gate vs slice gate are DISJOINT + honour cross-PRD `sliceAfter`

- **`humanOnly` on a PRD and `humanOnly` on a slice are DISJOINT — they gate
  different verbs and DO NOT flow into each other.**
  - **PRD `humanOnly`** gates *slicing*: its ONLY effect is that an agent may not
    **auto-slice** that PRD (even where the repo's `autoSlice` policy is on); a
    human must drive the decomposition. That is its entire meaning.
  - **Slice `humanOnly`** gates *building*: it is decided per slice from the
    nature of building that slice (see §3), independently.
  - There is **NO inheritance, NO propagation, and NOT EVEN A HINT** from the PRD
    flag to the slice flags. A `humanOnly: true` PRD can produce entirely
    agent-buildable slices; an un-flagged PRD can produce some `humanOnly` slices.
    When setting a slice's gate, ignore the PRD's `humanOnly` entirely.
  - Likewise **`needsAnswers`**: on a PRD it blocks auto-slicing until the
    questions are answered; on a slice it blocks auto-building. Set a slice's
    `needsAnswers` only when *that slice* has unresolved questions (list them in
    its body) — not because the PRD had open questions (a PRD with open questions
    should be resolved BEFORE slicing, not slice-inherited).
  - (A PRD's body may still *describe* which areas are judgement-heavy — use that
    as ordinary domain input when reasoning about a slice's own build-nature, the
    same as any other PRD prose; it is not a flag-setting shortcut.)
- **`sliceAfter` (cross-PRD order).** If this PRD has `sliceAfter: [other-prd]`,
  those PRDs must already be SLICED (their slices exist) before you slice this one
  — so this PRD's slices can reference the real slugs of those PRDs' slices in
  `blockedBy`. (The auto-slicer enforces this; a human may slice anyway but must
  then know the blocker slugs.) If a needed blocker PRD is not yet sliced, slice
  it first or record the dependency and stop.

### 4. Quiz the user — OR (no human present) do a confidence check

**If a human is present** (the normal interactive path): present the breakdown as
a numbered list — Title, the two gate axes, Blocked-by, and (if the source has
them) which user stories it covers. Ask: granularity right? dependencies right?
merge/split any? gates correct? Iterate until approved.

**If NO human is present** (an agent auto-slicing in CI): step 4 is replaced by a
**confidence check**, because there is no one to quiz. Do NOT emit guessed slices.
The source PRD should already be clear (the auto-slicer only runs on a PRD that is
not `humanOnly` and not `needsAnswers`). If, while slicing, ANY of {granularity,
dependency order, a gate, a seam} is genuinely unresolved by the PRD/ADR, do not
guess: either set `needsAnswers: true` (with the open questions in the body) on
the specific uncertain slice, or — if the whole decomposition is unclear — stop
and route the PRD to `needs-attention/` with the questions, rather than emitting a
wrongly-cut slice. Only emit slices you would have gotten the human to approve.

### 5. Write the slice files

For each approved slice, write `work/backlog/<slug>.md` using
[slice-template.md](slice-template.md). Create `work/` and `work/backlog/` lazily
if absent. One file per slice. Use a content-derived slug, never a counter. Fill
`blockedBy` with the slugs of blocking slices, and set the **required `prd`**
field to the slug of the source `work/prd/<slug>.md` (so `covers` story numbers
are unambiguous — see [WORK-CONTRACT.md](WORK-CONTRACT.md)).

### 6. Trim the PRD to its durable framing (one-time)

The PRD is a launch snapshot (see the `to-prd` skill). Now that the work is
sliced, the PRD's **technical detail is redundant** (it lives in the slices) and
is the part that would otherwise go stale. Do a ONE-TIME trim:

- The slices now own *what to build* (Implementation/Testing detail) — remove
  those sections from the PRD.
- Any **durable rationale** worth keeping (the *why* of a decision) is RELOCATED
  to an ADR (`docs/adr/<slug>.md`), not deleted.
- The PRD settles to its durable framing: Problem / Solution / User Stories /
  Out of Scope (+ its launch-snapshot banner). Leave a one-line pointer that
  detail moved to slices/ADRs.
- **Mark the PRD as sliced** so it's clear it has been incorporated: add a
  `sliced: <YYYY-MM-DD>` line to its frontmatter (and/or a top banner note "Sliced
  into work/backlog/ on <date> — detail trimmed to slices/ADRs"). A reader then
  knows the PRD is a launched-and-sliced snapshot, not a pending plan.

This is a hand-off transition, not ongoing maintenance — after this single trim
the PRD is stable because the stale-prone part was relocated, not because it is
kept in sync. (Nothing is lost: detail → slices; rationale → ADR.)

**Git protocol:** do NOT stage/commit/push — leave the new/edited files unstaged
so the user can inspect them. Report the exact paths written (and the trimmed PRD).

## The on-disk contract

The full `work/` layout, slug rules, and frontmatter are in
[WORK-CONTRACT.md](WORK-CONTRACT.md). The claim/lifecycle protocol these files are
designed to support (consumed by the runner — `agent-runner claim`/`do`/`complete`)
is in [CLAIM-PROTOCOL.md](CLAIM-PROTOCOL.md) — read it so the files you emit are
claim-ready, but this skill does not itself claim or run slices.
