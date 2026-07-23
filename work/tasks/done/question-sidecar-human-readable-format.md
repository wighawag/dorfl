---
title: 'Reformat the question sidecar to a human-readable Markdown surface (machine fields in HTML comments)'
slug: question-sidecar-human-readable-format
blockedBy: []
covers: []
---

## What to build

Rewrite the question/answer SIDECAR format (`work/questions/<type>-<slug>.md`) so the SAME file is
both human-readable on GitHub AND machine-parseable, per the ADR
`docs/adr/question-sidecar-human-readable-format.md` (accepted). Today the sidecar renders as
run-together noise on GitHub: per-entry `## Qn` headings with bare `key: |` YAML block scalars, so the
`|` pipes show literally and indentation collapses. The human reads the question and writes the answer
IN THIS FILE (often via the GitHub web UI), so readability matters most exactly here.

New shape (canonical serialiser output):

- An identity HTML comment at the top carrying the machine frontmatter (`item`, `type`, `slug`,
  `allAnswered`), e.g. `<!-- dorfl-sidecar: ... -->`. GitHub renders HTML comments as NOTHING.
- Per entry: the question as a BOLD line, context as a BLOCKQUOTE, the suggested default as ITALIC,
  then a per-entry machine HTML comment (`<!-- qN fields: id=q1 answered=false disposition=keep -->`),
  then a fixed labelled answer region the human types prose under
  (`**Your answer** (write below this line):`).
- The answer is HEADING-DELIMITED: it spans from the answer marker up to the next entry heading (NOT a
  `---` rule), so a human cannot break parsing by typing `---` inside an answer.

The model (`SidecarModel` / `SidecarEntry` in `sidecar.ts`) does NOT change — only the on-disk TEXT
format (serialise + parse) and the human-facing skill doc.

## Acceptance criteria

- [ ] `serialiseSidecar` emits the new Markdown-plus-HTML-comment format; the entry body is real
      Markdown (bold question, blockquote context, italic default) and the machine fields (item/type/
      slug/allAnswered, and per-entry id/answered/disposition) live ONLY in HTML comments.
- [ ] `parseSidecar` reads the new format back into the SAME `SidecarModel`: it recovers identity from
      the top HTML comment, per-entry id/answered/disposition from the per-entry HTML comment, and the
      answer as the heading-delimited region under the answer marker.
- [ ] SEMANTIC round-trip (ADR trade-off a): `parseSidecar(serialiseSidecar(m))` recovers an EQUAL
      MODEL (entries, ids, answers, answered-state, dispositions) — NOT necessarily byte-identical
      text; re-serialising canonicalises. The load-bearing rules are preserved: a non-empty answer =>
      answered (with an explicit `answered:` override still honoured), stable monotonic ids, and the
      tolerant "the human writes only the answer prose" edit (a human who types only under the answer
      marker, touching no machine comment, still parses correctly and derives answered=true).
- [ ] Answer boundary is heading-delimited (ADR trade-off b): an answer containing a literal `---`
      line still parses as one answer; a test pins this.
- [ ] CLEAN CUTOVER (ADR trade-off c): the parser reads the NEW format only (no dual-format support).
      MIGRATE every live sidecar in this repo (`work/questions/*.md`) to the new format in this change
      so none is left un-parseable. (At task-creation time the live set is the 3 observation sidecars
      pi-harness-jsonl-reliance, pi-yields-turn-early-with-work-pending,
      rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset; re-check at build time.)
- [ ] The surface-questions skill (`skills/surface-questions/SKILL.md`) is updated to document the new
      hand-written shape (so the surface rung's agent writes the new format), and the `advance-loop`
      brief's "sidecar FORMAT (RESOLVED here)" section (`work/briefs/tasked/advance-loop.md`) points to
      the ADR.
- [ ] `sidecar.test.ts` is rewritten to cover the new format: serialise shape, parse-back, the semantic
      round-trip, the tolerant human-only-answer edit, the heading-delimited answer (incl. an answer
      with a literal `---`), per-entry disposition survival, and the `allAnswered` derivation.
- [ ] A rendered sample is eyeballed (or pinned as a fixture) to confirm the entry reads as a clean
      bold-question + blockquote-context + labelled-answer on GitHub Markdown (no literal `|`, no
      collapsed indentation).
- [ ] Tests use throwaway repos + a local `--bare file://` arbiter where they touch git; the sidecar
      format tests are pure serialise/parse unit tests. Nothing writes outside its own temp fixtures.

## Blocked by

- None — can start immediately. The format decision is settled in
  `docs/adr/question-sidecar-human-readable-format.md`.

## Prompt

> Rewrite the question/answer sidecar format to be human-readable on GitHub while staying
> machine-parseable. READ `docs/adr/question-sidecar-human-readable-format.md` FIRST — it is the
> accepted decision and carries the three ratified trade-offs (semantic round-trip, heading-delimited
> answer, clean cutover + migrate). Do NOT re-open those; implement them.
>
> The code seam is `packages/dorfl/src/sidecar.ts` — `serialiseSidecar`, `parseSidecar`, and the
> `blockField` helper (the current `key: |` block-scalar emitter, which goes away). The model
> (`SidecarModel`/`SidecarEntry`) is UNCHANGED; only the on-disk text format changes. The new format:
> an identity HTML comment at the top (item/type/slug/allAnswered); per entry a bold question line, a
> blockquote context, an italic suggested-default, a per-entry HTML comment carrying id/answered/
> disposition, and a fixed `**Your answer** (write below this line):` marker whose following region (up
> to the next entry heading) is the answer. HTML comments render as nothing on GitHub, so the machine
> state is invisible and unbreakable by the human's edit; the human just types prose under the answer
> marker with no format knowledge.
>
> Preserve the load-bearing rules: a non-empty answer => answered (explicit `answered:` override still
> honoured); stable monotonic ids; the tolerant edit (a human who types ONLY under the answer marker,
> touching no comment, still parses + derives answered). Round-trip is SEMANTIC (model-equal, not
> byte-equal) — re-serialising canonicalises. The answer is heading-delimited so a literal `---` inside
> an answer does not break parsing.
>
> CLEAN CUTOVER: the parser reads the new format only. MIGRATE every live `work/questions/*.md` in this
> repo to the new format in the same change (re-list them at build time; do not assume the count). Then
> update `skills/surface-questions/SKILL.md` to document the new hand-written shape, and repoint the
> `advance-loop` brief's "sidecar FORMAT (RESOLVED here)" section
> (`work/briefs/tasked/advance-loop.md`) to the ADR.
>
> Rewrite `packages/dorfl/test/sidecar.test.ts` for the new format (serialise shape, parse-back,
> semantic round-trip, tolerant human-only-answer edit, heading-delimited answer including one with a
> literal `---`, disposition survival, `allAnswered` derivation). "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green. Test on throwaway repos + a
> `--bare file://` arbiter where git is touched. RECORD any non-obvious in-scope decision per the task
> template; the format decision itself is already in the ADR, so you should not need a new one.
