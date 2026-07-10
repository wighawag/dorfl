---
title: Prefactor — pre-isolate spec false-positive words to synonyms before any prd→spec sweep
slug: preisolate-spec-false-positive-words
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: []
covers: [1, 3]
---

## What to build

The EXPAND-phase prefactor of the wide refactor (`TASKING-PROTOCOL.md` §3a), and the FIRST task of the whole cutover. Before any `prd → spec` edit, make the target substring `spec` unambiguous by renaming every artifact-UNRELATED word that contains it to a synonym, so a later keep-case sweep can never corrupt genuine English.

Scope: a repo-wide pass over `packages/dorfl/{src,test}`, `skills/`, `docs/`, `CONTEXT.md`, `AGENTS.md`, and `website/` (NOT `.github/workflows/*` — agents never touch those; NOT landed `work/` history, which the migration command handles later). Find occurrences of `spec` inside artifact-unrelated words (`specify`, `specific`, `specifically`, `specification`, `specified`, `respectively`, `especially`, `spectrum`, `.spec.ts` test-file naming, `inspect`, `unspecified`, etc.) and, where the word does NOT mean the `prd` artifact, rename it to a synonym that carries the same meaning (e.g. `specify → require/state`, `specific → particular`, `specified → given`, `unspecified → undeclared`). Leave the substring `spec` present ONLY where a later task will legitimately introduce it as the artifact noun.

This is a pure prefactor: no `prd` identifier changes here. It only clears the field so the subsequent migrate batches (and the migration command's engine) can use plain substring matching without sentinel gymnastics.

Note the mirror-image live evidence this exists to prevent: the prior `brief` cutover left `via: 'brief'` as a live discriminated-union tag in `close-job.ts`/`frontmatter.ts` today — a substring sweep that misses a spelling is a real, current failure mode. (That specific `brief → spec` remnant sweep is OWNED by `rename-spec-remaining-src-modules`, not this task; this task only clears artifact-unrelated ENGLISH containing `spec`.)

## Acceptance criteria

- [ ] Every artifact-unrelated word containing `spec` in the in-scope trees is renamed to a synonym; the remaining `spec` occurrences are ONLY where the `prd` artifact noun will later be introduced (or already-neutral test-infra that a later task owns).
- [ ] No `prd`/`PRD` identifier is changed in this task (it is prefactor-only).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- [ ] A short note (in the done record or a `work/notes/observations/` entry linked from it) records the list of words renamed and the synonym chosen, so the migrate-phase author can trust that a bare `spec` substring now means the artifact.
- [ ] `.github/workflows/*` and landed `work/` history are UNTOUCHED (workflows are human-regenerated; history is the migration command's job).

## Blocked by

- None — can start immediately. (This is the first expand-phase task; every migrate batch blocks on it.)

## Prompt

> Goal: make the substring `spec` unambiguous across the live source trees BEFORE the `prd → spec` vocabulary cutover begins, by synonym-renaming every artifact-unrelated word that contains `spec`. This is the expand-phase prefactor of a wide refactor (read `work/protocol/TASKING-PROTOCOL.md` §3a) and the parent spec `work/specs/{ready|tasked}/prd-to-spec-vocabulary-cutover-and-migration-command.md` (Implementation Decisions → "Rename MECHANICS — PRE-ISOLATE"). Do NOT touch `.github/workflows/*` (the CI identity cannot push workflow changes) or landed `work/` history (the migration command converts that later).
>
> Domain vocabulary: the artifact today is a `prd`; the cutover renames it to `spec`. The hazard is that `spec` lives inside common English (`specify`, `specific`, `specification`, `.spec.ts`, `respectively`, `especially`, `inspect`, `spectrum`). Rename those to synonyms so that after this task, a bare `spec` substring means the artifact (once introduced) and nothing else.
>
> Where to look: `packages/dorfl/{src,test}`, `skills/`, `docs/`, `CONTEXT.md`, `AGENTS.md`, `website/`. Grep case-insensitively for `spec`, classify each hit as artifact-related (leave) or unrelated (synonym-rename), and apply. Prefer synonyms that read naturally and keep the sentence's meaning.
>
> Done means: the in-scope trees contain `spec` only where the artifact noun will be introduced; no `prd` identifier changed; the full gate (`pnpm -r build && pnpm -r test && pnpm format:check`) is green; and the renamed-word list is recorded and linked from the done record so the next author can rely on it.
>
> FIRST check drift: confirm the parent spec still describes this prefactor and that no earlier cutover task has already started renaming `prd` (this task must run before any of them). If the field is already partly swept, route to needs-attention rather than guessing.
