---
title: folder taxonomy reorg (one lifecycle umbrella) + a needsAnswers edit-handshake command
slug: folder-taxonomy-and-prd-edit-handshake
type: idea
status: incubating
---

> **UPDATE 2026-06-08 — the sliced-PRD folder split is now DECIDED (reversing one
> rejection below) and spun into its own PRD `work/prd/slicing-coherence.md`.** A
> design session (during the `do prd:advance-loop` test-drive) settled three
> coupled decisions that this idea had left open or rejected. They are recorded in
> the new `## DECIDED 2026-06-08` section at the end (and the affected REJECTED
> bullet is annotated inline). The folder-NAME bikeshed below is also resolved:
> the sliced-PRD folder is **`prd-sliced/`**. The `<build>/<design>/<notes>`
> umbrella reorg remains an incubating idea; only the PRD-state folder family
> (`prd/` → `slicing/` → `prd-sliced/`) is being acted on now.

# Folder taxonomy: regroup the lifecycle under one umbrella (names DEFERRED)

> Captured from a design conversation (2026-06-06). This is an **idea, not a
> decision** — the maintainer is deliberately on the fence about whether to reorg
> at all. NOT an ADR (an ADR records a decision WE made; this is "we might"). It
> incubates here until/unless it becomes a PRD. The folder shape below is the
> proposed *structure*; the **names are explicitly undecided**.

## The discomfort that started it

`work/` today is two governance regimes wearing one folder (per
`skills/to-slices/WORK-CONTRACT.md`): a **state machine** (`backlog →
in-progress → needs-attention → done`/`out-of-scope`, status = folder, flows via
CAS `git mv`) AND **capture buckets** (`ideas`/`observations`/`findings` — notes
that don't flow, leave only by deletion). The wish was to make the folders express
that seam, so each tree means one thing.

## Proposed SHAPE (names deferred — see below)

```
<lifecycle-umbrella>/        # the path from intent to shipped code
  <design>/                  # "deciding WHAT" — MIXED regime (intentionally not pure)
    ideas/<slug>.md          #   capture: proposed, pre-PRD — editable, deletable
    prd/<slug>.md            #   source: the living, mutable, re-sliceable north-star
    slicing/<slug>.md        #   the HELD LOCK (CAS, via the seam); absence from prd/ = hands-off
  <build>/                   # "BUILDING it" — PURE state machine, every folder flows
    backlog/  in-progress/  needs-attention/  done/  out-of-scope/
  <notes>/                   # capture — NOT flow, leave only by deletion
    observations/  findings/

docs/
  adr/<slug>.md              # our decisions + why — stays SEPARATE (reference, not lifecycle)
```

Two top-level concepts only: the lifecycle umbrella + `docs/` (you can't fold ADRs
into the lifecycle without lying — ADRs are *consulted by* the flow, not *moved
through* it).

## Decisions baked into the shape (the durable reasoning to preserve)

- **`<build>/` is a pure state machine** — this is the real consistency win the
  conversation was after: every folder is a status, every move is a CAS `git mv`,
  one rule, no exceptions. Pulling capture buckets out is what achieves it.
- **`<design>/` is a coherent grouping but deliberately NOT a pure state machine.**
  It mixes capture (`ideas`) + mutable source (`prd`) + a lock (`slicing`). That
  mix is honest: **PRDs are living documents, not flowing tokens.** Forcing
  `<design>/` into a clean `to-slice → being-sliced → sliced` machine is
  over-purity applied to an inherently mixed bag.

## REJECTED options (record so they aren't re-litigated)

- **`to-slice` / `being-sliced` / `sliced` as folders.** ~~Rejected~~ **PARTLY
  REVERSED 2026-06-08 — see `## DECIDED 2026-06-08`.** Originally rejected for two
  reasons: (1) the flow is **non-terminal** — a PRD goes `prd → slicing → prd`
  (the lock returns it) and gets **re-sliced** (PRDs are reshaped; `auto-slice.md`
  itself has a "RESHAPED" banner yet is `sliced:`), so `sliced/` is not a
  `done/`-like resting state; making it one needs a banned bidirectional `sliced →
  to-slice` move. (2) sliced-ness is **derivable / already a marker** —
  `autoslice-gate.md` resolves `sliceAfter` against the **`sliced:` frontmatter
  marker (NOT `done/`)**; encoding it as a folder re-materializes a derivable state
  (double-write + drift). **Both objections are now answered, not dodged:** (1)
  re-slice = `prd-sliced/ → prd/` is the LEGITIMATE analogue of the existing
  `done/ → backlog/` reopen ("minus done" makes the model fit, it does not need a
  banned move); (2) the FOLDER becomes the source of truth and `sliced:` becomes a
  derived COPY written by the single release-transition owner (no drift by
  construction — same atomicity advance-loop US #11 already requires), exactly as
  `done/` is canonical for slices with NO `done:` marker. `sliceAfter` then reads
  the folder (mirroring `blockedBy` → `done/`). The NAMING half of this bullet
  stands: it is `prd-sliced/` (NOT a bare `sliced/`, which would sit confusingly
  beside the `slicing/` LOCK folder), and there is still ONE `slicing/` lock
  folder. See `## DECIDED 2026-06-08`.
- **`findings/` under `docs/`.** Rejected: `docs/adr/` is **endogenous** ("why did
  WE decide X", reader = a future maintainer of THIS code); `findings/` is
  **exogenous** (verified external/domain ground truth — an API, a protocol, pi's
  behaviour — true even if our project vanished). Different polarity/audience;
  `docs/` proximity would invite internal post-mortems to be mis-filed as findings
  (the exact confusion WORK-CONTRACT.md warns against). Findings stay in the
  lifecycle (`<notes>/findings/`), where slices reference them as build-input.
- **Keeping it as 3+ separate top-levels (`design/`, `work/`, `notes/`).** Three
  trees for "the same lifecycle in stages" is too many; regroup under one umbrella
  with the meaning carried by subfolders.

## DEFERRED — names + a swappable-paths enabler

- **Names are NOT decided** (`<lifecycle-umbrella>`, `<design>`, `<build>`,
  `<notes>` are placeholders). `flow/` was the leading umbrella candidate (it
  names the through-line); `work/`-as-umbrella was the lower-churn fallback but
  overloads a name that today means the build state machine. Decide names when/if
  this becomes a PRD — don't bikeshed now.
- **Swappable folder paths (do this EVEN IF the reorg never happens).** Centralise
  the hardcoded `work/...` path strings (code + skills) behind a single source of
  truth (a constants module / config). It makes any future rename a one-line change
  instead of a repo-wide find-replace, and de-risks this reorg specifically. Cheap,
  independently valuable, and the natural first slice if the reorg is adopted.

## Cheap wins available NOW on the CURRENT layout (no reorg required)

- **README-per-folder** (the original ergonomics ask): doubles as `.gitkeep` AND
  documents what each folder is for — solves the empty-folder + "what goes here"
  problem today. Make it the canonical form (generated by a `setup`/`init` step;
  see `work/ideas/setup-and-migrate-skills.md`), and have skills treat
  "folder absent" == "folder empty" so nothing breaks if deleted. Opinionated
  default, graceful when absent — not a configurable format the protocol must
  branch on.
- **One WORK-CONTRACT clarification sentence** (true regardless of the reorg):
  *"PRDs are mutable source documents, not flowing work tokens; `slicing/` is a
  held lock, not a status; sliced-ness is the `sliced:` marker."* This resolves the
  latent tension where the contract says "capture buckets don't flow" while the
  `slicing/` lock plainly makes a PRD flow.

# A `needsAnswers` edit-handshake command (sibling idea)

> **SUPERSEDED 2026-06-07 by the advance-loop design
> (`work/ideas/advance-loop-question-answer-protocol.md`).** The mechanism below
> RELIED on `needsAnswers: true` meaning "agents stay away" (the gate is
> `needsAnswers !== true`), so flipping it gave a human a safe edit window. The
> advance-loop BREAKS that premise: `advance` ACTS ON `needsAnswers: true` items
> (surfacing/applying answers is its whole point), so `needsAnswers` can no longer
> double as the human edit-lock. The REPLACEMENT: the human edit-handshake takes the
> **transition lock (the "answer/edit" kind) via the same CAS seam** the autonomous
> driver uses — human and driver contend honestly on ONE lock primitive (which is
> just the existing claim/slicing CAS, generalised to kinds). `needsAnswers` reverts
> to the pure answer-required axis. Keep the rest of this idea (the handshake is
> still wanted; only its MECHANISM changes from flag-flip to lock-take). The
> original text is preserved below for history.

Spawned by `work/observations/slicing-lock-does-not-stabilise-prd-content.md`. A
human who wants to edit a PRD safely while agents might slice it should be able to
**flip `needsAnswers: true` via the seam CAS** and be told win/lose: if the flip
lands, no slicer will start (the gate is `needsAnswers !== true`) and any in-flight
slice fails the release-rebase backstop → safe to edit. This makes the existing
two-axis gate the human-facing edit lock; the command is a thin CAS wrapper. Small
follow-up — becomes its own slice when prioritised, likely alongside the
`autoslice-lock` rebase amendment.

## DECIDED 2026-06-08 (the PRD-state folder family + slicing-path coherence)

Settled during the `do prd:advance-loop` test-drive. These are spun into a small
precursor PRD `work/prd/slicing-coherence.md` (to be sliced + built BEFORE
advance-loop, because advance-loop's tick assumes one integrate back-half for
every rung and a coherent sliced-PRD model). Background:
`work/observations/slice-output-bypasses-integration-vs-build.md`.

### D1 — PRDs flow through the SAME shape as slices ("minus done")
The PRD lifecycle mirrors the build state machine, one rung shorter:

| build | PRD | meaning |
|---|---|---|
| `backlog/` | `prd/` | ready to slice (the "what needs slicing" human glance) |
| `in-progress/` | `slicing/` | locked, being sliced (the held lock — exists today) |
| `done/` | **`prd-sliced/`** | sliced, resting |

- **Folder = source of truth** (like `done/` for slices). `sliced:` frontmatter
  becomes a DERIVED COPY, written by the single release-transition owner in the
  same commit (no drift). Re-slice = `prd-sliced/ → prd/` (reopen-to-ready,
  mirroring `done/ → backlog/`).
- **`sliceAfter` reads the FOLDER** (`prd-sliced/<dep>.md`), mirroring `blockedBy`
  → `done/`. Today it reads the `sliced:` marker via `slicedSlugs` built in TWO
  spots (`slicing.ts:readSlicedSlugs`, `ledger-read.ts:resolvePrdPool`); both flip
  to folder-residence, downstream (`slicing-eligibility`, `select-priority`)
  unchanged (they only see the derived `Set`).
- **Two-step migration** (mirrors the `allowAgents→autoBuild` rename sequencing):
  STEP A introduces `prd-sliced/` as canonical + keeps `sliced:` as a derived
  copy + flips readers to the folder + backfills existing `sliced:` PRDs into
  `prd-sliced/`. STEP B (sequenced LAST) deletes the `sliced:` marker entirely
  once nothing reads it.
- **Name:** `prd-sliced/` (NOT bare `sliced/` — too close to the `slicing/` LOCK
  folder; the `prd-` prefix keeps the three PRD-state folders reading as a family).

### D2 — slice OUTPUT integrates through `performIntegration` (gets propose/PR)
The slicing LOCK on `main` is CORRECT and consistent with the build CLAIM (both are
the ledger-write CAS, move-into-a-status-folder on the visibility ref — see
`docs/adr/claim-ledger-vs-protected-main.md`). The inconsistency is the OUTPUT:
slicing commits its `work/backlog/*` straight to `main` and bypasses
`performIntegration` (its doc-comment says so), so it has NO `--propose`/PR mode —
why CI can't put slices in a PR (advance-loop US #27). FIX: route slice output
through `performIntegration` (the shared back-half in `src/integration-core.ts`)
so `do prd:<slug>` honors `--propose`/`--merge` like `do slice:<slug>`. The
agent's slicing WORK can run in-place-on-a-branch like `do slice:` already does
(branch ≠ worktree; the isolation seam decides). This is the KEYSTONE: it makes
"all `do slice:` args apply to `do prd:`" true BY CONSTRUCTION (integrate-time args
resolve in the shared core).

### D3 — the slice review model mirrors the build review model exactly (TWO flag families)
Two DISTINCT review concepts on the slice path, each its own NON-OVERLAPPING flag
family, mirroring build's `improve → gate-review → integrate`:

1. **The slicer IMPROVER loop** (`slicer-review-loop.ts`, review→edit→converge,
   in-context, EDITS between passes, makes slices BETTER) — SLICE-PATH ONLY (cannot
   exist on the build path), so it gets a `--slicer-loop-*` family that is
   unmistakably distinct from the gate's `--review-*` (and cannot be confused with
   the build `--review-max-rounds`):
   - `--slicer-loop` / `--no-slicer-loop` (on/off; on by default)
   - `--slicer-loop-max <n>` (convergence cap; today's `maxReview`, default 3)
   - `--slicer-loop-model <id>` (the loop reviewer's de-correlated model; the seam
     ALREADY EXISTS internally as the loop's `reviewModel` — RENAME that field to
     `slicerLoopModel` so the code stops sharing a name with the gate's
     `reviewModel`, and expose it as this flag)
   PROMPT FIX: it must review the WHOLE SET (graph coherence, gaps, overlap, "does
   the set compose into the PRD goal") — the `review` skill ALREADY has a "set of
   slices" mode; the loop just isn't using it at the set level today.
2. **The acceptance GATE** (fresh context, BEFORE integrate, → needs-attention on
   block) — the slice-path mirror of build's Gate-2, riding the `performIntegration`
   review-before-integrate gate that D2 brings, with a slice-SET-specific prompt
   (coherence / dependency graph / gaps+overlap / "if built, achieves the PRD goal /
   correct-if-implemented"). Keeps the BUILD `--review-*` family (consistency is the
   win): `--review` / `--no-review` (on by default), `--review-model`. It also
   INHERITS `--review-max-rounds` for free via the shared core — but that knob is
   LATENT (it bounds a revise↔review loop whose REVISE step does not exist yet; >1
   round re-reviews unchanged bytes). So it is NOT a headline feature; see
   `work/observations/review-max-rounds-bounds-a-loop-with-no-revise-step.md`.

Net: gate family = `--review*` (shared with build); improver-loop family =
`--slicer-loop*` (slice-only). No name blurs across the two.

### D4 — confirmed, no change
`advancing/` (advance-loop US #19) stays a FOLDER borrow on the ledger ref —
consistent with the lock model above. An earlier musing to move it to a branch ref
was WRONG (it would destroy in-progress visibility) and must NOT enter the PRD.

## Disposition

Incubates. Becomes a PRD only if the maintainer decides to reorg (then: name the
folders, write the migration slice riding the swappable-paths constant, update
skills / CLAIM-PROTOCOL / WORK-CONTRACT / ADR path references). The cheap wins
(README-per-folder, the clarification sentence, swappable paths) can be picked up
independently without committing to the reorg.
