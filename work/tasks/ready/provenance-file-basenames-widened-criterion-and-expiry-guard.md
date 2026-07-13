---
promotedFrom: observation:word-scan-exempts-prd-cutover-task-bodies-2026-07-10
---

## RE-SCOPED 2026-07-13 (maintainer answer (a)) — part 1 DROPPED, part 2 kept

The original part 1 ("amend the observation `word-scan-exempts-prd-cutover-task-bodies-2026-07-10.md`") rests on a FALSE premise: that observation was DELETED by discharge-by-deletion at promotion (commit `d7b196e6`), so there is no file to amend. A build agent correctly STOPPED on this collision. The maintainer chose re-scope (a): **drop the observation-edit half entirely.** Record the wider criterion (below) as an amendment inside THIS task's done record and/or by expanding the existing JSDoc block above `PROVENANCE_FILE_BASENAMES` (which already states the wider criterion in prose today) — do NOT resurrect the deleted observation. Then build ONLY part 2 (the expiry guard). The stale reference to the deleted observation is intentionally removed from scope; `covers`/premise now rest solely on the expiry-guard work.

The wider criterion to record (in the done record / JSDoc, NOT a resurrected observation): "any task / observation / spec / idea whose OWN SUBJECT is the retired `prd` vocabulary, the sweep that removes it, the skill/guard authored to generalise that sweep, or an incident about this scan itself — such a file legitimately quotes the retired word + `work/prds/…` path in prose to describe what it converts FROM / removes / documents." Cross-check every current `PROVENANCE_FILE_BASENAMES` entry against it; surface (do not silently remove) any misfit in the done record.

## What to build

ONE self-contained change in `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` (the `PROVENANCE_FILE_BASENAMES` allow-list + `isProvenanceFile`). (Part 1 above is dropped per the 2026-07-13 re-scope.)

1. **Add an expiry / cleanup guard so the list cannot silently rot** once
   the retired `prd` word is fully purged from the codebase. Concretely,
   in `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` (or a
   sibling test file if that reads cleaner), add a test that:

   - Computes, over the same `work/**` tree the scan walks, whether the
     retired bare artifact word `prd` / `PRD` (using the same lens as the
     scan itself — prose-only, code spans exempt, existing filename/slug
     carve-outs applied) STILL appears ANYWHERE OUTSIDE the
     `PROVENANCE_FILE_BASENAMES` files.
   - If it still appears elsewhere: the guard is quiet (the exemption is
     still load-bearing, current behaviour).
   - If it appears NOWHERE else — i.e. the retired word is fully purged —
     the test FAILS with a clear message instructing the reader to delete
     `PROVENANCE_FILE_BASENAMES` (and `isProvenanceFile`, and the file-level
     exemption call sites) because it is now dead weight.

   The failure message MUST name the constant and the file, so a future
   maintainer hitting the red does not have to spelunk. The guard MUST NOT
   itself introduce a new `prd`-leak into non-exempt prose — keep the
   retired word out of the assertion message (build it from a
   non-leaking source, e.g. reading from the scan module, or split the
   letters, whatever the surrounding test file already does).

   Add a short comment above `PROVENANCE_FILE_BASENAMES` pointing at this
   guard so someone editing the list sees the expiry mechanism.

No done-record edit for the original observation is needed (per the human's
answer: the code cites the observation by filename, that IS the linkage;
this repo has no separate ratified/status field for observations).

## Acceptance

- `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- The observation file now states the wider criterion explicitly.
- The new expiry-guard test exists, is exercised by `pnpm -r test`, and
  passes today (because the retired word DOES still appear in exempted
  files' prose, which is the whole point of the exemption). Sanity-check
  the failure path locally by temporarily narrowing the search — do NOT
  commit that scaffolding.
- The comment above `PROVENANCE_FILE_BASENAMES` points at the expiry guard.

## Prompt

> You are picking up a task in the `dorfl` repo. The tree-wide retired-word
> scan lives at `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` and
> uses a `PROVENANCE_FILE_BASENAMES` allow-list to exempt whole files whose
> OWN SUBJECT is the retired `prd` vocabulary cutover. That list was
> introduced by the observation
> `work/notes/observations/word-scan-exempts-prd-cutover-task-bodies-2026-07-10.md`
> for a narrow criterion (the sweep task's own body) but has since grown to
> cover the hard-cutover task, an idea note, a derived spec, two fan-out
> tasks, and an incident note about the scan itself.
>
> Do two things:
>
> 1. Edit that observation to record the ACTUAL wider criterion — roughly:
>    any task/observation/spec/idea whose OWN SUBJECT is the retired `prd`
>    vocabulary, the sweep removing it, the skill/guard generalising that
>    sweep, or an incident about this scan. Cross-check every current entry
>    against the amended criterion and surface any misfit in the done
>    record rather than silently removing it. Do not open an ADR — a short
>    amendment inside the note is enough.
>
> 2. Add an expiry-guard test (in the same test file or a sibling) that
>    fails once the retired `prd`/`PRD` bare artifact word no longer
>    appears in `work/**` prose OUTSIDE the exempted files, instructing
>    the reader to delete `PROVENANCE_FILE_BASENAMES` +
>    `isProvenanceFile` + call sites. Use the same prose/code-span lens
>    as the existing scan. Make sure the guard itself does NOT leak the
>    retired word into non-exempt prose (source it from the module or
>    obfuscate it the way surrounding code does). Add a comment above
>    `PROVENANCE_FILE_BASENAMES` pointing at the guard.
>
> Do NOT touch any locked task body. Do NOT edit `work/protocol/` directly
> (edit the source in `skills/setup/protocol/` and mirror if a protocol doc
> is involved — it should not be, for this task). Do NOT perform any git
> operations; the runner owns those.
>
> Green gate: `pnpm format` then confirm
> `pnpm -r build && pnpm -r test && pnpm format:check` is clean.
