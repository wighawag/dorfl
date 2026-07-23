---
title: 'Clean-break the test fixture-folder vocabulary compat-seam (drop spec/spec-sliced/pre-spec old words -> brief/briefs-tasked/pre-brief)'
slug: clean-break-fixture-folder-vocab-compat-seam
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-residual-slice-test-labels-and-skill-provenance]
covers: []
---

> **AUTHORED 2026-06-23 (conductor + human, post-rename cleanup follow-up).** The last `slice`/`spec` current-concept surface in the tests: the fixture-folder vocabulary compat-seam in `test/helpers/gitRepo.ts`. After the symbolic-key vocabulary cutover it kept a DUAL-TOLERANT alias map (accepts BOTH the old `spec`/`spec-sliced`/`pre-spec` fixture words AND the current `brief`/`briefTasked`) so the cutover was one map-flip instead of a call-site sweep. The human's call: a test helper should not carry the old vocabulary — drop the legacy words and sweep the ~19 call sites + the per-test-file local `folder:` unions to the current vocabulary. Clean break, no dual-accept. Blocked on the test-label-tidy task so the two test-touching tasks serialise cleanly.

## What to build

Clean-break the fixture-folder vocabulary so the helpers + call sites speak ONLY the current task/brief words. No dual-accept.

### `test/helpers/gitRepo.ts` (the seam + its shape)
- `FIXTURE_WORD_TO_KEY` (~L23-36): REMOVE the legacy keys `'pre-spec'`, `spec`, `'spec-sliced'`, `prdSliced` (and their "accept BOTH" comments). Keep ONLY current-vocabulary words: `'pre-brief'`/`'pre-backlog'`/`backlog`/`brief`/`briefTasked` (add a `'pre-brief': 'briefs-proposed'` current word to replace `'pre-spec'`). The map becomes single-vocabulary.
- The `writeAll('spec', work.brief)` / `writeAll('spec-sliced', work.briefTasked)` calls (~L490-491): pass the CURRENT folder words (`writeAll('brief', work.brief)` / `writeAll('brief-tasked', work.briefTasked)` — match whatever current word the map now uses; keep the work-shape field names `brief`/`briefTasked`, which are already current).
- The JSDoc prose carrying `SPEC`/`SLICE`/`slicing` for current concepts (~L17-18 header, L212 "SPEC slugs to seed … for the slicing lock", L311/L321 "minimal SPEC file body … slicing-lock fixtures", L329 "satisfy a slice's blockedBy", L367 "the SLICE slug's per-item lock", L445 "the SLICE regime's won't-proceed terminal", L455/L457 "PRDs to slice"/"Already-SLICED PRDs"): rename to brief/task/tasking. Keep the immutable slug `brief-regime-rename-and-dropped-migration` (L447) verbatim.

### Per-test-file local folder unions + call sites (~19 sites)
Sweep each test that passes an old folder word or declares a local `folder:` union to the current vocabulary:
- `test/slug-namespace.test.ts` (~L21 `folder: 'backlog' | … | 'spec' | 'spec-sliced'`, and the `writeItem('spec', …)` calls at L121/150/163/180/236 + L317-322/404-442 area): `'spec'` -> `'brief'`, `'spec-sliced'` -> `'brief-tasked'` (the union + every call). The `'auto-slice'` slugs in this file are ARBITRARY collision-test slugs — leave them verbatim (they test slug parsing, not the concept).
- `test/ledger-read.test.ts` (~L103 `folder: 'spec' | 'slicing' | 'spec-sliced'`): -> `'brief' | 'tasking' | 'brief-tasked'` (and call sites). Confirm what `'slicing'` maps to and use the current word.
- `test/apply-persist.test.ts` (~L229 `folder: 'spec'`, ~L653 `folder: 'pre-spec'`): -> `'brief'` / `'pre-brief'`.
- `test/placement.test.ts` (~L133-134): these assert `placementFolder(BRIEF_SLOTS, 'staging') === 'pre-spec'` and `'pool') === 'spec'`. CAUTION: these assert the ON-DISK folder rel returned by the SOURCE `placementFolder` — verify what the SRC actually returns now. If the src returns the current on-disk path, update the expected to match; if these are asserting a legacy on-disk name that is still real, leave + call out. (Do NOT change src here — read-only confirm and align the test expectation.)
- `test/advance.test.ts` (~L146 `writeItem('spec', 'auto-slice.md', …)`): `'spec'` -> `'brief'`; leave the `'auto-slice'` slug.
- Any remaining fixture call site passing `'spec'`/`'spec-sliced'`/`'pre-spec'`/`'slicing'` as a folder word: sweep to current.

## KEEP verbatim
- Immutable historical slugs used AS slugs: `auto-slice` (collision-test fixture slug), `brief-regime-rename-and-dropped-migration`, `work-layout-keys-and-folder-union-names-to-new-vocabulary`, any `*-slicing-*` task/brief slug referenced as provenance.
- If `placement.test.ts` is asserting a genuinely-still-real on-disk legacy folder name (not vocabulary), leave it and CALL IT OUT.

## OUT OF SCOPE
- Any SRC change (this is a test-fixture vocabulary sweep; `placement.test.ts` aligns the EXPECTATION to existing src, never edits src).
- `LoneSlice*` live identifiers; the `SelectionPool` keyword; the stale labels/skill prose (the two sibling tasks own those).

## Acceptance criteria

- [ ] `helpers/gitRepo.ts` `FIXTURE_WORD_TO_KEY` carries NO legacy `spec`/`spec-sliced`/`pre-spec`/`prdSliced` words and no "accept BOTH" dual-tolerance — single current vocabulary only; the `writeAll(...)` calls pass current words.
- [ ] No test passes `'spec'`/`'spec-sliced'`/`'pre-spec'`/`'slicing'` as a fixture FOLDER word; the per-test local `folder:` unions are current-vocabulary; arbitrary slug fixtures (`auto-slice`) left verbatim.
- [ ] `gitRepo.ts` JSDoc carries no current-concept `SPEC`/`SLICE`/`slicing`; immutable slugs kept + called out.
- [ ] `placement.test.ts` expectations aligned to the real src return (or the legacy name kept + called out as genuinely-real); NO src edited.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green; no `.github/workflows/*` edited.

## Blocked by

- `rename-residual-slice-test-labels-and-skill-provenance` — both touch the test suite; serialise so the two sweeps don't churn each other (this one is the larger fixture-folder sweep; that one is the small label/prose tidy).

## Prompt

> Goal: clean-break the test fixture-folder vocabulary compat-seam, per brief `code-identifier-slice-prd-to-task-brief-rename`. `test/helpers/gitRepo.ts` keeps a DUAL-TOLERANT alias map accepting BOTH old (`spec`/`spec-sliced`/`pre-spec`) and current (`brief`/`briefTasked`) fixture words; drop the legacy words (no dual-accept) and sweep the ~19 call sites + per-test-file local `folder:` unions to the current vocabulary.
>
> FIRST verify reality: confirm `FIXTURE_WORD_TO_KEY` still has the `spec`/`spec-sliced`/`pre-spec` keys and the "accept BOTH" comments; confirm the dependency `rename-residual-slice-test-labels-and-skill-provenance` landed. Grep `'spec'`/`'spec-sliced'`/`'pre-spec'`/`'slicing'` as folder-word args across `test/`.
>
> CAUTION at `placement.test.ts` (~L133-134): it asserts `placementFolder(...)` RETURNS `'pre-spec'`/`'spec'`. Read the SRC `placementFolder` to see what it actually returns now; align the test EXPECTATION to reality. Do NOT edit src. If a legacy on-disk name is genuinely still real, keep it and call it out.
>
> SCOPE FENCES: no src changes; leave arbitrary slug fixtures (`auto-slice`) verbatim; leave `LoneSlice*`, the `SelectionPool` keyword, and the stale-label/skill-prose surfaces (sibling tasks own them). Keep immutable historical slugs.
>
> Where to look: `test/helpers/gitRepo.ts` (the map + `writeAll` + JSDoc), `test/slug-namespace.test.ts`, `test/ledger-read.test.ts`, `test/apply-persist.test.ts`, `test/advance.test.ts`, `test/placement.test.ts`, and any other fixture-folder-word call site. Run `pnpm format`.
>
> Done = build/test/format:check green, no legacy fixture folder words / dual-accept, single current vocabulary in the seam, scope fences intact, no src or workflow touched.

---

### Claiming this task

```sh
dorfl claim clean-break-fixture-folder-vocab-compat-seam --arbiter <remote>
git fetch <remote> && git switch -c work/clean-break-fixture-folder-vocab-compat-seam <remote>/main
git mv work/tasks/todo/clean-break-fixture-folder-vocab-compat-seam.md work/tasks/done/clean-break-fixture-folder-vocab-compat-seam.md
```
