---
name: wighawag-work-slices
description: "Break a PRD, plan, or design doc into independently-grabbable, file-based work slices stored as markdown in a repo's work/ folder, using tracer-bullet vertical slices. Use when the user wants to turn a plan into work items, create implementation tickets as files (not an issue tracker), slice a design into AFK-grabbable units, or set up file-based work tracking for parallel agents."
---

# wighawag-work-slices

Turn a plan/PRD/design doc into **tracer-bullet vertical slices**, written as one
markdown file per slice into a repo's `work/backlog/` folder. This is the
file-based equivalent of converting a plan into issues — the source of truth is
**git markdown**, not an external issue tracker, so it stays versioned with the
code and works offline.

This skill is the **producer** of `work/` items. A separate lifecycle skill
*consumes* them (claim → in-progress → done). This skill defines the on-disk
contract both share.

## When to use vs. not

- **Use** when slicing a `work/prd/*.md`, a design doc, or a plan into grabbable
  units for solo-with-agents (incl. parallel AFK) work.
- **Don't** use to *write* the PRD (that's a separate step) or to *claim/run* a
  slice (that's the lifecycle skill). Don't introduce a shared index file or a
  status field — status is the folder (see [WORK-CONTRACT.md](WORK-CONTRACT.md)).

## Process

### 1. Locate / confirm the source

Work from a `work/prd/<slug>.md`, a design doc, or the conversation context. If
the source is a path, read it fully. The `work/` folder lives **inside the target
project repo** (versioned with its code), like the existing `tasks/` convention.

### 2. Explore the codebase (if not already)

Slice titles and descriptions use the project's domain glossary. Respect ADRs /
findings in the area you're touching.

### 3. Draft vertical slices

Each slice is a **tracer bullet** — a thin path through ALL layers end-to-end, not
a horizontal slice of one layer.

- Each slice delivers a narrow but COMPLETE path (schema → logic → API/UI → tests).
- A completed slice is demoable/verifiable on its own.
- Prefer many thin slices over few thick ones.
- Set the **`afk` gate** on each: `afk: true` (can be built and merged
  unattended), `afk: false` (needs a human decision/review), or omit it (leave the
  claim decision to the runner's policy). Prefer `afk: true`; mark `blocked_by`
  for ordering. See [WORK-CONTRACT.md](WORK-CONTRACT.md) for the gate semantics.
- **Prefer file-orthogonal slices to minimise merge conflicts.** `blocked_by`
  encodes logical ordering, but two independent slices that edit the SAME files
  will conflict when the second integrates after the first. Parallel agents make
  this real. So: slice along file/module boundaries where you can; and when two
  slices are known to touch the same module, add a `blocked_by` to **serialize**
  them even if there's no strict logical dependency. The runner only
  rebases-or-surfaces conflicts (it never auto-resolves), so avoiding them at
  slice time is the cheap win.

### 3b. Apply the PRD's human-only guidance

If the source PRD flagged certain user stories / areas as **human-only** (a
product/design/security/judgement call an agent should not make unattended — see
the `to-prd` skill: it records this as PROSE, not a machine field), set the
slice's human-only gate on the covering slices. The slice carries the
authoritative gate; the PRD prose is the input that informed it. (Gate field name
+ semantics: see [WORK-CONTRACT.md](WORK-CONTRACT.md).)

### 4. Quiz the user

Present the breakdown as a numbered list — Title, the human-only gate, Blocked-by,
and (if the source has them) which user stories it covers. Ask: granularity
right? dependencies right? merge/split any? gate correct? Iterate until approved.

### 5. Write the slice files

For each approved slice, write `work/backlog/<slug>.md` using
[slice-template.md](slice-template.md). Create `work/` and `work/backlog/` lazily
if absent. One file per slice. Use a content-derived slug, never a counter. Fill
`blocked_by` with the slugs of blocking slices, and set the **required `prd`**
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
designed to support (consumed by the lifecycle skill) is in
[CLAIM-PROTOCOL.md](CLAIM-PROTOCOL.md) — read it so the files you emit are
claim-ready, but this skill does not itself claim or run slices.
