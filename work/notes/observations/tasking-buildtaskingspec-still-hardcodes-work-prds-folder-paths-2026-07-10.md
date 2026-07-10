---
title: tasking.ts `buildTaskingSpec` + its JSDoc still hardcode `work/specs/ready/` / `work/specs/tasked/` folder-path LITERALS (stale vocab, NOT the migrated `work/specs/`) (2026-07-10)
date: 2026-07-10
---

## What I saw

While finishing the `finish-spec-cutover-protocol-folder-paths-and-frontmatter-field` task (protocol DOCS + frontmatter FIELD), I noticed `packages/dorfl/src/tasking.ts` still emits `work/specs/ready/` in a USER-FACING prompt string and describes `work/specs/*` throughout its JSDoc, even though the data folders migrated to `work/specs/*` (the folder-move batch + `work-layout.ts` KEYS/VALUES are on `specs/*`). Concretely:

- `buildTaskingSpec` (tasking.ts:1310) hardcodes `` `You are a FRESH-CONTEXT tasker for the spec \`work/specs/ready/${slug}.md\`.` `` and (:1341) `moves the spec into \`work/specs/tasked/\``. These are string LITERALS, not `workItemRel('specs-ready', …)` calls, so the folder-key indirection did not reach them.
- The module's JSDoc + inline comments (~20 occurrences) still say `work/specs/ready/` → `work/specs/tasked/`.
- `packages/dorfl/test/tasking-protocol-doc.test.ts` (~198-225) ASSERTS the builder body matches `/work\/specs\/ready\//` + `/work\/specs\/tasked\//` and is titled "current vocabulary" — so it currently pins the STALE literal green.

The actual `git mv` still lands correctly because the folder-MOVE code uses the symbolic keys (`workItemRel`/`specTasked`), which `work-layout.ts` maps to `work/specs/*`. Only the PROMPT string + prose are stale, so the agent is pointed at a `work/specs/ready/<slug>.md` path that no longer exists in a migrated repo.

## Why I did NOT fix it here

Out of THIS task's scope: Part A is `skills/setup/protocol/*` DOCS, Part B is the frontmatter FIELD (`Frontmatter.spec` drop + `.spec` readers). The `tasking.ts` `buildTaskingSpec` prompt string + its coupled test are neither the protocol contract nor the frontmatter field; flipping them (and re-pointing the drift-guard test) is a separate code-vocabulary cutover (the migrate/`spec-to-spec` command territory or a dedicated `tasking.ts` batch). Recording per the "notice out-of-scope drift → drop a note" rule.

## Suggested fix (for a future task)

Flip `buildTaskingSpec`'s two `work/specs/…` literals to `work/specs/…` (ideally via `workFolderRel('specs-ready'/'specs-tasked')` so it can never re-drift), sweep the tasking.ts JSDoc prose `spec → spec`, and update `tasking-protocol-doc.test.ts`'s builder-body assertions to `/work\/specs\/ready\//` + `/work\/specs\/tasked\//`.
