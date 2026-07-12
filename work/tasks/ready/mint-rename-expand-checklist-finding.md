---
promotedFrom: observation:spec-lock-sidecar-namespace-was-missed-by-first-expand-task
---

## What to build

A new finding note at `work/notes/findings/rename-expand-checklist.md` capturing the durable meta-lesson from two do-agent STOP catches on the `spec` → (new-name) rename:

1. `expand-spec-frontmatter-and-namespace-aliases` initially missed the whole identity layer.
2. The lock/sidecar identity (`SidecarType`, `TYPE_TO_NAMESPACE`, `typeForNamespace`, `item-lock.ts` `'spec'` cases) was missed by that first expand task and only surfaced when the batch-2 `do` agent stopped — fixed by adding `expand-spec-lock-and-sidecar-namespace`.

The finding is a CHECKLIST, not prose: enumerate the surface CLASSES a coined-token rename must expand-first, distinguished from consumer surfaces that ride safely on a widened union.

Suggested structure (adapt if a cleaner shape emerges while writing):

- **Frame**: one paragraph — for a coined-token rename (a value that is minted, mapped, and switched on across the codebase), the surfaces where the token is DEFINED are systematically under-enumerated by the first expand task; the surfaces that merely READ it are safe on a widened union and belong in migrate batches. Cite the two concrete catches with commit/file refs from the source observation (`sidecar.ts:72`, `typeForNamespace`, `slug-namespace.ts` `PRD_PREFIX`/`workBranchRef`, @ 1d0b43fc).
- **Definitional / MINT-and-MAP surface classes** (MUST be in an expand task before any migrate batch flips an emit site):
  - Discriminated-union / string-literal type members (e.g. `SidecarType = 'spec' | 'task' | 'observation'`, `SlugNamespace`).
  - Prefix / literal constants that mint the token (`PRD_PREFIX`, branch-ref builders, parsers that recognise the prefix).
  - Namespace / type resolvers and their inverse maps (`typeForNamespace`, `TYPE_TO_NAMESPACE`) — including fall-through defaults that SILENTLY collide when a case is missing (the `spec:` → `task` fall-through was the concrete failure mode).
  - Any per-item identity derivation that switches on the token to build a namespaced string (item-lock keys, sidecar paths, on-disk layout).
- **Consumer surface class** (safe on a widened union, migrate-batch territory): plain reads like `item.namespace === 'spec'` scattered across CLI/advance/do/scan/tasking/triage-persist modules. List the concrete files from the source observation as the worked example.
- **Procedure for the next coined-token rename** (the actionable checklist):
  1. Grep for the OLD token as a string literal AND as a type-member; classify every hit as definitional-mint, definitional-map, or consumer-read.
  2. Every definitional-mint and definitional-map site goes in an expand task (widen the union / add the new case alongside the old) BEFORE any migrate batch.
  3. Watch for silent-fallthrough resolvers: a missing case in `typeForNamespace`-shaped functions does not error, it aliases — enumerate every such resolver explicitly.
  4. Consumer-read sites are migrate-batch work and do not block the first expand.
- **Provenance**: two do-agent STOP diagnoses on the current in-flight rename; second catch documented in observation `spec-lock-sidecar-namespace-was-missed-by-first-expand-task`. Include a short 'why a checklist, not an ADR or WORK-CONTRACT edit' line — the human's answer explicitly picked (a) over (b)/(c) because a concrete enumerable checklist is more actionable than discipline prose.

Do NOT modify `WORK-CONTRACT.md`, `to-task` guidance, or mint an ADR — those alternatives were considered and rejected in the answer. Do NOT re-do the conductor fix (adding `expand-spec-lock-and-sidecar-namespace`, re-pointing batch 2's `blockedBy`, extending the contract task's alias-removal list) — that has already landed and the follow-up task is in `work/tasks/ready/`.

## Prompt

> Create a new finding at `work/notes/findings/rename-expand-checklist.md` (create the directory if it does not exist) capturing the meta-lesson from two do-agent STOP catches during the in-flight `spec` namespace rename: for a coined-token rename, definitional MINT/MAP surfaces (string-literal union members, prefix constants, namespace resolvers and their inverse maps, silent-fallthrough default cases, per-item identity derivations like lock keys and sidecar paths) are systematically under-enumerated by the first expand task, while consumer READ surfaces (`item.namespace === 'spec'` across ~11 modules) ride safely on a widened union and belong in migrate batches.
>
> Write it as an ENUMERABLE CHECKLIST, not discipline prose — that shape was explicitly chosen over folding into `WORK-CONTRACT.md` or minting an ADR. Include: (1) a short frame paragraph citing the two concrete catches (first expand missed the identity layer entirely; second missed `sidecar.ts` `SidecarType`/`TYPE_TO_NAMESPACE`/`typeForNamespace` and the `'spec'` cases in `item-lock.ts`, verified @ commit 1d0b43fc, with the silent-collision failure mode `lockEntryFor('spec:foo') === 'task-foo'` via the `typeForNamespace` fall-through); (2) a list of the definitional MINT/MAP surface classes above; (3) the consumer READ surface class with the file list from the source observation as the worked example; (4) a numbered procedure a future rename can literally follow (grep the old token, classify each hit as definitional-mint / definitional-map / consumer-read, put every definitional site in an expand task before any migrate batch, enumerate every silent-fallthrough resolver explicitly, leave consumer-read for migrate batches); (5) a one-line provenance pointing back to observation `spec-lock-sidecar-namespace-was-missed-by-first-expand-task`.
>
> Do NOT edit `WORK-CONTRACT.md`, `skills/`, or mint an ADR — the human's answer explicitly rejected those. Do NOT re-do the conductor fix (adding the second expand task and re-pointing batch 2) — that has already landed. The ONLY artifact this task produces is the finding file. When you finish, `pnpm -r build && pnpm -r test && pnpm format:check` should still be green (running `pnpm format` first if needed); a markdown-only addition under `work/notes/findings/` should not break any of those, but verify.
