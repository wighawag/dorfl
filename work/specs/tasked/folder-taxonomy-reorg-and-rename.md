---
title: Regroup work/ under regime umbrellas (notes/ tasks/ briefs/) and rename slice->task, spec->brief
slug: folder-taxonomy-reorg-and-rename
humanOnly: true
sliceAfter: []
---

> **REVISED 2026-06-19 — reconciled to post-lock/post-position-gate reality (this banner SUPERSEDES the stale body sections below; read it first).** The two prerequisite efforts have now LANDED, which retires several premises this SPEC's body still describes:
>
> **RETIRED from this SPEC (the body's mentions of these are now WRONG — ignore them):**
> - The co-located `<slug>.lock.md` companion + the `advancing/` folder + the `sliceAfter: [recover-autodetect-and-advancing-lock-crash-safety]` lock coupling. The lock left `main`'s tree entirely (`ledger-status-per-item-lock-refs`, all 12 slices done): transient status (`in-progress`/`needs-attention`/`slicing`/`advancing`) is now per-item lock-ref state, NOT any `main` folder. There is no `main`-tree lock file to co-locate or relocate. DROP all lock-co-location stories/decisions (old US #10–14, #13's coupling, the lock Implementation/Testing detail).
> - The five-folder `tasks/` umbrella shape (`backlog`/`in-progress`/`needs-attention`/`done`/`out-of-scope`). The transient three are gone from `main`; `out-of-scope/` was generalised to `dropped/`. `tasks/` reduces to the DURABLE set only.
>
> **DECIDED vocabulary (no longer open — fixed by the sibling `staging-pool-position-gate-and-trust-model` STEP-A that landed):** the live folders today are `pre-backlog/` (slice STAGING) → `backlog/` (the agent POOL) → `done/`/`dropped/`, and `pre-spec/` (SPEC STAGING) → `spec/` (the auto-slice POOL) → `spec-sliced/`. STEP-B (this SPEC) renames the SLICE side: **`backlog → todo`** (the pool keeps being the pool, new name) and **`pre-backlog → backlog`** (staging takes the freed name) — a pure constants-flip behind the `work-layout` module + `git mv`, no behaviour change. The two-phase migration (Phase 0 centralise every `work/...` path behind one module with zero behaviour change; Phase 1 flip the values + `git mv` + mirror both `protocol/` copies) STANDS, as does the `slice->task` / `spec->brief` rename and the regime-umbrella regroup (`notes/`/`tasks/`/`briefs/`) — adapted to the durable-only `tasks/` set.
>
> **Partial STEP-B consumption (2026-06-22).** The surface-pool-reader slice of this STEP-B has been carved off and landed by `f1-pool-noun-todo-in-surface-and-apply-readers` (brief `staging-surface-and-apply-promote-safety`). That slice renamed the POOL noun `backlog` → `todo` in the readers the F2/F3 work touches: `packages/dorfl/src/ledger-read.ts` (the `LedgerTodoItem` / `LocalLedgerState.todo` shape), `lifecycle-gather.ts` (its `state.todo` enumeration), the `scan --json` output shape (`TodoItem` / `readTodoItems` plus a deprecated `BacklogItem` / `readBacklogItems` alias kept as a migration shim), the `config.ts` doc-comments, and the `slicesLandIn` value space in `env-config.ts` (POOL value `'backlog'` → `'todo'`; the legacy spelling is migrated with a one-line deprecation warning in env / per-repo config / `--slices-land-in`). STAGING (`'pre-backlog'`) and the FOLDER `tasks/backlog/` are deliberately UNCHANGED. The remainder of STEP-B is NOT orphaned — the tree-wide mechanical rename (e.g. `slicesLandIn`'s staging value, the `work/pre-backlog/` and `work/backlog/` runtime strings in `slicing.ts` / `needs-attention.ts` / `intake.ts`, the test fixture seam in `gitRepo.ts`, the per-repo doc updates) still belongs to this SPEC's later slices. Do NOT re-touch what F1 already did.
>
> **MUST ALSO UPDATE THE PROTOCOL DOCS for the renames (this is load-bearing, not optional).** US #17 already scopes "update WORK-CONTRACT.md / CLAIM-PROTOCOL.md / ADR-FORMAT.md / skills to the new vocabulary and layout." Make this EXPLICIT: every rename this SPEC performs MUST be mirrored into BOTH protocol copies (`skills/setup/protocol/*` the SOURCE OF TRUTH, and the propagated `work/protocol/*`) in the SAME effort, keeping `diff -r skills/setup/protocol work/protocol` clean (apart from `VERSION`). The protocol prose was truthed-up (2026-06-19) to the CURRENT names (lock refs; `backlog`=pool, `pre-backlog`=staging); a rename that does not also update the protocol re-drifts the contract `setup` propagates into every adopted repo. Treat "the protocol docs say the new names" as an acceptance criterion of the rename slices.
>
> **RESOLVED END-STATE (2026-06-19, decided conductor + human — `needsAnswers` cleared, this SPEC is now SLICEABLE).** The full target `work/` layout:
>
> ```
> work/
>   notes/                     # CAPTURE regime (do NOT flow; leave by deletion) — UNCHANGED contents
>     observations/  ideas/  findings/
>   tasks/                     # BUILD regime — a KANBAN board (was the "slice" family)
>     backlog/<slug>.md        #   STAGING            (was pre-backlog/)
>     todo/<slug>.md           #   the agent POOL     (was backlog/ — the pool keeps being the pool)
>     done/<slug>.md           #   completed          (was done/)
>     cancelled/<slug>.md      #   won't-proceed terminal (per-regime; reason: in body)
>   briefs/                    # BRIEF regime — its own lifecycle (was the "SPEC" family)
>     proposed/<slug>.md       #   STAGING gate       (was pre-spec/)
>     ready/<slug>.md          #   the auto-slice POOL (was spec/)
>     tasked/<slug>.md         #   decomposed, resting (was spec-sliced/)
>     dropped/<slug>.md        #   won't-proceed terminal (per-regime; reason: in body)
>   questions/<slug>.md        # the "what needs me?" queue — stays TOP-LEVEL (NOT under notes/)
>   protocol/                  # propagated protocol docs (both copies kept byte-identical)
> ```
>
> The DECIDED points (these resolve every open fork; the stale body sections below are superseded by this):
> - **`tasks/` is a Kanban board** (`backlog` staging → `todo` pool → `done`/`cancelled`); **`briefs/` is NOT a mirror** — it has its own natural lifecycle (`proposed` staging → `ready` pool → `tasked`/`dropped`). Each regime gets the nomenclature that fits it; non-mirroring is intentional and fine. (`proposed`, not `draft`: a brief is created when it is READY to slice, so the staging slot names the trust/admission gate, not an unfinished document.)
> - **The transient three (`in-progress`/`needs-attention`/`slicing`) and `advancing` are NOT folders** — they are per-item lock-ref state (the lock work landed). So `tasks/` and `briefs/` are DURABLE-position-only boards.
> - **The won't-proceed terminal is PER-REGIME**, with its own word each: `tasks/cancelled/` and `briefs/dropped/`. This is load-bearing CORRECTNESS, not just taste: a slice and a SPEC (and an observation) can share a slug, and the shipped TOP-LEVEL `work/dropped/` keys by BARE slug, so a dropped task and a dropped brief sharing a slug COLLIDE on `dropped/<slug>.md` (today `item-lock.ts` routes a dropped slice, SPEC, AND observation all to one `work/dropped/`). The umbrella gives each regime its own namespace, removing the collision. MIGRATE the existing top-level `work/dropped/` contents into the right regime's terminal (sort each by what it is). A dropped OBSERVATION needs no terminal folder — notes leave by deletion.
> - **Every reader keys by `(umbrella, slug)`, never bare slug** (e.g. `tasks/todo/foo.md` and `briefs/ready/foo.md` legitimately co-exist). The single `work-layout` module owns the (umbrella, lifecycle) → path mapping and the item-scan predicate; no reader re-derives a bare-slug path.
> - **HARD CUTOVER, no deprecated aliases** (we have no external users owed a migration window): `do prd:<slug>` / `do slice:<slug>` → `do brief:<slug>` / `do task:<slug>`; the `prd:` frontmatter field → `brief:`; `sliceAfter:` → `briefAfter:`; the `slug-namespace`/identity prefixes (`slice`/`spec`) → (`task`/`brief`) INCLUDING the lock-ref entry encoding (`<type>-<slug>` becomes `task-<slug>`/`brief-<slug>`) and the sidecar/`resolveSidecarIdentity` seam. No old prefix is accepted after cutover.
> - **Spelling:** `cancelled` (double-l, matching existing protocol prose) for `tasks/`; `dropped` for `briefs/`. `questions/` stays top-level (US #9).
> - **The `sliceAfter` dependency is cleared** (`[]`): the lock/crash-safety prerequisite it named has landed, so this SPEC no longer waits on anything to be sliced.

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices. Originating design: `work/ideas/folder-taxonomy-and-prd-edit-handshake.md` (the full decision trail — `## DECIDED 2026-06-16`, the `LEADING RESOLUTION`, and the `COORDINATION` note). This SPEC is the actionable form of that idea.

> **PARTIAL-SUPERSESSION + SIMPLIFICATION NOTICE (2026-06-17), REVISE THIS SPEC when next picked up, AFTER the lock/position work lands.** Two new artifacts change this SPEC's premise:
> - `work/spec/ledger-status-per-item-lock-refs.md` (ADR `docs/adr/ledger-status-on-per-item-lock-refs.md`) moves the advancing lock AND all transient status (`in-progress`, `needs-attention`, `slicing`) OFF `main`'s tree onto per-item lock refs.
> - `work/spec/staging-pool-position-gate-and-trust-model.md` (ADR `docs/adr/placement-is-runner-deterministic-humanonly-is-agent-judgement.md`) adds the `backlog`(staging)/`todo`(pool) split, the `spec`/`spec-ready` split, and a generic terminal `dropped/` folder (generalising `out-of-scope/`).
>
> **What changes for THIS SPEC:**
> - **RETIRED:** the co-located `<slug>.lock.md` relocation (US #10-14 + the lock-format Implementation/Testing Decisions + story #13's lock-relocation coupling). The lock leaves `main`'s tree entirely, so there is no `main`-tree lock file to co-locate; `<slug>.lock.md` fixed neither false-contention nor branch-inheritance. DROP those slices; the `advancing/` folder simply ceases to exist on `main`.
> - **SIMPLIFIED:** the `tasks/` umbrella is now CLEANER than the original five-folder "pure state machine." The transient three (`in-progress`/`needs-attention`/`slicing`) are NO LONGER `main` folders (they are lock-ref state), so `tasks/` reduces to DURABLE positions only: `backlog`(staging) + `todo`(pool) + `done` + `dropped` (was `out-of-scope`, generalised). The brief side mirrors: `spec`(staging) + `spec-ready`(pool) + `spec-sliced`(done analogue). This is a strictly simpler, more honest umbrella, the reorg should adopt it rather than the old five-folder shape.
> - **UNAFFECTED + STANDS:** the regime-umbrella regroup (`notes/`/`tasks/`/`briefs/`), the `slice->task`/`spec->brief` rename, and the two-phase `work-layout` migration.
>
> **SEQUENCING (the maintainer's "rename comes after, minimise changes in one go"):** do NOT rewrite this SPEC's mechanism NOW, and do NOT do the rename as part of the lock/position work. The lock substrate + position gate land FIRST (behavioural, keeping current folder names). THEN this taxonomy reorg/rename is picked up as a later, mostly-mechanical pass that ALSO absorbs the simplified `tasks/` umbrella + `todo/` + `dropped/`. At THAT point, revise this SPEC's body to the post-transient-state shape (drop the lock co-location, reduce `tasks/` to the durable set, fold `out-of-scope/` into `dropped/`). Until then this notice is the reconciliation record; reconcile in full at slicing time.

## Problem Statement

The `work/` tree today is a flat list of ~13 sibling folders that silently mixes two governance regimes: a **state machine** (`backlog`/`in-progress`/`needs-attention`/`done`/`out-of-scope`, status = the folder, transitions via CAS `git mv`) and **capture buckets** (`ideas`/`observations`/`findings`, notes that do not flow, leave only by deletion), plus a SPEC lifecycle (`spec`/`slicing`/`spec-sliced`) and a lock folder (`advancing`). A reader cannot tell from the top level which folder means what kind of thing. The vocabulary is also inherited jargon: "slice" is polysemous (array slice, time slice) and "SPEC" is industry-generic; neither is load-bearing, and "task"/"brief" read more plainly to the humans who live in this tree.

Separately, the `advancing` lock marker sits in a flat `work/advancing/<type>-<slug>.md` folder DIVORCED from the item it locks, so a reader must consult two places to know "this backlog task is being advanced," and the design wrongly reads (in earlier framing) as a run-level mutex when it is in fact a per-item hold.

The cost of NOT doing this is conceptual: CONTEXT.md states that consistency and conceptual coherence are a quality of this project, and a top level that does not express the regime seam undercuts that. The cost of doing it BADLY is severe: the folder NAMES literally are the conflict-safe state machine, so a careless rename risks the crown-jewel invariant ("status = the folder it lives in").

## Solution

Regroup `work/` so each top-level umbrella means ONE regime, and rename the vocabulary to the plainer `task`/`brief`, WITHOUT changing any behaviour and without weakening the folder-as-status invariant. **The resolved target layout, the per-regime lifecycles + terminals, the hard-cutover vocabulary, and the two-phase migration spine are all fixed in the RESOLVED END-STATE banner at the top of this file** (it supersedes the original Solution diagram, which described the now-retired `untasked/tasking/tasked` + five-folder `tasks/` + `advancing/`-lock shape). One canonical vocabulary, NO per-user nomenclature: a synonym layer would break the single-source glossary CONTEXT.md prizes and the byte-identical propagated `protocol/` copies.

## User Stories

1. As a human reading `work/` for the first time, I want the top level to express the regime seam (capture vs build vs brief-lifecycle), so I can tell what each tree means without reading the protocol docs.
2. As a human living in this tree, I want the plainer vocabulary `task` and `brief` (instead of `slice` and `spec`) in folders, frontmatter, CLI output, and prompts, so the system reads in ordinary language.
3. As a maintainer, I want a SINGLE canonical vocabulary (NO per-user renaming), so the glossary stays single-source and the propagated `protocol/` copies stay byte-identical.
4. As a maintainer, I want every hardcoded `work/...` path string, folder-name union type, and folder-name array routed through ONE `work-layout` module BEFORE any rename, so the rename is a one-file value change rather than a 121-file find-replace (which would collide `slice` with `Array/String.prototype.slice`).
5. As a maintainer, I want Phase 0 (centralization) to land with the acceptance gate green and NO behaviour change, so I have a verified, independently-valuable checkpoint even if the rename never ships.
6. As a maintainer, I want Phase 1 (the flip + `git mv` + dual-`protocol/`-copy update) to keep the folder-as-status invariant intact, so concurrent CAS `git mv` transitions stay conflict-safe after the reorg.
7. As an agent or human, I want the brief lifecycle folders named for their own natural flow (`briefs/proposed` -> `briefs/ready` -> `briefs/tasked`, + the terminal `briefs/dropped`), so the brief flow reads as a clear verb story. (Supersedes the original `untasked/tasking/tasked` naming, see the banner; the `tasking` hold is a lock ref, not a folder.)
8. As an agent or human, I want `tasks/` to hold the DURABLE build board (`backlog` staging, `todo` pool, `done`, `cancelled`), so the previously top-level terminal state lives under the regime it belongs to. (Supersedes the original five-folder shape: the transient `in-progress`/`needs-attention`/`slicing` states are lock-ref state, NOT folders; see the banner.)
9. As a human, I want `questions/` to remain its own visible top-level surface (the "what needs me?" queue), not folded into `notes/`, so surfaced blockers stay glance-able.
10. As a maintainer, I want the won't-proceed terminal to be PER-REGIME (`tasks/cancelled/` and `briefs/dropped/`, deliberately different words), so a dropped task and a dropped brief sharing a slug never collide on one bare-slug `work/dropped/<slug>.md` (the slug-collision correctness fix; a dropped observation needs no terminal, notes leave by deletion).
11. As a maintainer, I want every reader to key by `(umbrella, slug)` (never a bare slug), owned in ONE place in `work-layout` so the rule cannot drift per reader, since `tasks/todo/foo.md` and `briefs/ready/foo.md` legitimately co-exist.

> US #12-14 (the retired co-located `<slug>.lock.md` lock relocation, the `observations/`-lockable-without-flowing story, the advancing-lock branch encoding) are DROPPED per the banner. The lock left `main`'s tree entirely (transient status is per-item lock-ref state now), so there is no `main`-tree lock file to co-locate.

15. As a maintainer onboarding a NEW repo, I want `setup` to scaffold the new layout (and the `protocol/` copies to reflect it), so adopted repos get the reorganized tree, not the legacy flat one.
16. As a maintainer of an EXISTING repo on the legacy layout, I want a documented migration path (the `git mv` mapping old -> new), so adopting the new layout is mechanical and safe.
17. As a maintainer, I want all skills, `WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`, `ADR-FORMAT.md`, and ADR path references updated to the new vocabulary and layout in the same effort, so the docs do not drift from the tree.

### Autonomy notes (the two gate axes)

- **`humanOnly: true` (set):** a human must drive the SLICING of this SPEC. The folder names ARE the conflict-safe state machine, so the phasing/cut-line decisions were judgement-heavy. Per the contract this did NOT propagate to the produced slices' own gates: the slices are mechanical and agent-buildable.
- **`needsAnswers`:** NOT set (cleared by the banner). Every design fork is resolved.

> **Sliced 2026-06-19.** The technical detail (the two-phase migration mechanism, the old->new folder mapping, the identity/CLI/frontmatter cutover, the per-regime terminal correctness fix, the protocol-mirror requirement, and all testing detail) now lives in the slices under `work/backlog/` (`work-layout-module-centralises-all-work-paths`, `guard-test-no-raw-work-literal-outside-work-layout`, `regroup-notes-and-task-board-rename`, `brief-regime-rename-and-dropped-migration`, `slice-task-prd-brief-vocabulary-hard-cutover`, `protocol-docs-skills-and-setup-scaffold-new-vocabulary`). This SPEC has settled to its durable framing (Problem / Solution / User Stories / Out of Scope + the resolved banner); the prior Implementation/Testing Decisions sections were trimmed into those slices.

## Out of Scope

- The `needsAnswers` edit-handshake command (the sibling idea in `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`) — superseded by the advance-loop design; not part of this reorg.
- Per-user-configurable nomenclature — explicitly REJECTED (one canonical vocabulary).
- The advancing-lock CRASH-SAFETY / lock-substrate work itself — LANDED already (`ledger-status-per-item-lock-refs`); the lock-co-location stories this SPEC once carried are RETIRED (see the banner), not relocated here.
- Defect A (the `complete.ts` stranded-done data-loss fix) — fully independent, shipped separately.

## Further Notes

- Full decision trail (including the rejected alternatives: per-type `advancing/` status folders; a non-`.md` suffix lock file; a `.lock/` subfolder; the `<design>/<build>/<notes>` stage-grouping) is in `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`. Once this SPEC is sliced and the idea is fully absorbed, that idea file can be deleted (see the disposition note there) — but keep it until the slices exist, since it carries the rejected-options reasoning that should survive into the slices/ADR rather than evaporate.
- A new ADR is likely warranted for the regime-umbrella decision and the per-regime terminal (the slug-collision correctness fix). Elicit the durable "why" from the human rather than inferring it (an ADR records a decision WE made and its rationale); the `protocol-docs-skills-and-setup-scaffold-new-vocabulary` slice is the natural place to capture it.
