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

## Recurrence + the REAL root-cause fix (2026-06-28, second pass)

The prompt-hardening above did NOT stop it: the SAME item
(`review-nits-install-ci-document-toolchain-boundary`) red the surface leg again.
Re-investigation (maintainer's prompt: "why does the agent have no clean end
message, like Gate 2 does?") found the ACTUAL asymmetry with the reliable verdict
gate. It is NOT the JSON contract (both seams now share
`parseableJsonContractPrompt`). It is that **the verdict emit has a dedicated
prose channel INSIDE the JSON — the `review` field — and the verdict prompt tells
the agent to put its human-facing explanation there and to NOT narrate its
process.** So the verdict agent's prose has a home inside the object and its last
turn is a clean single JSON object.

The surface seam had NO such channel. After heavy investigation (it composes the
whole `review` sub-discipline + probes an observation against reality) the agent
has reasoning it wants to express, and `SURFACE-PROTOCOL.md` even said to emit an
empty array "and say so" — inviting prose. With nowhere INSIDE the object to put
it, the agent narrated around the JSON or added a trailing chatty turn; the reader
(`lastAssistantText`) sees only the LAST turn, so the good emit is discarded.

Fix (this pass), mirroring Gate-2's discipline — ONE lever, the prompt, not the
parser:

1. `buildSurfacePrompt` now offers an optional free-prose `note` field (the
   surface counterpart of the verdict's `review`) as the HOME for the agent's
   reasoning/findings, and adds the verdict gate's terminal-emit discipline: the
   JSON object is the FINAL and ONLY output, do NOT narrate, add no remark before
   or after, take no further turn. `note` is now the length-capped longest field.
2. `SURFACE-PROTOCOL.md` (source + propagated copy) documents the `note` channel
   and replaces the "and say so" prose-invitation with "emit the empty-array
   OBJECT (put WHY in `note`)" + the same terminal-emit rule.
3. The parser is UNCHANGED: it already ignores unrecognised fields, so `note` is
   simply parsed past (the engine does not persist it).

Reverted the first-pass exploration that the maintainer rejected (cross-turn /
all-messages scanning): not every harness can surface all turns, and the right
fix is to make the agent produce a clean terminal emit, not to scrape around a
messy one. So `extractLastParseableObjectSpan` / `allAssistantTexts` were NOT
kept.

## Residual / open

- The parser still reads only the LAST assistant turn + the FIRST `"questions"`
  occurrence. The second-pass fix attacks the CAUSE (give prose a home + demand a
  clean terminal emit) rather than scraping a messy transcript; the maintainer
  explicitly rejected cross-turn / all-messages scanning (not every harness can
  do it). Revisit parser-side insurance ONLY if misses persist after this prompt
  fix too — and even then prefer the prose-channel lever.
- The `pi-yields-turn-early` cause is unfixable by prompt wording (no JSON is
  emitted at all); it belongs to pi, not dorfl.
