---
title: folder taxonomy reorg (one lifecycle umbrella) + a needsAnswers edit-handshake command
slug: folder-taxonomy-and-prd-edit-handshake
type: idea
status: incubating
---

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

- **`to-slice` / `being-sliced` / `sliced` as folders.** Rejected for two
  independent reasons: (1) the flow is **non-terminal** — a PRD goes `prd →
  slicing → prd` (the lock returns it) and gets **re-sliced** (PRDs are reshaped;
  `auto-slice.md` itself has a "RESHAPED" banner yet is `sliced:`), so `sliced/`
  is not a `done/`-like resting state; making it one needs a banned bidirectional
  `sliced → to-slice` move. (2) sliced-ness is **derivable / already a marker** —
  `autoslice-gate.md` resolves `sliceAfter` against the **`sliced:` frontmatter
  marker (NOT `done/`)**; encoding it as a folder re-materializes a derivable state
  (double-write + drift) and forces `sliceAfter` to stat paths instead of read a
  field. **Keep the `sliced:` marker; keep ONE `slicing/` lock folder.**
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

Spawned by `work/observations/slicing-lock-does-not-stabilise-prd-content.md`. A
human who wants to edit a PRD safely while agents might slice it should be able to
**flip `needsAnswers: true` via the seam CAS** and be told win/lose: if the flip
lands, no slicer will start (the gate is `needsAnswers !== true`) and any in-flight
slice fails the release-rebase backstop → safe to edit. This makes the existing
two-axis gate the human-facing edit lock; the command is a thin CAS wrapper. Small
follow-up — becomes its own slice when prioritised, likely alongside the
`autoslice-lock` rebase amendment.

## Disposition

Incubates. Becomes a PRD only if the maintainer decides to reorg (then: name the
folders, write the migration slice riding the swappable-paths constant, update
skills / CLAIM-PROTOCOL / WORK-CONTRACT / ADR path references). The cheap wins
(README-per-folder, the clarification sentence, swappable paths) can be picked up
independently without committing to the reorg.
