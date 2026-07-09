---
title: The work/ tree is grouped into regime umbrellas (notes/tasks/prds) with two DISTINCT lifecycles and per-regime won't-proceed terminals; questions/ stays top-level
status: proposed
created: 2026-06-19
supersedes:
superseded_by:
---

# ADR: regime umbrellas for the work/ tree (notes / tasks / prds), two deliberately-different lifecycles, per-regime terminals, and a top-level questions/

> **STATUS: proposed.** Pins the WHY behind the `folder-taxonomy-reorg-and-rename`
> migration. Full design + the exact old→new mapping live in
> `work/prds/tasked/folder-taxonomy-reorg-and-rename.md` (the prd) and the six
> task records in `work/tasks/done/` (`work-layout-module-centralises-all-work-paths`,
> `guard-test-no-raw-work-literal-outside-work-layout`,
> `regroup-notes-and-task-board-rename`, `brief-regime-rename-and-dropped-migration`,
> `slice-task-prd-brief-vocabulary-hard-cutover`,
> `protocol-docs-skills-and-setup-scaffold-new-vocabulary`). This ADR records the
> DECISION and its rationale, not the mechanics.

## Decision

The `work/` governance tree is grouped into three role-based **regime umbrellas**,
plus two folders that stay at the top level:

- **`notes/`** — the CAPTURE regime: `notes/{observations,ideas,findings}`. These do
  not flow through a lifecycle; they leave by deletion.
- **`tasks/`** — the BUILD board, a clean Kanban: `tasks/{backlog,todo,done,cancelled}`
  (`backlog` = staging, `todo` = the agent pool, `done`, `cancelled` = the
  won't-proceed terminal).
- **`prds/`** — the PRD lifecycle: `prds/{proposed,ready,tasked,dropped}`
  (`proposed` = staging gate, `ready` = the auto-tasking pool, `tasked` = decomposed
  and resting, `dropped` = the won't-proceed terminal).
- **`questions/`** stays TOP-LEVEL (NOT under `notes/`).
- **`protocol/`** stays top-level (the propagated contract docs).

The two lifecycles are DELIBERATELY NOT mirror images: `tasks/` is a Kanban board,
`prds/` is a staging-gate→admitted-pool. Each regime has its OWN won't-proceed
terminal with a DELIBERATELY DIFFERENT word (`tasks/cancelled` vs `prds/dropped`).

The vocabulary follows the folders: a unit of buildable work is a **task**, a
decomposable north-star doc is a **prd**; `do task:` / `do prd:`, frontmatter `prd:` /
`taskedAfter:`, lock-ref entries `task-<slug>` / `prd-<slug>`. `observation` /
`obs:` is unchanged.

## Why

1. **The flat top level had become too crowded and some names were not clean.** The
   tree had grown to ~12 sibling folders at the top, and the role of each was no
   longer legible at a glance; names like `prd-tasked` read as awkward
   verb-tense-on-a-noun rather than a clear lifecycle position. Grouping by ROLE
   (capture vs build-board vs prd-lifecycle) makes the top level legible again and
   lets each regime own a clean internal vocabulary.

2. **A task and a prd are fundamentally DIFFERENT kinds of thing, so they get
   different lifecycles, not one forced shape.** A prd is something you DECOMPOSE;
   a task is something you EXECUTE. We specifically wanted a clean Kanban setup for
   tasks (`backlog → todo → done`), which is the right mental model for a build
   board. Forcing the prd regime into the same board vocabulary would mislead a
   reader into expecting Kanban semantics where the real shape is a
   staging-gate→admitted-pool. Keeping them distinct lets each name say what it
   actually is.

3. **The prd staging slot is `proposed`, NOT `draft`, because it names an
   ADMISSION/TRUST gate, not an unfinished document.** A prd is authored when it
   is already ready to task; the staging slot is about whether the prd is
   admitted into the auto-tasking pool (`ready`), not about the document being a rough
   draft. `proposed` carries the trust-gate meaning; `draft` would wrongly imply
   "not finished writing it yet."

4. **`questions/` stays top-level because it is the system's HUMAN-INPUT mechanism,
   not capture.** `notes/` is passive capture the system produces and discards;
   `questions/` is the channel through which a HUMAN feeds answers back INTO the
   system (the "what needs me?" surface the autonomous loop reads). That input
   channel needs to be HIGHLY VISIBLE and categorically separate from notes, so it
   sits at the top level, not buried under a capture umbrella.

5. **Per-regime terminals with different words are a CORRECTNESS fix, not
   cosmetics.** A task, a prd, and an observation can share a slug. The shipped
   single top-level `work/dropped/` keyed by BARE slug, so a dropped task and a
   dropped prd sharing a slug COLLIDED on one `dropped/<slug>.md` (and `done/` had
   only ever been a task terminal, so the prd side had no clean terminal of
   its own). Giving each regime its own terminal — `tasks/cancelled/` (double-l, to
   match existing protocol prose) and `prds/dropped/` — namespaces the collision
   away by type. A dropped observation needs no terminal folder (notes leave by
   deletion).

## Considered and rejected

- **Keep the flat top-level layout.** Rejected per Why #1: it had grown crowded and
  some names (`prd-tasked`) were not clean; legibility and per-regime vocabulary
  won.
- **Mirror the two lifecycles (one shared vocabulary for tasks and prds).**
  Rejected per Why #2: they are different kinds of work; a shared shape would
  mislead. The Kanban shape is right for the build board only.
- **`draft` for the prd staging slot.** Rejected per Why #3: it implies an
  unfinished document; the slot is really an admission/trust gate, which `proposed`
  names.
- **Fold `questions/` under `notes/`.** Rejected per Why #4: questions are the
  human-input mechanism and must stay highly visible, not buried in capture.
- **One shared terminal word across regimes (e.g. `cancelled` or `dropped` for
  both).** Rejected per Why #5: a single shared terminal folder re-introduces the
  bare-slug cross-regime collision the per-regime split exists to remove.

## Consequences

- A `work-layout` module is the single source of every `work/...` path, folder
  union, and the item-scan predicate, guarded by a structural test
  (`work-layout-guard.test.ts`) so a raw `work/<folder>` path literal cannot
  re-scatter. The taxonomy lives in ONE place; a future rename is a value flip
  there, not a codebase-wide find-replace.
- `item-lock.ts`'s `terminalMainPaths` resolves each TYPE to its namespaced terminal
  (`task → tasks/cancelled`, `prd → prds/dropped`); no reader derives a
  bare-slug `work/dropped/` path.
- The vocabulary cutover is a HARD break: pre-rename `task:` / `prd:` prefixes and
  `prd:` / `taskAfter:` frontmatter are no longer accepted (no migration-window
  alias) — we have no external users owed a migration window.
- A self-renaming-folder task (one that `git mv`s the ledger folders the runner
  reads its own record from) required teaching `complete` a layout-agnostic
  done-position check (ADRs/PRs aside: see
  `complete-self-renaming-folder-task.test.ts`); recorded here as the non-obvious
  downstream effect of moving the ledger folders themselves.
- `setup` scaffolds the new `notes/`/`tasks/`/`prds/` + `questions/` + `protocol/`
  tree and carries a documented legacy old→new `git mv` migration mapping for repos
  on the flat layout.
