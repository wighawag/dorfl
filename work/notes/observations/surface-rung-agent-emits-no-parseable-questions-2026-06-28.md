---
title: surface rung fails with "no parseable {questions} result" when the agent emits non-JSON; the surface prompt lacked Gate-2's defensive-JSON hardening
date: 2026-06-28
status: open
---

## Signal (recurring failure, observed on two different observations)

The `advance` SURFACE rung crashed a CI propose leg with:

> error: surface observation:<slug>: the surface-questions agent produced no usable emit (surface agent produced no parseable {questions} result).

seen on TWO different untriaged observations in close succession (so not a one-off
dice roll):

- `obs:review-nits-install-ci-document-toolchain-boundary-2026-06-26`
- `obs:mechanical-blockedby-passes-while-true-implementation-premise-unmet-build-agent-is-backstop-2026-06-26`

Both items were untouched (the engine released the `advancing` borrow with "item
untouched" and wrote no sidecar — it correctly refuses to silently surface
nothing).

## Mechanism

`surfaceRung` -> `harnessSurfaceGate` launches `pi --print --session <file>`,
then reads the LAST assistant turn's text (`lastAssistantText`) and runs
`parseSurfaceEmit` -> `extractJsonObjectSpan(output, 'questions')`. The error is
thrown when the literal `"questions"` is absent from that last assistant text
(anchor === -1), i.e. the agent's final turn was NOT the required JSON object.

Root cause was a HARDENING GAP, not a logic bug: the surface prompt
(`buildSurfacePrompt`) only said "Output ONLY a single JSON object" and showed a
MULTI-LINE pretty-printed example (which invites the model to pretty-print and to
paste quoted excerpts with literal `"` / embedded newlines into `context`). The
Gate-2 verdict prompt (`verdictContractPrompt`) had ALREADY learned this lesson
(its "### Keep the JSON PARSEABLE (this is where weak models fail)" block, added
in response to `gate2-review-verdict-json-parse-crash-on-large-diffs`) but the
surface seam never got the same discipline — it was the lone un-hardened
agent->JSON->dispatch seam.

Cross-refs: `gate2-review-verdict-json-parse-crash-on-large-diffs.md` (the same
class of failure on the verdict gate), `pi-harness-jsonl-reliance.md` (the
.jsonl last-assistant-turn scrape is the brittle channel), and
`pi-yields-turn-early-with-work-pending.md` (a rarer cause: pi yields the turn
before the agent emits anything, unrecoverable in `--print` CI).

## Fix applied (this commit)

1. Extracted the Gate-2 "Keep the JSON PARSEABLE" discipline into a SHARED
   `parseableJsonContractPrompt(emitNoun, longestField?)` helper in
   `review-verdict.ts`; `verdictContractPrompt` now composes it (no behaviour
   change for the verdict gate).
2. `buildSurfacePrompt` now appends that shared contract AND presents its example
   as something to MINIFY (one line), mirroring the verdict prompt — so the
   surface seam carries the same defensive-JSON discipline instead of being the
   lone un-hardened one.

Deliberately NOT done (per maintainer): routing an unparseable surface emit to
needs-attention. The expectation is that this should rarely fail; a genuine miss
should just red that one CI leg (already harmless under `fail-fast:false`, the
next cron tick retries), NOT generate human-facing needs-attention noise.

## Residual / open

- The parser still reads only the LAST assistant turn + the FIRST `"questions"`
  occurrence; a trailing chatty turn could still shadow a good emit. Hardening
  `parseSurfaceEmit` to scan ALL turns for the LAST parseable `{questions}`
  object was held back as secondary insurance — revisit ONLY if misses persist
  after the prompt fix.
- The `pi-yields-turn-early` cause is unfixable by prompt wording (no JSON is
  emitted at all); it belongs to pi, not dorfl.
