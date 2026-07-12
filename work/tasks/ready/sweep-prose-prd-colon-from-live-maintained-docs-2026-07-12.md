---
promotedFrom: observation:word-scan-keeps-prd-colon-as-provenance-not-live-alias-2026-07-10
---

## What to build

A small, deliberately-scoped prose sweep that replaces stray `prd:` references (field-key / verb form, i.e. the colon form `prd:`) with `spec:` in the live maintained documentation files listed below. This is the follow-up carved out by observation `word-scan-keeps-prd-colon-as-provenance-not-live-alias-2026-07-10`: after the hard cutover, the SRC-prose leak scan is the authoritative gate on live code, and the WORD scan deliberately keeps the `prd:` colon exemption to preserve terminal-history provenance in `work/**` done trees. But a handful of LIVE maintained docs still carry prose `prd:` and should be swept to `spec:` for consistency with the post-cutover vocabulary.

In scope (live maintained docs only):

- `docs/adr/methodology-and-skills.md`
- `docs/adr/land-primitive-rebase-reverify-advance.md`
- `skills/orchestrate/SKILL.md`

Explicitly OUT of scope:

- Anything under `work/tasks/done/**`, `work/findings/**`, `work/observations/**`, or other terminal-history / provenance trees. Those are immutable records of what the verb/field WAS at build time; rewriting them would falsify history. The WORD scan's `prd:` colon exemption is intentional PROVENANCE policy and must remain.
- The two leak-scan tests themselves (`prd-src-prose-leak-scan.test.ts`, `prd-word-cutover-leak-scan.test.ts`) — their current split (SRC = hard gate, WORD = provenance-tolerant) is the correct post-cutover shape and is not being revisited here.
- Any historical `prd:` reference INSIDE the three in-scope docs that is genuinely narrating the OLD name as history ("formerly `prd:`…"). If any such occurrences exist, leave them and note them in the task's done-writeup; they are provenance, not live vocabulary.

## Approach

1. `rg -n 'prd:' docs/adr/methodology-and-skills.md docs/adr/land-primitive-rebase-reverify-advance.md skills/orchestrate/SKILL.md` to enumerate every hit.
2. For each hit, decide: is this LIVE vocabulary ("the `prd:` field", "run `do prd:<slug>`", etc.) or PROVENANCE narration ("was previously `prd:`")? Rewrite the live-vocabulary ones to `spec:` / `spec` / `do spec:<slug>` as appropriate to the surrounding sentence. Leave provenance narration untouched.
3. Re-run the full verify gate to confirm nothing else broke and no new leak-scan hits appeared.

## Acceptance

- `rg -n '\bprd:' docs/adr/methodology-and-skills.md docs/adr/land-primitive-rebase-reverify-advance.md skills/orchestrate/SKILL.md` returns only the deliberately-preserved provenance-narration lines (ideally zero).
- No changes to files outside the three listed docs (in particular, no touches under `work/**`, no touches to the two leak-scan tests).
- `pnpm -r build && pnpm -r test && pnpm format:check` is green (SRC-prose scan stays green; WORD scan stays green — its `prd:` provenance exemption is unchanged).

## Prompt

> You are building a small prose sweep in the `dorfl` repo. After the hard cutover of the `prd:` field/verb to `spec:`, the SRC-prose leak scan is the authoritative gate on live code and the WORD scan deliberately keeps a `prd:` colon exemption so terminal-history provenance under `work/**` is not falsified. A handful of LIVE maintained docs still carry prose `prd:` and should now be swept to `spec:`.
>
> In scope (edit ONLY these three files):
>
> - `docs/adr/methodology-and-skills.md`
> - `docs/adr/land-primitive-rebase-reverify-advance.md`
> - `skills/orchestrate/SKILL.md`
>
> Out of scope (do NOT touch): anything under `work/**` (done tasks, findings, observations — all provenance), the two leak-scan tests (`prd-src-prose-leak-scan.test.ts` and `prd-word-cutover-leak-scan.test.ts` — their current SRC=hard-gate / WORD=provenance-tolerant split is the intended post-cutover shape), and any historical narration inside the three in-scope docs that is explicitly describing the OLD name ("formerly `prd:`…") — leave provenance narration untouched.
>
> Steps:
>
> 1. Run `rg -n 'prd:' docs/adr/methodology-and-skills.md docs/adr/land-primitive-rebase-reverify-advance.md skills/orchestrate/SKILL.md` to enumerate every hit.
> 2. For each hit, classify it as LIVE vocabulary or PROVENANCE narration. Rewrite live-vocabulary hits to the `spec` equivalent (`prd:` field → `spec:` field, `do prd:<slug>` verb → `do spec:<slug>`, etc.), matching the surrounding sentence style. Leave provenance narration untouched and note any such lines in your done-writeup.
> 3. Re-run `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green. The SRC-prose scan must stay green (no new live `prd:` hits); the WORD scan must stay green (its `prd:` provenance exemption is unchanged).
>
> Do NOT perform any git operations — the runner owns all git-state transitions. When the acceptance criteria above hold, you are done.