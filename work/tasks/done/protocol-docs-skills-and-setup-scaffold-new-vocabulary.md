---
title: Phase 1: mirror the rename into both protocol copies (byte-identical), rename + update the in-repo skills, update ADR paths, and make setup scaffold the new notes/tasks/briefs layout
slug: protocol-docs-skills-and-setup-scaffold-new-vocabulary
spec: folder-taxonomy-reorg-and-rename
humanOnly: true
blockedBy: [regroup-notes-and-task-board-rename, brief-regime-rename-and-dropped-migration, slice-task-prd-brief-vocabulary-hard-cutover]
covers: [15, 16, 17]
---

## What to build

The load-bearing protocol/doc closure of the migration: bring the protocol prose,
the skills, the ADR path references, and the `setup` scaffold up to the FINAL
layout + vocabulary, and keep the two protocol copies byte-identical. The protocol
prose was just truthed-up to the CURRENT names; a rename that does not also update
it re-drifts the contract `setup` propagates into every adopted repo, so this is
an explicit acceptance criterion, not a nicety.

Pieces:

- **Both protocol copies, byte-identical.** Update `skills/setup/protocol/*` (the
  SOURCE OF TRUTH) AND the propagated `work/protocol/*` so that
  `diff -r skills/setup/protocol work/protocol` is clean apart from `VERSION`.
  Files: `WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`, `ADR-FORMAT.md`,
  `slice-template.md`, `prd-template.md`, `VERSION`. The prose must say the NEW
  names: the `notes/` / `tasks/` / `briefs/` umbrellas; `tasks/{backlog(staging),
  todo(pool),done,cancelled}`; `briefs/{proposed(staging),ready(pool),tasked,dropped}`;
  `questions/` top-level; the `task`/`brief` vocabulary; `do task:`/`do brief:`;
  frontmatter `brief:` + `briefAfter:`; the per-regime terminals
  (`tasks/cancelled/`, `briefs/dropped/`) and WHY (the slug-collision correctness
  fix); the lock-ref entry `task-<slug>`/`brief-<slug>`. Consider whether the
  template filenames themselves should rename (`slice-template.md` ->
  `task-template.md`, `prd-template.md` -> `brief-template.md`), if so, do it in
  BOTH copies and update every reference; record the choice.
- **The in-repo skills (rename + reword).** The skills live IN THIS REPO under
  `skills/`, and the user's `~/.agents/skills/*` are SYMLINKS into them (so editing
  here IS editing the live skills, no copy step). Two kinds of change:
  - **Rename the vocabulary-named skill directories** to match the new verbs:
    `skills/to-prd/` -> `skills/to-brief/` and `skills/to-slices/` -> `skills/to-task/`
    (`git mv` the directories), and update the `name:` frontmatter field inside
    each `SKILL.md` to the new slug (`name: to-brief`, `name: to-task`), plus the
    skill's own self-references in its prose. Rename the `to-slices/scripts/claim.sh`
    only if its path is referenced by name (keep the script working). NOTE: the
    user maintains the `~/.agents/skills/` symlinks; a renamed directory will need
    the symlink re-pointed, but that is OUTSIDE this repo (call it out in the done
    record / PR description so the user re-points `to-prd -> to-brief`,
    `to-slices -> to-task`).
  - **Reword the skill prose** that names old folders/verbs across ALL skills
    (`to-brief`/`to-task` (renamed), `drive-backlog`, `orchestrate`, `review`,
    `setup`, `surface-questions`, `triage-observations`): the references to
    `work/backlog/`, `work/prd/`, `pre-backlog`/`pre-prd`, `prd-sliced`,
    `slice`/`prd`, `sliceAfter`, `do slice:`/`do prd:` become the new
    layout/vocabulary (`work/tasks/todo/`, `work/briefs/ready/`,
    `tasks/backlog`/`briefs/proposed`, `briefs/tasked`, `task`/`brief`,
    `briefAfter`, `do task:`/`do brief:`). Keep each skill's `description:` and any
    trigger phrases coherent with the new names.
- **ADR paths.** Update any ADR path reference that encodes the old names. (ADRs are
  an immutable decision record, update REFERENCES/paths, do not rewrite a
  decision's history; if an ADR body's running prose needs a pointer to the new
  names, add a forward note rather than falsifying the original.)
- **`setup` scaffolds the new tree.** The onboarding path that scaffolds a fresh
  `work/` skeleton must create `notes/{observations,ideas,findings}`,
  `tasks/{backlog,todo,done,cancelled}`, `briefs/{proposed,ready,tasked,dropped}`,
  `questions/`, and `protocol/` (copied from the source), NOT the legacy flat
  tree. Provide / update the documented old->new `git mv` migration mapping for an
  existing repo on the legacy layout.
- **CONTEXT.md note.** Add a short note in `CONTEXT.md` recording that the project's
  skills live in `skills/` and that `~/.agents/skills/*` are symlinks into them
  (so a skill rename is in-repo work, and the symlink must be re-pointed by the
  user). This is the recurring fact that keeps getting rediscovered; pin it.

This slice lands LAST because it describes the FINAL names, the three flip slices
must already have moved the folders and cut over the vocabulary.

## Acceptance criteria

- [ ] The protocol prose (both copies) says the new names: the `notes/`/`tasks/`/
      `briefs/` umbrellas, the per-regime lifecycles + terminals, `questions/`
      top-level, the `task`/`brief` vocabulary, `do task:`/`do brief:`, frontmatter
      `brief:`/`briefAfter:`, and the lock-ref `task-<slug>`/`brief-<slug>` entry.
- [ ] `diff -r skills/setup/protocol work/protocol` is CLEAN apart from `VERSION`
      (the two copies are byte-identical).
- [ ] The vocabulary-named skill DIRECTORIES are renamed (`skills/to-prd ->
      skills/to-brief`, `skills/to-slices -> skills/to-task`), each `SKILL.md`'s
      `name:` field + self-references updated, and the `to-task` claim script kept
      working.
- [ ] ALL skills' prose (the renamed two + `drive-backlog`, `orchestrate`,
      `review`, `setup`, `surface-questions`, `triage-observations`) uses the new
      layout/vocabulary; no skill still says `work/prd/`, `work/backlog/`,
      `pre-prd`/`pre-backlog`, `slice`/`prd`, `sliceAfter`, or `do slice:`/`do prd:`.
- [ ] Any ADR path reference uses the new vocabulary/layout (ADR decision history
      is not falsified, references/forward-notes only).
- [ ] `CONTEXT.md` records that the project's skills live in `skills/` and that
      `~/.agents/skills/*` are symlinks into them (a skill rename is in-repo work +
      a user-owned symlink re-point).
- [ ] The done record / PR description calls out the `~/.agents/skills/` symlink
      re-points the user must make for the two renamed skills (outside this repo).
- [ ] `setup` scaffolds the new `notes/`/`tasks/`/`briefs/` + `questions/` +
      `protocol/` tree (not the legacy flat one), and a documented old->new `git mv`
      migration mapping exists for legacy repos.
- [ ] Tests assert the scaffold produces the new tree and (where the repo already
      tests it) that the two protocol copies match; the Phase-0 guard still passes.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green (run
      `pnpm format` to fix formatting, never hand-fix from the checker).

## Blocked by

- `regroup-notes-and-task-board-rename`, `brief-regime-rename-and-dropped-migration`,
  `slice-task-prd-brief-vocabulary-hard-cutover`: the docs + skills describe the
  FINAL state, so every folder move and the vocabulary cutover must already have
  landed.

## Prompt

> Build the protocol/doc/setup closure of the `folder-taxonomy-reorg-and-rename`
> PRD: bring the protocol prose, skills, ADR path references, and the `setup`
> scaffold up to the FINAL `notes/`/`tasks/`/`briefs/` layout + `task`/`brief`
> vocabulary, and keep the two protocol copies byte-identical. This is load-bearing:
> the protocol is the contract `setup` propagates into every adopted repo, so a
> rename that skips it re-drifts the contract.
>
> FIRST, check this slice against current reality: confirm the three flip slices
> (notes/task board, brief regime + terminals, vocabulary cutover) are all in
> `done/` and the code already uses the new names. If any is missing, the docs would
> describe a state the code does not have, route to needs-attention rather than
> documenting ahead of the code.
>
> Repo-specific rule (this repo authors the protocol AND uses it): the protocol docs
> exist in TWO places, `skills/setup/protocol/*` is the SOURCE OF TRUTH, and
> `work/protocol/*` is a propagated COPY. Edit BOTH and keep them byte-identical;
> `diff -r skills/setup/protocol work/protocol` must be clean apart from `VERSION`.
> Editing only one silently drifts the copy and the next `setup` re-propagates the
> stale text.
>
> The IN-REPO skills (important fact): the project's skills live in THIS repo under
> `skills/`, and the user's `~/.agents/skills/*` are SYMLINKS into them, so editing
> `skills/` IS editing the live skills (no copy step). Two kinds of skill change:
> (1) RENAME the vocabulary-named skill dirs: `git mv skills/to-prd skills/to-brief`
> and `git mv skills/to-slices skills/to-task`, update each `SKILL.md`'s `name:`
> field + self-references, keep the `to-task` claim script working; (2) REWORD the
> prose of EVERY skill (`to-brief`/`to-task` renamed, plus `drive-backlog`,
> `orchestrate`, `review`, `setup`, `surface-questions`, `triage-observations`) to
> the new layout/vocabulary. The two renamed dirs need their `~/.agents/skills/`
> symlink re-pointed by the user, which is OUTSIDE this repo, so call it out in the
> done record / PR description rather than trying to do it here. Also add a note to
> `CONTEXT.md` pinning the skills-live-here + symlinked-from-~/.agents fact (it
> keeps getting rediscovered).
>
> Where else to look: `WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`, `ADR-FORMAT.md`,
> `slice-template.md`, `prd-template.md`, `VERSION` (both protocol copies); ADR path
> references; and the `setup` scaffold (the onboarding code that creates the `work/`
> skeleton). Decide whether to rename the template files (`slice-template.md` ->
> `task-template.md`, `prd-template.md` -> `brief-template.md`); if you do, do it in
> both copies + every reference and record the choice.
>
> The target layout the docs must describe:
> notes/{observations,ideas,findings}; tasks/{backlog(staging), todo(pool), done,
> cancelled}; briefs/{proposed(staging), ready(pool), tasked, dropped};
> questions/ (top-level); protocol/. The brief staging slot is `proposed` (NOT
> `draft`): a brief is created when it is READY to slice, so the staging slot names
> the admission/trust gate, not an unfinished document. The per-regime terminals use
> DIFFERENT words (`cancelled` double-l for tasks, `dropped` for briefs) and that
> split is the slug-collision correctness fix, say WHY in the prose.
>
> "Done" means: both protocol copies say the new names and are byte-identical (diff
> -r clean apart from VERSION), the skills + ADR references are updated without
> falsifying ADR history, `setup` scaffolds the new tree with a documented legacy
> migration mapping, the Phase-0 guard still passes, and the full acceptance gate is
> green (run `pnpm format` to fix formatting). RECORD any non-obvious in-scope
> decision (e.g. template-file renames) per `ADR-FORMAT.md`.
