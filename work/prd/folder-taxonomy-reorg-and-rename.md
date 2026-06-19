---
title: Regroup work/ under regime umbrellas (notes/ tasks/ briefs/) and rename slice->task, prd->brief
slug: folder-taxonomy-reorg-and-rename
humanOnly: true
needsAnswers: true
sliceAfter: [recover-autodetect-and-advancing-lock-crash-safety]
---

> **REVISED 2026-06-19 — reconciled to post-lock/post-position-gate reality (this banner SUPERSEDES the stale body sections below; read it first).** The two prerequisite efforts have now LANDED, which retires several premises this PRD's body still describes:
>
> **RETIRED from this PRD (the body's mentions of these are now WRONG — ignore them):**
> - The co-located `<slug>.lock.md` companion + the `advancing/` folder + the `sliceAfter: [recover-autodetect-and-advancing-lock-crash-safety]` lock coupling. The lock left `main`'s tree entirely (`ledger-status-per-item-lock-refs`, all 12 slices done): transient status (`in-progress`/`needs-attention`/`slicing`/`advancing`) is now per-item lock-ref state, NOT any `main` folder. There is no `main`-tree lock file to co-locate or relocate. DROP all lock-co-location stories/decisions (old US #10–14, #13's coupling, the lock Implementation/Testing detail).
> - The five-folder `tasks/` umbrella shape (`backlog`/`in-progress`/`needs-attention`/`done`/`out-of-scope`). The transient three are gone from `main`; `out-of-scope/` was generalised to `dropped/`. `tasks/` reduces to the DURABLE set only.
>
> **DECIDED vocabulary (no longer open — fixed by the sibling `staging-pool-position-gate-and-trust-model` STEP-A that landed):** the live folders today are `pre-backlog/` (slice STAGING) → `backlog/` (the agent POOL) → `done/`/`dropped/`, and `pre-prd/` (PRD STAGING) → `prd/` (the auto-slice POOL) → `prd-sliced/`. STEP-B (this PRD) renames the SLICE side: **`backlog → todo`** (the pool keeps being the pool, new name) and **`pre-backlog → backlog`** (staging takes the freed name) — a pure constants-flip behind the `work-layout` module + `git mv`, no behaviour change. The two-phase migration (Phase 0 centralise every `work/...` path behind one module with zero behaviour change; Phase 1 flip the values + `git mv` + mirror both `protocol/` copies) STANDS, as does the `slice->task` / `prd->brief` rename and the regime-umbrella regroup (`notes/`/`tasks/`/`briefs/`) — adapted to the durable-only `tasks/` set.
>
> **MUST ALSO UPDATE THE PROTOCOL DOCS for the renames (this is load-bearing, not optional).** US #17 already scopes "update WORK-CONTRACT.md / CLAIM-PROTOCOL.md / ADR-FORMAT.md / skills to the new vocabulary and layout." Make this EXPLICIT: every rename this PRD performs (`backlog→todo`, `pre-backlog→backlog`, the PRD-side rename, `slice→task`, `prd→brief`, the umbrella regroup) MUST be mirrored into BOTH protocol copies (`skills/setup/protocol/*` the SOURCE OF TRUTH, and the propagated `work/protocol/*`) in the SAME effort, keeping `diff -r skills/setup/protocol work/protocol` clean (apart from `VERSION`). The protocol prose was JUST truthed-up (2026-06-19) to the CURRENT names (lock refs; `backlog`=pool, `pre-backlog`=staging); a rename that does not also update the protocol re-drifts the contract `setup` propagates into every adopted repo. Treat "the protocol docs say the new names" as a Phase-1 acceptance criterion.
>
> **OPEN QUESTION (why `needsAnswers: true` — must be resolved before slicing):** the PRD-side rename target is NOT yet decided. The slice side is clear (`backlog→todo`, `pre-backlog→backlog`). For PRDs, the shipped names are `pre-prd`(staging)/`prd`(pool). Options: (a) MIRROR the slice rename — `prd → prd-ready` (pool) + `pre-prd → prd` (staging), so "the bare name is staging, the qualified name is the pool" is consistent across both sides; OR (b) KEEP `pre-prd`/`prd` as-is (rename only the slice side), accepting the two sides name their pool differently; OR (c) under the `slice→task`/`prd→brief` rename, fold into the umbrella verbs (`briefs/untasked → briefs/tasking → briefs/tasked`) and drop the staging/pool distinction's bare-vs-qualified naming entirely. A human must pick (a)/(b)/(c) — it determines the PRD-side `git mv` mapping and the protocol vocabulary. (The slice-template + the `slice->task`/`prd->brief` extent across CLI/frontmatter/skills are the other slicing-level calls, but the PRD-side pool name is the one true blocker.)

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices. Originating design: `work/ideas/folder-taxonomy-and-prd-edit-handshake.md` (the full decision trail — `## DECIDED 2026-06-16`, the `LEADING RESOLUTION`, and the `COORDINATION` note). This PRD is the actionable form of that idea.

> **PARTIAL-SUPERSESSION + SIMPLIFICATION NOTICE (2026-06-17), REVISE THIS PRD when next picked up, AFTER the lock/position work lands.** Two new artifacts change this PRD's premise:
> - `work/prd/ledger-status-per-item-lock-refs.md` (ADR `docs/adr/ledger-status-on-per-item-lock-refs.md`) moves the advancing lock AND all transient status (`in-progress`, `needs-attention`, `slicing`) OFF `main`'s tree onto per-item lock refs.
> - `work/prd/staging-pool-position-gate-and-trust-model.md` (ADR `docs/adr/placement-is-runner-deterministic-humanonly-is-agent-judgement.md`) adds the `backlog`(staging)/`todo`(pool) split, the `prd`/`prd-ready` split, and a generic terminal `dropped/` folder (generalising `out-of-scope/`).
>
> **What changes for THIS PRD:**
> - **RETIRED:** the co-located `<slug>.lock.md` relocation (US #10-14 + the lock-format Implementation/Testing Decisions + story #13's lock-relocation coupling). The lock leaves `main`'s tree entirely, so there is no `main`-tree lock file to co-locate; `<slug>.lock.md` fixed neither false-contention nor branch-inheritance. DROP those slices; the `advancing/` folder simply ceases to exist on `main`.
> - **SIMPLIFIED:** the `tasks/` umbrella is now CLEANER than the original five-folder "pure state machine." The transient three (`in-progress`/`needs-attention`/`slicing`) are NO LONGER `main` folders (they are lock-ref state), so `tasks/` reduces to DURABLE positions only: `backlog`(staging) + `todo`(pool) + `done` + `dropped` (was `out-of-scope`, generalised). The brief side mirrors: `prd`(staging) + `prd-ready`(pool) + `prd-sliced`(done analogue). This is a strictly simpler, more honest umbrella, the reorg should adopt it rather than the old five-folder shape.
> - **UNAFFECTED + STANDS:** the regime-umbrella regroup (`notes/`/`tasks/`/`briefs/`), the `slice->task`/`prd->brief` rename, and the two-phase `work-layout` migration.
>
> **SEQUENCING (the maintainer's "rename comes after, minimise changes in one go"):** do NOT rewrite this PRD's mechanism NOW, and do NOT do the rename as part of the lock/position work. The lock substrate + position gate land FIRST (behavioural, keeping current folder names). THEN this taxonomy reorg/rename is picked up as a later, mostly-mechanical pass that ALSO absorbs the simplified `tasks/` umbrella + `todo/` + `dropped/`. At THAT point, revise this PRD's body to the post-transient-state shape (drop the lock co-location, reduce `tasks/` to the durable set, fold `out-of-scope/` into `dropped/`). Until then this notice is the reconciliation record; reconcile in full at slicing time.

## Problem Statement

The `work/` tree today is a flat list of ~13 sibling folders that silently mixes two governance regimes: a **state machine** (`backlog`/`in-progress`/`needs-attention`/`done`/`out-of-scope`, status = the folder, transitions via CAS `git mv`) and **capture buckets** (`ideas`/`observations`/`findings`, notes that do not flow, leave only by deletion), plus a PRD lifecycle (`prd`/`slicing`/`prd-sliced`) and a lock folder (`advancing`). A reader cannot tell from the top level which folder means what kind of thing. The vocabulary is also inherited jargon: "slice" is polysemous (array slice, time slice) and "PRD" is industry-generic; neither is load-bearing, and "task"/"brief" read more plainly to the humans who live in this tree.

Separately, the `advancing` lock marker sits in a flat `work/advancing/<type>-<slug>.md` folder DIVORCED from the item it locks, so a reader must consult two places to know "this backlog task is being advanced," and the design wrongly reads (in earlier framing) as a run-level mutex when it is in fact a per-item hold.

The cost of NOT doing this is conceptual: CONTEXT.md states that consistency and conceptual coherence are a quality of this project, and a top level that does not express the regime seam undercuts that. The cost of doing it BADLY is severe: the folder NAMES literally are the conflict-safe state machine, so a careless rename risks the crown-jewel invariant ("status = the folder it lives in").

## Solution

Regroup `work/` so each top-level umbrella means ONE regime, and rename the vocabulary to the plainer `task`/`brief`, WITHOUT changing any behaviour and without weakening the folder-as-status invariant. Target layout:

```
work/
  notes/                 # capture regime — do NOT flow, leave only by deletion
    observations/
    ideas/
    findings/
  briefs/                # was the prd-family. Lifecycle: untasked -> tasking -> tasked
    untasked/            #   was prd/         (ready to break into tasks)
    tasking/             #   was slicing/     (the HELD LOCK, mid-break)
    tasked/              #   was prd-sliced/  (broken into tasks, resting)
  tasks/                 # build regime — PURE state machine, status = folder, CAS git mv
    backlog/
    in-progress/
    needs-attention/
    done/
    out-of-scope/
  questions/             # surfaced blocker questions — CONTENT humans answer (own surface)
  advancing/             # PER-ITEM advance holds (see the lock note); stays addressable
  protocol/              # propagated protocol docs — NOT diluted
```

Vocabulary: `slice -> task`, `prd -> brief`, applied to user-facing surfaces, on-disk folders, frontmatter field names, the CLI command surface, and the protocol docs. There is NO per-user-configurable nomenclature: one canonical vocabulary, because a synonym layer would break the single-source glossary CONTEXT.md prizes and the byte-identical propagated `protocol/` copies. The brief lifecycle verbs (untasked -> tasking -> tasked) are clearer than prd -> slicing -> prd-sliced.

The advancing lock becomes a CO-LOCATED markdown companion `<slug>.lock.md` sitting beside the item it locks (the item never moves), so the folder keeps telling the WHOLE truth (lifecycle position AND the transient hold) and an `observations/` capture-bucket item can be locked WITHOUT flowing. This relocation is sequenced AFTER and depends on the crash-safety PRD's `advancingMarkerPath()` / `listAdvancingMarkers()` helper.

This is delivered as a safe two-phase migration so the crown-jewel invariant is never at risk: Phase 0 centralizes every `work/...` path behind one module with NO behaviour change and NO rename (all the risk lives here and it is gate-verifiable); Phase 1 flips the constants, `git mv`s the on-disk files, and mirrors the change into both `protocol/` copies. The lock relocation is a further, separate change riding the crash-safety helper.

## User Stories

1. As a human reading `work/` for the first time, I want the top level to express the regime seam (capture vs build vs brief-lifecycle), so I can tell what each tree means without reading the protocol docs.
2. As a human living in this tree, I want the plainer vocabulary `task` and `brief` (instead of `slice` and `prd`) in folders, frontmatter, CLI output, and prompts, so the system reads in ordinary language.
3. As a maintainer, I want a SINGLE canonical vocabulary (NO per-user renaming), so the glossary stays single-source and the propagated `protocol/` copies stay byte-identical.
4. As a maintainer, I want every hardcoded `work/...` path string, folder-name union type, and folder-name array routed through ONE `work-layout` module BEFORE any rename, so the rename is a one-file value change rather than a 121-file find-replace (which would collide `slice` with `Array/String.prototype.slice`).
5. As a maintainer, I want Phase 0 (centralization) to land with the acceptance gate green and NO behaviour change, so I have a verified, independently-valuable checkpoint even if the rename never ships.
6. As a maintainer, I want Phase 1 (the flip + `git mv` + dual-`protocol/`-copy update) to keep the folder-as-status invariant intact, so concurrent CAS `git mv` transitions stay conflict-safe after the reorg.
7. As an agent or human, I want the brief lifecycle folders named `briefs/untasked` -> `briefs/tasking` -> `briefs/tasked`, mirroring the build state machine minus done, so the brief flow reads as a clear verb story.
8. As an agent or human, I want `tasks/` to hold the full build state machine (`backlog`, `in-progress`, `needs-attention`, `done`, `out-of-scope`), so the previously top-level stuck/terminal states live under the regime they belong to.
9. As a human, I want `questions/` to remain its own visible top-level surface (the "what needs me?" queue), not folded into `notes/`, so surfaced blockers stay glance-able.
10. As a human, I want the advancing lock to be a co-located `<slug>.lock.md` markdown companion beside the item it locks, so one `ls` shows both the item's lifecycle position and that it is being advanced.
11. As the system, I want an `observations/` (capture-bucket) item to be lockable for triage WITHOUT being moved out of its bucket, so the "notes do not flow" invariant holds while triage is in progress.
12. As a maintainer, I want the item-scan predicate to become "`*.md` that is NOT a reserved companion (`*.lock.md`, `*.questions.md`)", owned in ONE place in `work-layout`, so a co-located lock file is never mistaken for a work item and the rule cannot drift per reader.
13. As the author of the crash-safety PRD, I want the lock relocation to reuse my `advancingMarkerPath()` / `listAdvancingMarkers()` helper and to land AFTER my flat-path crash-safety fixes, so I ship a tight data-loss/crash-safety fix without absorbing a cosmetic reorg.
14. As the system, I want the advancing lock BRANCH name to keep the `<type>-<slug>` encoding even after the co-located filename drops the `<type>-` prefix, so two types never collide on `advancing/<slug>`.
15. As a maintainer onboarding a NEW repo, I want `setup` to scaffold the new layout (and the `protocol/` copies to reflect it), so adopted repos get the reorganized tree, not the legacy flat one.
16. As a maintainer of an EXISTING repo on the legacy layout, I want a documented migration path (the `git mv` mapping old -> new), so adopting the new layout is mechanical and safe.
17. As a maintainer, I want all skills, `WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`, `ADR-FORMAT.md`, and ADR path references updated to the new vocabulary and layout in the same effort, so the docs do not drift from the tree.

### Autonomy notes (the two gate axes)

- **`humanOnly: true` (set):** a human must drive the SLICING of this PRD. The folder names ARE the conflict-safe state machine; the slicing decisions (how to phase the migration, where the Phase-0/Phase-1 cut lines fall, the exact reserved-infix bytes, the sequencing against the crash-safety PRD) are judgement-heavy and must not be auto-sliced. Per the contract this does NOT propagate to the produced slices' own gates: several slices (e.g. the mechanical Phase-0 centralization) may well be fully agent-buildable once cut.
- **`needsAnswers`:** NOT set. The design cruxes are all DECIDED in the originating idea (layout B; co-located `.lock.md`; two-phase migration; sequence-after-crash-safety with the shared helper). The residue is slicing-level (phasing, ordering, byte-level naming), which is a slicing call, not an open design question.

## Implementation Decisions

- **Two-phase migration (the de-risking spine).** Phase 0: introduce a single `work-layout` module that is the SOLE source of every `work/...` path, every folder-name union (e.g. today's `type SliceFolder = 'in-progress' | 'backlog' | 'done'`), and every folder-name array (e.g. `const WORK_FOLDERS = [...]`). Route all current raw literals (across ~121 `.ts` files), `join(cwd, 'work', ...)` calls, prefix-slices (`'work/backlog/'.length`), and the item-scan filters through it. Names stay EXACTLY as today; the acceptance gate (`pnpm -r build && pnpm -r test && pnpm format:check`) proves no behaviour changed. Phase 1: change the VALUES in `work-layout` to the new nested/renamed paths, `git mv` the on-disk files, and mirror into BOTH `protocol/` copies (keep `diff -r skills/setup/protocol work/protocol` clean). Because Phase 0 de-stringified everything, the JS `.slice()` method is never in scope for the rename.
- **The item-scan exclusion rule lives in `work-layout`.** The predicate becomes "`*.md` minus reserved companion infixes (`*.lock.md`, `*.questions.md`)", defined once. No reader re-implements it.
- **The advancing lock = co-located `<slug>.lock.md`.** A markdown companion beside the item (body carries locker/since/reason as today). It is a HOLD, not a status (the item's status is unchanged while held), so the item never moves; the CAS micro-commit adds/removes the sibling. The lock BRANCH name stays `advancing/<type>-<slug>`; only the on-disk marker filename simplifies. This change RIDES the crash-safety PRD's `advancingMarkerPath()` / `listAdvancingMarkers()` helper and `sliceAfter`s it (the relocation rebases onto an already-crash-safe release path — strictly easier than doing both at once). C's stuck-lock surfacing scan and this item-scan filter converge on one `listLockMarkers()`-style primitive.
- **Old -> new folder mapping (for the migration + the `setup` scaffold):** `prd/`->`briefs/untasked/`, `slicing/`->`briefs/tasking/`, `prd-sliced/`->`briefs/tasked/`, `backlog/`->`tasks/backlog/`, `in-progress/`->`tasks/in-progress/`, `needs-attention/`->`tasks/needs-attention/`, `done/`->`tasks/done/`, `out-of-scope/`->`tasks/out-of-scope/`, `observations/`->`notes/observations/`, `ideas/`->`notes/ideas/`, `findings/`->`notes/findings/`, `advancing/`->`advancing/` (unchanged location; markers relocate to co-located `.lock.md` in the lock slice), `questions/`->`questions/` (unchanged), `protocol/`->`protocol/` (unchanged). Frontmatter: `prd:` field -> `brief:`; `sliceAfter:` -> the brief-equivalent (resolve naming at slicing time — likely `briefAfter` or kept as-is for least churn; a slicing-level decision).
- **CLI surface:** `do slice:<slug>` / `do prd:<slug>` -> the task/brief-prefixed equivalents; CI matrix ids likewise. Exact deprecation/alias policy for the old prefixes is a slicing-level decision.

## Testing Decisions

- Phase 0 is verified by the EXISTING test suite staying green with zero behaviour change — that IS the test (a pure refactor behind a constants module). Add a focused test that the `work-layout` module is the single source (e.g. a lint/grep guard that no `.ts` outside `work-layout` contains a raw `work/<folder>` literal), so the centralization cannot silently regress.
- Phase 1: tests assert the new paths resolve, the CAS `git mv` transitions still conflict-safe across the nested folders, and `diff -r` of the two `protocol/` copies is clean.
- Lock relocation: a co-located `<slug>.lock.md` is acquired/released via CAS without moving the item; an item-scan does NOT pick up the `.lock.md` companion as a task; an `observations/` item can be locked without leaving its bucket; the lock branch name still carries `<type>-<slug>`.
- Reuse the crash-safety PRD's lock tests as the baseline; this PRD's lock slice extends them for the new path.

## Out of Scope

- The `needsAnswers` edit-handshake command (the sibling idea in `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`) — superseded by the advance-loop design; not part of this reorg.
- Per-user-configurable nomenclature — explicitly REJECTED (one canonical vocabulary).
- The advancing-lock CRASH-SAFETY and REAPER work itself — owned by `work/prd/recover-autodetect-and-advancing-lock-crash-safety.md`; this PRD only RELOCATES the marker afterward.
- Defect A (the `complete.ts` stranded-done data-loss fix) — fully independent, ships first via the crash-safety PRD.

## Further Notes

- Full decision trail (including the rejected alternatives: per-type `advancing/` status folders; a non-`.md` suffix lock file; a `.lock/` subfolder; the `<design>/<build>/<notes>` stage-grouping) is in `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`. Once this PRD is sliced and the idea is fully absorbed, that idea file can be deleted (see the disposition note there) — but keep it until the slices exist, since it carries the rejected-options reasoning that should survive into the slices/ADR rather than evaporate.
- A new ADR is likely warranted for the regime-umbrella decision and the hold-vs-status distinction for the advancing lock (elicit the durable "why" at slicing time; an ADR records a decision WE made and its rationale).
