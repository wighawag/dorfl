---
title: finish-spec-cutover task — renamed the wrapper `<spec>` placeholder + `ResolvedTask.spec`/`wrapper(spec)` param to `spec` (beyond the literal "~8 readers" list) for concept coherence (2026-07-10)
date: 2026-07-10
needsAnswers: true
---

## Decision (PROCEED, recorded per the decision-bar rule)

Task `finish-spec-cutover-protocol-folder-paths-and-frontmatter-field` B-code lists "~8 `.spec` readers" to flip and "drop `Frontmatter.spec`". While doing so I also renamed three coupled CODE identifiers the literal list did not spell out, because leaving them `spec`-named while the docs teach `spec:` would be a muddled concept (the COHERENCE-CHECK half of the rule):

- `ResolvedTask.spec` field → `ResolvedTask.spec` (`prompt.ts`). It is populated from `fm.spec` and read by `do.ts:1057/2248`, `run.ts:811`, `prompt.ts:755` (the exact `task.spec` readers the task named). Renaming the struct field + its readers together keeps the type `spec`-only, matching `Frontmatter`.
- `wrapper(slug, spec, …)` / `buildAgentPrompt(slug, spec, …)` positional param → `spec` (`prompt.ts`), and the CLAIM-PROTOCOL wrapper template placeholder `<spec>` → `<spec>` with the substitution regex `.replace(/<spec>/g, …)` → `.replace(/<spec>/g, …)`.

**What it touches:** `prompt.ts` (`wrapper`/`buildAgentPrompt` signatures + `ResolvedTask` type), `do.ts`, `run.ts`, `tasking.ts` reads, the CLAIM-PROTOCOL.md wrapper template + its mirror/vendored copies, and the coupled `prompt.test.ts` assertions. It does NOT change the frontmatter KEY read (`parseFrontmatter` still reads both `spec:`/`prd:` → `fm.spec`), the CLI verb dispatch (`do prd:`/`advance prd:` still accepted as an alias), or any migration DATA conversion.

**Alternative considered:** keep the `spec`-named placeholder + params and only flip the frontmatter FIELD. Rejected: the wrapper template's `<spec>` placeholder and `the task's `prd:` field` doc line are the SAME surface Part A+B flip to `spec:`; a `<spec>`-teaching doc substituted by a `/<spec>/`-matching regex would silently stop substituting. The rename keeps doc + code coherent.

This is the internal FIELD/param/placeholder rename (SOURCE), distinct from the `prd:` frontmatter KEY read which STAYS dual (`spec:`/`prd:` → `fm.spec`, back-compat carve-out) and the `prd:` CLI-verb alias which also STAYS.

## Second decision: flipped the stale `spec`-named LOCK-REF / WORK-BRANCH namespace tokens in the protocol DOCS to `spec`

Part A of the task lists `work/specs/ → work/specs/` folder paths + `do/advance prd: → spec:` verb forms, but NOT the lock-ref/branch namespace token. Yet `CLAIM-PROTOCOL.md` (`refs/dorfl/lock/<type>-<slug>` with `<type>` is `task`/`spec`; `git switch -c work/<type>-<slug>`) and `WORK-CONTRACT.md` (`action: task` on `refs/dorfl/lock/prd-<slug>`) still said `spec`, while the CODE already renamed the namespace to `spec` (`slug-namespace.ts`: `SlugNamespace = 'task' | 'spec' | 'observation'`, `work/spec-<slug>`, `refs/dorfl/lock/spec-<slug>`; the `'spec'` member is GONE per the prior contract batch). Leaving `spec`-named lock refs in the docs is doc-vs-code drift a `dorfl spec-to-spec` re-sync would re-propagate downstream — exactly the class of live drift this task exists to finish.

Decision (PROCEED, recorded): flipped `<type>` is `task`/`spec` and `refs/dorfl/lock/spec-<slug>` in the docs to match code. **What it touches:** doc-only (CLAIM-PROTOCOL.md, WORK-CONTRACT.md), no code change (the code lock-ref namespace is already `spec`). **Alternative considered:** leave it (strictly out of the listed A/B surfaces) — rejected because it is the same doc-vs-code drift Part A fixes for folder paths, and the tasking-lock is a spec's lifecycle machinery the contract must describe correctly.
