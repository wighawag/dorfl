---
title: Question sidecar files (work/questions/<type>-<slug>.md) render as run-together unfenced noise on GitHub, not human-readable Q&A
type: observation
status: spotted
spotted: 2026-06-17
triaged: keep
---

## What was seen

The `advance` family writes one question-per-item SIDECAR to
`work/questions/<type>-<slug>.md`, serialised by
`serialiseSidecar` (`packages/dorfl/src/sidecar.ts`). The on-disk shape is
a YAML-ish hybrid: frontmatter, then per-entry `## Q1` headings whose BODY is
bare key/value lines using YAML block scalars in raw Markdown:

```
## Q1
id: q1
question: |
  Should the lock be advisory or mandatory?
context: |
  The SPEC leaves this open in §4.
default: |
  advisory
answered: false
answer: |
```

On GitHub this renders BADLY because the entry body is NOT inside a code fence:

- the block-scalar pipes (`question: |`) and the 2-space indented continuation
  lines are markdown content, so GitHub collapses the indentation/newlines and
  the `|` shows literally — it reads as run-together prose, not a Q&A;
- `id:`/`answered:`/`answer:` are plain lines mixed into the prose flow with no
  structure a human skims;
- the whole point of the sidecar is that `ls work/questions/` + opening a file is
  the human's "what needs me?" dashboard answered IN-FILE on GitHub/locally — but
  the rendered file is the opposite of glance-able.

## Why it matters

The sidecar is the human-facing surface of the "human is the clock" loop (SPEC
`advance-loop`): the human reads the question and writes the answer in this file,
often through the GitHub web UI (the `on: push work/questions/**` answer-loop
trigger assumes commits to these files). If the rendered file is ugly/confusing,
the very humans the loop depends on get a worse experience exactly where it
matters most. The format was chosen to be tooling-OWNED and round-trip-stable,
but readability-on-GitHub was not a stated design goal and the current shape
sacrifices it.

## Tension to respect (NOT a decision)

The format is RESOLVED in the SPEC and is load-bearing: round-trip stability
(`parseSidecar(serialiseSidecar(m)) === m`), per-entry answered-state, stable
monotonic ids, tolerant human-edit parsing (human may write only `answer:`). Any
"format it nicer" change must keep those invariants and keep the human's answer
edit trivial. Candidate directions (unexplored):

1. Make the entry body a real fenced block so GitHub renders it verbatim, and
   keep the parser reading inside the fence.
2. Render a human-readable Markdown view (bold question, blockquote context,
   clearly-marked "write your answer below") while keeping a machine-parseable
   structure — i.e. redesign the serialiser so the SAME file is both pretty and
   parseable.
3. Separate a rendered view from the parsed source (least attractive: two things
   to keep in sync).

Needs a design decision (likely an ADR / SPEC touch-up) before any slice, since it
revisits a SPEC-RESOLVED format.

## Refs

- `packages/dorfl/src/sidecar.ts` — `serialiseSidecar` /
  `parseSidecar` / `blockField` (the format + the parser that must stay
  compatible).
- `packages/dorfl/test/sidecar.test.ts` — the round-trip + tolerant-parse
  tests any reformat must keep green.
- `work/spec-sliced/advance-loop.md` — "The sidecar FORMAT (RESOLVED here)" +
  MAINTAINER-RESOLVED §1 (the answered predicate); the SPEC that froze the shape.
- `skills/surface-questions/SKILL.md` — the documented sidecar format the surface
  rung hand-writes.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `task:question-sidecar-human-readable-format` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: The observation describes exactly the problem (sidecar `key: |` block scalars render as run-together noise on GitHub) that the now-DONE task `work/tasks/done/question-sidecar-human-readable-format.md` was built to solve — same file (`packages/dorfl/src/sidecar.ts`), same symptoms, same three candidate directions, resolved via the accepted ADR `docs/adr/question-sidecar-human-readable-format.md` with bold question + blockquote context + HTML-comment machine fields + labelled answer marker. Already covered.
