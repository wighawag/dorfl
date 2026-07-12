---
promotedFrom: observation:word-scan-exempts-prd-cutover-task-bodies-2026-07-10
---

## What to build

Two small, related changes anchored to the ratified observation
`work/notes/observations/word-scan-exempts-prd-cutover-task-bodies-2026-07-10.md`
and its implementation in
`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts`
(the `PROVENANCE_FILE_BASENAMES` allow-list + `isProvenanceFile`).

1. **Amend the observation to state the ACTUAL, WIDER criterion.**
   The original decision record contemplated exempting task/observation
   bodies whose OWN SUBJECT is the retired-vocabulary sweep. In practice the
   list has grown to also cover: the hard-cutover task, a forward-looking idea
   note, a derived spec (`vocabulary-cutover-prose-sweep-skill.md`), the two
   fan-out tasks for that spec (skill authoring + conformance guard), and an
   incident note about the scan tripping on bot-generated triage sidecars.
   That is broader than "the sweep task's own body".

   Amend the observation body (this is a note, edits are allowed — the
   ratified decision stays; you are honestly recording what the criterion
   grew INTO) to spell out the wider criterion explicitly, e.g. roughly:
   "any task / observation / spec / idea whose OWN SUBJECT is the retired
   `prd` vocabulary, the sweep that removes it, the skill/guard authored to
   generalise that sweep, or an incident about this scan itself — such a
   file legitimately quotes the retired word + `work/prds/…` path in prose
   to describe what it converts FROM / removes / documents". Keep it short;
   a follow-up note or short amendment section in the same file is fine —
   a full ADR is explicitly NOT required (per the human's answer).

   Cross-check every current entry in `PROVENANCE_FILE_BASENAMES` against
   the amended criterion; if any entry does NOT fit, call it out (do not
   silently remove — surface it in the task's done record so a human can
   decide).

2. **Add an expiry / cleanup guard so the list cannot silently rot** once
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
