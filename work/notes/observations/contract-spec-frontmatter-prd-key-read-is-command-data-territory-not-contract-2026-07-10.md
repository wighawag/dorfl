---
title: The contract task's `parseFrontmatter` `prd:`-key-read removal contradicted its own option-A exemption + ADR §7e — the frontmatter `prd:` KEY read is DATA-territory (like the sidecar fallback), fixed in-task (2026-07-10)
date: 2026-07-10
---

## Trigger

The CONTRACT task STOPPED a 4th time \u2014 but on a DIFFERENT, correct finding: a LOAD-BEARING CONTRADICTION inside the task itself (which I authored). Its alias-removal list said "remove the `prd:` frontmatter-key read in `parseFrontmatter` (keep only `spec:`)", but the SAME task's option-A SCOPE section + ADR \u00a77e make the `prd:` FIELD the migration COMMAND's DATA territory.

## Verified evidence (the agent's, confirmed)

- dorfl's OWN ledger: **199 `prd:` frontmatter fields, 0 `spec:`** (`grep -rl '^spec:' work/` vs `'^spec:'`). Removing the `prd:` KEY read gives every dorfl task an `undefined` parent-spec pointer \u2014 wrong-but-compiling, breaks self-hosting.
- ADR \u00a77e (line 126): "Run the command on dorfl = the real acceptance test: it does dorfl's ... all data conversion." So converting dorfl's `prd:` frontmatter is the COMMAND's job (final task), not this source-part contract task.
- Empirically: removing the key read reds the gate \u2014 the `tasking-protocol-doc` drift guard + ~10 tests assert `fm.spec === 'example-spec'`.

## The fix (in-task, no new human decision \u2014 reconciles with already-ratified option A + ADR \u00a77e)

The `prd:` frontmatter KEY read + `Frontmatter.spec` field is now CARVE-OUT #2 (exact parallel of the sidecar `prd-<slug>.md` fallback carve-out #1): a DATA-territory reader the migration COMMAND removes when it converts dorfl's on-disk `prd:` fields. `parseFrontmatter` KEEPS reading BOTH `spec:` and `prd:` until then. The contract task removes only the CODE-level aliases (SlugNamespace/PRD_PREFIX, SidecarType/item-lock, IntakeArtifactType/Outcome, repo-config `prdsLandIn`/`--specs-land-in`), flips the rejection tests, and adds the bi-word leak scan with BOTH carve-out readers on the allow-list. Updated: the alias-removal bullet, the first + leak-scan acceptance criteria, the "dead compat reader" line, and the prompt's Done/drift notes.

## Lesson

This is the ONE stop of the four that was NOT a dropped-migrate-scope gap \u2014 it was a TASK-AUTHORING contradiction I introduced when I sharpened the task to option A: I added the `prd:`-FIELD categorical exemption to the SCOPE + leak-scan sections but left the stale "remove the `prd:` frontmatter-key read" in the alias-removal list from the pre-option-A draft. Lesson for retasking: when you add a categorical EXEMPTION, grep the WHOLE task for every clause that assumed the now-exempt thing is in-scope and reconcile them, or the task ships self-contradictory. The agent's drift-check caught it because the contradiction was empirically testable (the removal reds the gate + the exemption says don't). The source/data line for the frontmatter identity is now precise: the `Frontmatter.spec` TYPE field + `prd:` KEY reader are DATA (command), exactly like the sidecar FILE-path fallback \u2014 both read not-yet-converted on-disk data; the code-level type-union `'spec'` members are SOURCE (contract).

## Provenance

Contract-task agent STOP diagnosis #4, verified @ feb551e6 (199 `prd:` fields via grep; ADR \u00a77e:126; the `fm.spec`-asserting tests). Fix reconciles with option A (ratified 2026-07-10) + ADR \u00a77e; no new human decision needed.
