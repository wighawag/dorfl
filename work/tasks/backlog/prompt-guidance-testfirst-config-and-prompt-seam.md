---
title: 'promptGuidance.testFirst: config schema + resolver + in-band prompt nudge (tracer)'
slug: prompt-guidance-testfirst-config-and-prompt-seam
brief: prompt-guidance-test-first
needsAnswers: true
blockedBy: []
covers: [1, 2, 3, 4, 7, 8]
---

## What to build

The core tracer for `promptGuidance.testFirst`: a thin end-to-end path through schema → resolution → prompt assembly → tests, with NO change to enforcement (the `verify` gate stays the only acceptance bar).

End-to-end behaviour:

1. `.agent-runner.json` accepts a new top-level object `promptGuidance` whose first member is `testFirst: boolean`. It is its OWN namespace, deliberately NOT inside the gate family (`verify`/`autoBuild`/`humanOnly`), so the name itself signals "nudge, not guarantee". Omitted ⇒ `false`. The namespace is shaped so adding sibling nudges later (e.g. `preferSmallDiffs`) is a same-pattern addition, not a refactor.
2. The resolved value is computed via the SAME precedence chain the gate family already uses: `CLI flag > env (AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST or whatever matches existing naming) > per-repo config > global config > built-in default (false)`. Reuse the existing resolver pattern in `packages/agent-runner/src/config.ts` (the same shape as `autoBuild`/`autoSlice`), do NOT invent a parallel mechanism.
3. When the runner assembles the worker prompt (`prompt.ts` + the CLAIM-PROTOCOL wrapper), the existing soft line — currently `"Implement it to satisfy every Acceptance criterion. TDD where the task asks for it; match the repo's house style."` in `skills/setup/protocol/CLAIM-PROTOCOL.md` (and the mirrored `work/protocol/CLAIM-PROTOCOL.md`) — is STRENGTHENED in-band when the nudge resolves to `true`, to something equivalent to: _"at the agreed seam, write the failing test BEFORE the production code; this is guidance, not a gate — the `verify` step still decides pass/fail."_ When the nudge resolves to `false`, the wrapper is byte-identical to today.
4. The canonical strengthened text lives in the PROTOCOL DOC (`CLAIM-PROTOCOL.md`), NOT as a TS string literal — per the existing "wrapper text is read verbatim from CLAIM-PROTOCOL.md" rule. Whatever mechanism is chosen (see Open question), the text source-of-truth stays in the markdown.
5. Both copies of the protocol stay byte-identical: `skills/setup/protocol/CLAIM-PROTOCOL.md` is the SOURCE; `work/protocol/CLAIM-PROTOCOL.md` is the propagated mirror (per repo `AGENTS.md`).

Out of scope for this slice (covered by sibling tasks): per-item frontmatter override (`prompt-guidance-testfirst-item-override`); setup adoption-chat question (`prompt-guidance-testfirst-setup-question`).

## Open question (needsAnswers)

The PRD explicitly defers one slicing-time choice and the answer shapes this slice's seam:

> "Confirm the cleanest seam: a conditional fragment in CLAIM-PROTOCOL, or a flag-gated wrapper variant. Pick the option that keeps the canonical text in the protocol doc, not in TS."

Both candidates keep the text in the protocol doc, so the constraint alone does not pick one. Please decide and record (ADR-worthy if non-trivial):

- **Option A — single wrapper, conditional fragment inside it.** CLAIM-PROTOCOL.md carries both the soft line AND the strengthened line, with delimited markers (e.g. `<!-- if promptGuidance.testFirst -->` … `<!-- /if -->`) that the wrapper extractor in `prompt.ts` strips or keeps based on the resolved flag. One wrapper section, one parse pass conditioned on one boolean.
- **Option B — two named wrapper variants in the same doc.** CLAIM-PROTOCOL.md exposes two fenced wrapper blocks under named sub-headings (e.g. "The prompt handed to the work agent — default" and "… — test-first"); `prompt.ts` selects which to read based on the flag. No new templating in TS, just selector logic.

Decide WHICH and update this slice (or split if needed) before building. Bias: pick whichever change is smaller to the existing CLAIM-PROTOCOL extraction code in `packages/agent-runner/src/prompt.ts` (search for the "prompt handed to the work agent" heading scan) AND keeps a single source of truth for the wrapper. If a third, cleaner option emerges (e.g. an append-only line the wrapper appends iff the flag is on), record it as Option C and choose explicitly.

A secondary question that may need the same decision: does the strengthened text REPLACE the existing soft "TDD where the task asks for it" line, or APPEND/follow it? The PRD says "strengthened", which reads as REPLACE, but a reviewer should confirm.

## Acceptance criteria

- [ ] `.agent-runner.json` parses `promptGuidance.testFirst: true|false` without warning; unknown keys under `promptGuidance` are tolerated/warned per the existing config-tolerance pattern, with `testFirst` the only declared member.
- [ ] Resolution precedence is identical in shape to `autoBuild`/`autoSlice`: CLI flag > env > per-repo > global > default `false`. Tests mirror the existing gate-family resolution tests in `packages/agent-runner/test/config.test.ts`.
- [ ] With the nudge resolved `false`, the assembled worker prompt is BYTE-IDENTICAL to today's (a snapshot/text equality test guards this — the existing prompt tests in `packages/agent-runner/test/prompt.test.ts` are the model).
- [ ] With the nudge resolved `true`, the assembled worker prompt contains the strengthened test-first line (assert on the visible string at the prompt-assembly seam), and the original soft phrasing is gone (or supplemented, per the decision above).
- [ ] The strengthened text is sourced from `CLAIM-PROTOCOL.md`, not a TS literal (verify by editing only the markdown and watching the prompt change in a test).
- [ ] `skills/setup/protocol/CLAIM-PROTOCOL.md` and `work/protocol/CLAIM-PROTOCOL.md` remain byte-identical after the change (a `diff` between them in CI / a doc-mirror check is clean).
- [ ] No change to `verify` semantics — no acceptance bar moves; tests around `verify` still pass unchanged.
- [ ] AGENTS.md is not written or modified by this slice (setup invariant — see PRD Out of Scope).
- [ ] No test in this slice writes to a shared / global location; all fixtures stay in temp dirs.

## Blocked by

- None — can start immediately once the seam question above is answered.

## Prompt

> You are adding a NUDGE category to `agent-runner`: a per-repo, per-item knob `promptGuidance.testFirst` that, when on, strengthens the worker prompt's existing "TDD where the task asks for it" line into an explicit test-first nudge. It is GUIDANCE, not a gate — `verify` remains the sole acceptance bar.
>
> FIRST: read the source brief at `work/briefs/ready/prompt-guidance-test-first.md` end-to-end, then read this task's Open question above and confirm with the requester (or via an ADR if it meets the ADR bar — see `work/protocol/ADR-FORMAT.md`) WHICH seam option (A/B/C) to implement. Do NOT guess: the choice affects the wrapper extractor in `packages/agent-runner/src/prompt.ts` and the shape of the strengthened text in `CLAIM-PROTOCOL.md`. Once decided, clear `needsAnswers` and record the choice (an ADR if non-trivial; otherwise a `## Decisions` block on completion).
>
> DOMAIN VOCAB (see `CONTEXT.md` + `work/protocol/WORK-CONTRACT.md`): `nudge` (prompt-text knob, NOT an enforced gate); `gate family` (`verify`/`autoBuild`/`humanOnly` — categorically separate from nudges); `in-band-for-portability` (the worker's load-bearing channel is the prompt, never AGENTS.md); `wrapper` (the constant frame `prompt.ts` puts around each task's `## Prompt`, whose text lives in `CLAIM-PROTOCOL.md`).
>
> WHERE TO LOOK (by concept, not brittle paths): the config schema and resolver in `packages/agent-runner/src/config.ts` (find `autoBuild` and mirror its precedence chain — flag > env > per-repo > global > default `false`); the prompt assembly in `packages/agent-runner/src/prompt.ts` (the section that locates `CLAIM-PROTOCOL.md` and the "prompt handed to the work agent" heading); the canonical wrapper text in `skills/setup/protocol/CLAIM-PROTOCOL.md` (SOURCE OF TRUTH) and its mirror `work/protocol/CLAIM-PROTOCOL.md` (propagated COPY — see this repo's `AGENTS.md` "Protocol docs — edit the SOURCE" rule; the two MUST stay byte-identical).
>
> SEAMS TO TEST AT: the config-resolution seam (precedence test, mirroring `packages/agent-runner/test/config.test.ts` for `autoBuild`/`autoSlice`); the prompt-assembly seam (assemble the prompt with the nudge off/on and assert the wrapper text, mirroring `packages/agent-runner/test/prompt.test.ts`). Do NOT try to test "the worker actually wrote tests first" — unobservable by design; that non-enforceability is exactly why this is a nudge (PRD Out of Scope §1).
>
> CONSTRAINTS: the strengthened text MUST live in `CLAIM-PROTOCOL.md`, not as a TS literal. AGENTS.md MUST NOT be touched by this feature. The `verify` gate's semantics MUST NOT change.
>
> DONE means: schema accepts and ignores correctly; resolver precedence matches the gate family; prompt is byte-identical to today when nudge is off and contains the strengthened line (sourced from markdown) when on; both protocol-doc copies stay in sync; the acceptance gate is green via `pnpm -r build && pnpm -r test && pnpm format:check` (see repo `AGENTS.md`).
>
> RECORD non-obvious in-scope decisions (especially the seam choice and the replace-vs-append question) per `work/protocol/CLAIM-PROTOCOL.md`'s decision-recording rules — ADR if it meets the ADR bar, otherwise a `## Decisions` block on the done record.
