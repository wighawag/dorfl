---
title: batch-qa — gather every open question across work/ into ONE file, answer in one sitting, apply + iterate
slug: batch-qa
humanOnly: true
sliceAfter: [review-skill]
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth:
> `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices.
> (The technical-detail sections below are trimmed by `to-slices` once the work
> is sliced — they move into slices/ADRs and this PRD settles to its durable
> framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

Today the human-in-the-loop is **serialised**: the maintainer processes one slice
at a time, one PR at a time, fielding an agent's questions one at a time, and
re-establishing context for each. Across a populated `work/` (observations, PRDs,
slices) the open judgement is scattered across many files and many sessions. The
cost is not the answering — it is the **per-item context-switch and the waiting**.

The maintainer wants to **batch the judgement**: collect every open question —
across observations, PRDs, and slices — into **one file**, answer them all in a
single sitting, have the answers **applied back** automatically, and **iterate**
until the set is ready (or only non-blocking nits remain). The human stays the
decision-maker; the tool removes the serialisation and the context re-establishing.

## Solution

A runner-agnostic **`batch-qa` skill** (adopt-the-contract methodology → a SKILL,
not an `agent-runner` command, per `docs/adr/methodology-and-skills.md` §8 and the
`review` PRD's precedent). It runs a two-phase, iterating loop over the work items:

0. **BOUND the batch (self-limiting, no orchestration).** The human describes the
   set at invocation in natural language ("just the observations", "the autoslice
   PRDs", "the stuck slices", "everything"). The skill SELECTS from items that are
   **still unresolved** (state lives in the items, not in a side-ledger — see
   below), narrows by the human's description, and self-limits to a context-sized
   chunk if the set is still large. The batch file's HEADER records exactly which
   items are in THIS batch ("the items being studied").
1. **GATHER pass (B→A).** Read the targeted items, run the **`review`** protocol
   (compose — do NOT reimplement; see `work/prd/review.md`) to *surface* latent
   questions, AND collect the *pre-existing* ones (`needsAnswers: true` items +
   their `## Open questions` blocks). Write them all into **one** human-fillable
   file, `work/questions/<date>-batch.md`, with **full inline context + a
   suggested default per question**, so the human never has to open the item.
2. *(the human fills in every answer in that one file — the core win)*
3. **APPLY pass (one step per item).** Read the answered file and, **per scope**,
   advance each item exactly ONE rung (see the one-step invariant below): slice/PRD
   → merge answers + clear `needsAnswers` when fully resolved; promoted observation
   → draft a NEW stub slice/ADR (`needsAnswers` set honestly); a PRD that was
   ALREADY `needsAnswers: false` at run start → slice it (compose `to-slices` →
   `review`). The skill does the work; the human only answered.
4. **ITERATE within this batch.** Re-run GATHER over THIS batch's bounded set. The
   loop **stops when only non-blocking issues remain** (soft floor — NOT a
   zero-findings fixpoint): it still WRITES the non-blocking nits, and the human
   decides whether to keep engaging. It also stops if the human stops answering. It
   never re-asks a resolved question. When the batch is closed, the human starts
   ANOTHER run in a fresh context for the next subset — sequential self-bounding
   batches, no cross-batch orchestration.

### Self-bounding batches: state lives in the ITEMS, not in batch files

The scaling answer is **"do less per run, run again"**, not parallel fan-out:

- **Selection is stateless.** The candidate set for any run is derived fresh from
  current item state — items that STILL have open questions / unresolved review
  findings. A resolved item (its `needsAnswers` cleared, `## Open questions`
  answered in-body by a prior APPLY) naturally drops out. No run needs to remember
  prior runs — the work items ARE the ledger (the WORK-CONTRACT "derive on demand,
  don't maintain a side-list" rule). This is why convergence is guaranteed: each
  closed batch REMOVES items from the pool by resolving them.
- **The batch file is EPHEMERAL** — a one-episode scratch document
  (`work/questions/<date>-batch.md`). Once APPLY has merged its answers into the
  items, its content is redundant; it may be deleted (like a spent observation).
  It is NOT a persistent ledger and the next run does NOT read prior batch files.
- **Non-blocking-only items are SKIPPED by default in later runs** — once the
  human has adjudicated an item down to nits (soft floor), it is considered done
  and drops out of future candidate sets. The READINESS footer lists it under
  "non-blocking only" so the human can EXPLICITLY re-include it, but it never
  re-selects automatically (no cross-run nit treadmill).

### One file, all scopes, `ideas/` excluded — and per-scope question KINDS

A single batch file, single sitting, **no parallelism** (one writer, no conflict).
It spans three scopes, and asks a **different KIND of question per scope** because
the scopes have different "readiness" meanings:

- **`observations/` → TRIAGE.** An observation has no gate; its question is "what
  becomes of this signal?": **promote-to-slice / promote-to-ADR / keep-watching /
  delete**. On "promote-to-slice", the APPLY pass **drafts a NEW `backlog/` slice**
  (the skill has the context) — set `needsAnswers: false` ONLY if the human's answer
  fully specified it, ELSE `needsAnswers: true` with the genuine open questions in
  the body (the usual case — an observation rarely contains a full slice spec).
  This is the key move: the promoted slice lands as **just another item in a state
  `batch-qa` already knows how to advance**, so a FUTURE run picks it up and
  advances it the next step. `batch-qa` never does the full `to-slices` judgement
  in-line; it produces an honestly-flagged stub. (promote-to-ADR drafts a
  `docs/adr/` stub similarly; keep/delete are recorded for the human to action.)
- **`prd/` → SLICE-READINESS.** Are the open questions answered enough to slice?
  (the `humanOnly` × `needsAnswers` axes). APPLY merges answers + clears
  `needsAnswers` where resolved.
- **`backlog/` (+ `in-progress/`?) slices → BUILD-READINESS.** Coherent, no drift
  vs `done/`+ADRs, acceptance criteria sound (the `review` reviewer's lenses).
  APPLY merges answers + clears `needsAnswers` where resolved.
- **`ideas/` → EXCLUDED.** Ideas are incubating proposals, not committed work —
  there is no "is this ready" to force. Left untouched.

### The ONE-STEP invariant (the unifying design rule)

`batch-qa` advances each item **exactly ONE step in its lifecycle, then stops** —
it NEVER runs an item all the way to shipped. This is what makes the tool uniform
across scopes and keeps it a single thin slice:

| scope | before (at RUN START) | one step | after | the NEXT verb (NOT batch-qa) |
|---|---|---|---|---|
| observation | untriaged signal | promote → draft stub | a NEW `backlog/` slice (usually `needsAnswers: true`) | *(a later batch-qa run)* |
| slice | `needsAnswers: true` | answer → apply | `needsAnswers: false` (claim-ready) | **`claim` / `do`** builds it |
| PRD | `needsAnswers: true` | answer → apply | `needsAnswers: false` (slice-ready) | *(see next row — a later run slices it)* |
| **PRD** | **`needsAnswers: false`** | **compose `to-slices` → `review`** | **NEW `backlog/` slices (each usually `needsAnswers: true`)** | *(a later batch-qa run answers them)* |

**Strict one-step (option A).** "Before" is the state **at RUN START**. A PRD you
*answer* this run lands at `needsAnswers: false` and **waits for the NEXT run** to
be sliced — it does NOT get sliced in the same pass (that would be two rungs). Only
a PRD ALREADY `needsAnswers: false` at run start is the slice-step candidate. Same
caveat as observations: a sliced PRD's new slices are `needsAnswers: true` UNLESS
the PRD specified them crisply enough to land `needsAnswers: false`.

Every step produces an item in a state the tool already advances, so the **loop
eats its own output** at EVERY level (observation→slice, PRD→slices, true→false):
the new items re-enter the stateless candidate pool and later runs advance them.
Convergence is the same self-bounding mechanism — no special-casing, and every item
moves exactly one rung per run.

### Composition: batch-qa is glue over the slicer + the review protocol

`batch-qa` builds almost no heavy logic itself — it COMPOSES the slicer + the
review protocol and adds only the batch-file + the human loop + the one-step
dispatch. (Caveat: only `to-slices` exists today; `review` does not — see the open
dependency question.)

- **`to-slices`** (an EXISTING skill in `skills/`) performs the PRD→slices step.
  `batch-qa` does NOT reimplement slicing — this composition is real and available.
- **`review` SKILL** generates the slice/PRD questions (the B pass). This skill is
  `work/prd/review-skill.md` — the review PROTOCOL extracted as a pure,
  runner-agnostic skill that EMITS verdicts (`{approve|block, findings[]}`) and
  writes nothing. `batch-qa` composes it and ROUTES blocking findings into its
  batch file (the skill's emit-vs-route boundary is what makes it reusable here
  AND by the review gates). `batch-qa` `sliceAfter: [review-skill]` — it depends
  ONLY on the small skill, NOT on the heavy review GATES (`review.md`).

The PRD-slice step is a mini-pipeline of those two: `to-slices` (produce) →
`review` (assess) → blocking findings go into the batch file (batch-qa's terminal
VALVE). The AUTONOMOUS slicer (`do prd:` / `autoslice-command`) runs the SAME
pipeline with a different valve: blocking → `needsAnswers` / `needs-attention`
(`review.md` Gate 1). So `needsAnswers` is the unifying lever for both paths.

**Boundary that keeps the skills clean (DECIDED):** review composes ON TOP of
`to-slices` at the TRIGGER/PROMPT layer ("slice, THEN run review"), it is NOT baked
into the `to-slices` skill body. `to-slices` stays a PURE producer so the by-hand
and autonomous callers are not forced into a review they may not want; any caller
(batch-qa, the auto-slicer, a human) MIXES IN review by choice at invocation. This
mirrors `review.md`: "a prompt instruction may sit ON TOP, not instead."

**No-lock human path (assumption for THIS use case):** when the maintainer drives
`batch-qa` with `autoSlice` off (the default) and no agent running, the PRD-slice
step takes the sanctioned no-lock HUMAN slicing path (`auto-slice.md`: "the lock is
mandatory for the agent, optional for the human"). `batch-qa` does NOT need the
slicing lock; if it is ever run where contention is possible, it should defer to
the normal locked `do prd:` path rather than grow its own lock.

### Relationship to the existing gate model (the mismatch — read this)

The existing model (`review.md`, `needsAnswers`, `autoslice-gate`) is **per-item,
binary, and autonomous-runner-facing**: it lets the *agent* make a go/no-go call
on *one* item without a human. `batch-qa` is **cross-scope, human-batching-facing**:
it lets the *human* clear a backlog of judgement in one sitting. They do NOT
conflict and `batch-qa` is NOT a new gate — **it FEEDS the gates**: its output is
"the human answered everything; now these items pass their respective gates." The
gate stays the gate; `batch-qa` is the bulk-resolution front-end to it. The
**observation-triage** pass is the one genuinely-new piece with no home in the
current gate design (observations have no gate); the slice/PRD passes simply reuse
`review` + the `needsAnswers` seam. (Captured as an architectural note in §Further
Notes — a future reader must not mistake this tool for a gate.)

### The batch-file shape (fan-out-friendly by construction)

```
work/questions/<date>-batch.md

# BATCH <date> — studying: <slug>, <slug>, <slug>, …   (the items in THIS batch)
#   (ephemeral: delete after APPLY merges answers into the items)

## OBSERVATIONS (triage: promote-to-slice / promote-to-ADR / keep / delete)
### <slug>  [observation]
  context: <the spotted signal, inline>
  Q: still real? disposition? → [promote-slice | promote-adr | keep | delete]
  > ANSWER:

## PRDS (slice-readiness)
### <slug>  [prd · needsAnswers: <yes/no>]
  Q (reviewer-surfaced or pre-existing): <question>   [suggested default: …]
  > ANSWER:

## SLICES (build-readiness)
### <slug>  [slice · needsAnswers: true — BLOCKING]
  context: <the ## Open questions block, inline>
  Q1: <question>   [suggested default: …]
  > ANSWER:
  #### non-blocking nits (recorded; do NOT block readiness)
  N1: …

## READINESS (<date>, round <n>)
  READY: <slugs that now pass their gate>
  OPEN (blocking): <slugs still needing answers>
  NON-BLOCKING ONLY: <slugs with only nits left — human's call to continue>
```

## User Stories

1. As the maintainer, I want **one file** collecting every open question across
   observations, PRDs, and slices, so that I answer them in a single sitting
   instead of one item at a time across many sessions.
2. As the maintainer, I want each question to carry **enough inline context + a
   suggested default**, so that I can answer without opening the source item.
3. As the maintainer, I want the gather pass to **run the `review` protocol** so it
   *surfaces latent* questions (B), not only collect the ones already written (A) —
   the full B→A pipeline.
4. As the maintainer, I want an **APPLY pass** that writes my answers back into the
   item bodies and clears `needsAnswers` where fully resolved, so I never hand-edit
   each file.
5. As the maintainer, for an **observation** I want to choose
   promote-to-slice / promote-to-ADR / keep / delete, and have the skill **draft**
   the produced slice/ADR — the skill does the work, I only decide.
6. As the maintainer, I want the loop to **iterate B→A** and **stop when only
   non-blocking issues remain**, still recording those nits, so I am never trapped
   on a treadmill but may choose to keep engaging.
7. As the maintainer, I want a **readiness report** each round (READY / OPEN /
   NON-BLOCKING-ONLY) so I can see what is now claim/slice-eligible.
7a. As the maintainer, I want to **describe the batch's scope at invocation**
    ("just the observations", "the autoslice PRDs", "everything"), and have the
    skill **self-limit** to a context-sized chunk and **record the studied set**
    in the batch-file header, so large work/ sets are handled by running again on
    the next subset — no orchestration.
7b. As the maintainer, I want selection to be **stateless** (derived from which
    items still have open questions), so a fresh run never re-asks resolved items
    and never needs to read prior batch files — the items are the ledger.
8. As the maintainer, I want `ideas/` left untouched, so incubating proposals are
   not forced into a readiness decision.
9. As the maintainer, I want the skill to **never auto-commit, delete, or move**
   files — it leaves drafts/edits in the working tree for me to review and commit
   (repo git etiquette).
10. As the maintainer, I want the design to **compose the review protocol** (its
    lenses + the `needsAnswers`/needs-attention routing seam), not fork a second
    reviewer — once it exists as a skill (today `review` is an unbuilt PRD; see the
    open dependency question).
10a. As the maintainer, for a PRD that is ALREADY `needsAnswers: false` at run
     start, I want batch-qa to **slice it by composing `to-slices` then `review`**
     (emitting new `needsAnswers`-flagged slices), so slicing is part of the batch
     — reusing the existing slicer, NOT a reimplementation, and on the no-lock
     human path (autoSlice off, me driving).
10b. As the maintainer, I want **review composed ON TOP of `to-slices`** at the
     trigger layer (not baked into the slicer), so the by-hand and autonomous
     callers stay free to slice without review and `review` stays the single
     source of the protocol.
11. As the maintainer, I want the tool to be understood as a **front-end that
    FEEDS the per-item gates**, never a replacement gate, so the autonomy model
    stays coherent.

### Autonomy notes (the two gate axes)

- **`humanOnly: true` (this PRD, DECIDED):** a human must drive the *slicing* of
  this PRD. It reshapes the human-in-the-loop workflow and deliberately blends a
  new triage notion with the existing gate model — judgement-heavy, so a human
  cuts the slices. (Disjoint from the emitted slices' own gates; a slice like
  "parse frontmatter + collect `needsAnswers` items" is plainly agent-buildable.)
- **`needsAnswers`:** none open. The earlier open dependency question — how
  `batch-qa` obtains its review (B) pass when no `review` skill existed — is
  RESOLVED (2026-06-06): the review PROTOCOL was split out of `review.md` into its
  own skill PRD (`work/prd/review-skill.md`), built first, and `batch-qa`
  `sliceAfter: [review-skill]` composes it. `batch-qa` depends only on the small
  skill, never on the heavy review gates. Everything else (scope set,
  one-file/no-parallelism, soft-floor stop, one-step invariant, the `to-slices`
  composition, per-scope question kinds) was already decided.

## Implementation Decisions

- **A SKILL, single-context first.** One skill, reads the targeted items into one
  context, runs review + gather + apply. The mechanical bits (list folders, parse
  frontmatter, find `needsAnswers`/`## Open questions`) reuse the existing readers
  (`frontmatter.ts`, the ledger-read seam) where a thin command later helps, but
  the core is methodology → skill.
- **Compose with `review`, do not reimplement.** Use `review`'s four adversarial
  lenses (claim-vs-code, cleanup-vs-behaviour, cross-slice composition, the
  destination check) for the slice/PRD question generation, and route resolution
  through the SAME `needsAnswers` seam. `batch-qa` adds only the **observation-
  triage** pass and the **one-file human-batching** layer on top.
- **Self-bounding batches, NOT fan-out.** The human describes the set at
  invocation; the skill derives the still-unresolved candidates, narrows to that
  description, self-limits to a context-sized chunk, and records the studied set
  in the batch-file header. Scaling = run again on the next subset. No orchestrator,
  no parallel-merge. (Rejected alternative — see Out of Scope.)
- **Output contract = the batch file** (`work/questions/<date>-batch.md`),
  a HEADER listing the studied items, per-item sections, inline context, suggested
  defaults, READINESS footer. Ephemeral (deletable after APPLY).
- **APPLY is scope-dispatched + obeys the one-step invariant:** slice/PRD → merge
  answer + clear `needsAnswers` when fully resolved (advance one step, do NOT
  build/slice); observation → draft a NEW `backlog/` slice (or `docs/adr/` stub)
  with `needsAnswers` set HONESTLY (true unless the answer fully specified it),
  then STOP — a later run advances that stub. The promotion humility-check mirrors
  the auto-slicer's: NEVER emit an under-specified slice as if it were ready.
  Never auto-commit/delete/move.
- **Stop rule = soft floor:** halt when no BLOCKING questions remain (non-blocking
  nits are written but do not keep the loop alive); the human may opt to continue.

## Testing Decisions

- Test the **gather→file** and **file→apply** halves at the file seam: given
  fixture items with known `needsAnswers`/`## Open questions`, assert the batch
  file contains the expected per-scope sections + inline context; given an
  answered fixture batch file, assert APPLY merges answers, clears `needsAnswers`
  only where fully resolved, and (for a promoted observation) drafts the expected
  slice/ADR file — and that nothing is committed/deleted/moved.
- Stub the harness/`review` verdict (as the autoslice/review slices do) to test
  the BLOCKING vs non-blocking split and the soft-floor stop rule deterministically.
- Isolate any shared/global writes per the slice-template shared-location rule;
  all fixtures in temp dirs; assert the real `work/` is untouched.

## Out of Scope

- **Parallel fan-out / context-splitting orchestration — REJECTED.** We considered
  splitting a large set across parallel review sub-contexts that merge into one
  batch file. Rejected in favour of **sequential self-bounding batches** (the human
  describes the set; the skill bounds to a context-sized chunk; run again for the
  next subset; state lives in the items so selection is stateless): it needs ZERO
  orchestration and no merge step, and the human answers sequentially anyway. The
  only cost is wall-clock (sequential runs), which is the right trade for a
  human-in-the-loop tool.
- **`ideas/`** — excluded by decision (incubating, no readiness gate).
- **A thin `agent-runner` convenience command** wrapping the mechanical scan — the
  skill stays authoritative; a command is optional and later (mirrors `setup`).
- **Replacing the per-item gates** — `batch-qa` feeds them, never replaces them.
- **`in-progress/` slices** — default to `backlog/`; including in-progress is a
  later toggle if useful (an in-progress item is mid-build, less likely to need
  batch triage).
- **Advancing an item MORE than one step in a single pass** — out by the one-step
  invariant. A promoted observation becomes a `needsAnswers: true` stub and STOPS;
  a PRD answered THIS run lands `needsAnswers: false` and STOPS (sliced on the
  next run); fleshing things out is always a SEPARATE later run, not deferred work
  owed by this slice. (This is why no follow-up slices are owed — each one-step
  output IS complete for that rung.)
- **Baking review INTO `to-slices` — REJECTED.** Review composes on-top at the
  trigger layer (so by-hand / autonomous callers aren't forced into it and the
  `review` skill stays the single source). `to-slices` stays a pure producer.
- **`batch-qa` growing its own slicing or its own slicing lock — REJECTED.** It
  composes the existing `to-slices` and rides the sanctioned no-lock human path;
  contended slicing stays the locked `do prd:` path's job.

## Further Notes

- **Architectural note to preserve (the gate-model mismatch):** the existing gate
  model is **per-item, binary, autonomous-runner-facing** (let the agent proceed
  without a human); `batch-qa` is **cross-scope, human-batching-facing** (let the
  human clear judgement in bulk). They **compose** — `batch-qa` FEEDS the gates —
  and `batch-qa` is NOT itself a gate. The observation-triage pass is the only
  genuinely-new mechanism (observations have no gate today). This framing must
  survive into the slices/ADR so no future reader mistakes the tool for a gate.
- **Composes with `work/prd/review.md`** (reviewer lenses + `needsAnswers` seam)
  and reuses the `needsAnswers` / `## Open questions` convention already in
  `slice-template.md` and live slices (`agent-interactive-launch`,
  `propose-pr-body`).
- **Git etiquette:** the skill writes the batch file + applies edits/drafts into
  the working tree and REPORTS paths; it never stages/commits/pushes/deletes/moves
  — the maintainer reviews and commits (consistent with `to-prd`/`to-slices`).
