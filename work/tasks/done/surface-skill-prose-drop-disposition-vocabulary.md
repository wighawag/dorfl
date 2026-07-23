---
title: 'Drop the disposition vocabulary from surface/skill prose'
slug: surface-skill-prose-drop-disposition-vocabulary
spec: agentic-question-resolution-retire-disposition-vocabulary
blockedBy: [agentic-apply-retire-disposition-vocabulary]
covers: [6]
---

## What to build

Remove the disposition-token vocabulary from the OPERATOR-FACING prose, so the
docs/skills match the shipped binary-entry engine. A thin vertical path through the
doc layer + the byte-identical protocol copies:

- **SURFACE-PROTOCOL.md.** Remove the `disposition` field from the emitted-question
  shape and the `promote-task | promote-spec | promote-adr | keep | delete | dropped
  | needs-attention` value list. A surfaced question is no longer a "pick a
  disposition" instruction — a sidecar entry is binary (no-answer | answered). Edit
  BOTH the SOURCE (`skills/setup/protocol/SURFACE-PROTOCOL.md`) AND the propagated
  COPY (`work/protocol/SURFACE-PROTOCOL.md`), keeping them byte-identical (per this
  repo's AGENTS.md protocol-source rule).
- **Skill prose.** Update the `answer-questions` and `surface-questions` skill prose
  to drop any reference to typing/learning a disposition token: the operator answers
  in PLAIN LANGUAGE; the system reads the answer (US #1). Mention the direct-delete
  path (the human/skill/CLI just deletes) where the prose currently describes a
  `delete`/`dropped` disposition.
- **WORK-CONTRACT.md (the now-stale discharge paragraph).** The contract describes
  deletion-on-apply USING the retired tokens (`promote-task`/`promote-spec`/
  `promote-adr`, `dropped`/`duplicate` — around the "Deletion-on-apply is the
  SANCTIONED discharge" paragraph). With the vocabulary retired and apply now
  agent-verdict-driven, rewrite that paragraph so it describes the discharge in
  terms of the human's ANSWER + the agent's VERDICT (mint / delete-source), not the
  disposition tokens — preserving its actual RULE (deletion-on-apply is
  human-authored; work items leave via a terminal folder, only notes discharge by
  deletion). Edit BOTH the source (`skills/setup/protocol/WORK-CONTRACT.md`) and the
  copy (`work/protocol/WORK-CONTRACT.md`), byte-identical (same two-copies rule as
  SURFACE-PROTOCOL).

TOKEN vs generic English (do NOT over-reach): remove/rewrite only the disposition
TOKEN VOCABULARY. The plain-English word "disposition" survives where it is NOT the
token set — e.g. TASKING-PROTOCOL.md's "the decomposition, not the disposition" and
REVIEW-PROTOCOL.md's "the assessment, not the disposition" are generic usage and
MUST be left untouched. A blanket "delete every mention of disposition" would
wrongly gut those.

NOT in this task: the `triage-observations` skill's recommendation vocabulary is
updated by the SEPARATE final task `triage-observations-skill-retire-disposition-vocabulary`
(it is a larger human-workflow surface; kept separate so this doc-sync task stays
focused). This task also does NOT touch `surface-gate.ts`/`triage-gate.ts` — those
are CODE owned by the keystone (which removes their disposition emit, including the
prompt-string token list).

This is doc-only and file-orthogonal to the hot files; it is blocked by the keystone
so the prose describes the engine that actually shipped (no window where the docs
promise a binary entry while the code still parses dispositions).

## Acceptance criteria

- [ ] `SURFACE-PROTOCOL.md` no longer documents a `disposition` field or the token
      value list; the emitted-question shape is binary (no-answer | answered).
- [ ] The SOURCE (`skills/setup/protocol/SURFACE-PROTOCOL.md`) and the COPY
      (`work/protocol/SURFACE-PROTOCOL.md`) are byte-identical (`diff` clean).
- [ ] The `answer-questions` / `surface-questions` skill prose drops the
      disposition vocabulary; it describes answering in plain language + the
      direct-delete path.
- [ ] The WORK-CONTRACT.md deletion-on-apply paragraph no longer uses the retired
      tokens; it describes the discharge via the human's answer + the agent's
      verdict, preserving its rule. Source + copy byte-identical (`diff` clean).
- [ ] No stray reference to `promote-* | keep | delete | dropped | needs-attention`
      AS A DISPOSITION TOKEN remains in the IN-SCOPE prose (SURFACE-PROTOCOL.md,
      WORK-CONTRACT.md, answer-questions, surface-questions). The
      `needs-attention/` LIFECYCLE state may still be referenced (separate concern,
      NOT removed); the generic-English word "disposition" in TASKING-PROTOCOL.md /
      REVIEW-PROTOCOL.md is LEFT untouched; `triage-observations` is the separate
      final task's job.
- [ ] `pnpm format:check` passes (the doc edits are formatted).

## Blocked by

- `agentic-apply-retire-disposition-vocabulary` — the prose must describe the
  shipped binary-entry engine, not a vocabulary the code still parses.

## Prompt

> Remove the disposition-token vocabulary from dorfl's OPERATOR-FACING prose so the
> docs and skills match the shipped engine (where a sidecar entry is BINARY:
> no-answer | answered, and the human answers in plain language). This is doc-only.
>
> What to edit:
> - `SURFACE-PROTOCOL.md`: drop the `disposition` field from the emitted-question
>   shape and remove the `promote-task | promote-spec | promote-adr | keep | delete |
>   dropped | needs-attention` value list. A surfaced question is no longer "pick a
>   disposition". CRUCIAL (this repo's AGENTS.md rule): the protocol doc exists in
>   TWO places — the SOURCE OF TRUTH `skills/setup/protocol/SURFACE-PROTOCOL.md` and
>   the propagated COPY `work/protocol/SURFACE-PROTOCOL.md`. Edit the SOURCE and
>   mirror the SAME change into the copy so the two stay byte-identical
>   (`diff skills/setup/protocol/SURFACE-PROTOCOL.md work/protocol/SURFACE-PROTOCOL.md`
>   must be clean). Editing only the copy silently drifts it and the next `setup`
>   run re-propagates the OLD source.
> - The `answer-questions` and `surface-questions` skill prose (under `skills/`):
>   drop any reference to typing or learning a disposition token. The operator
>   answers in PLAIN LANGUAGE; the system reads the answer (US #1). Where the prose
>   currently describes a `delete`/`dropped` disposition, point at the direct-delete
>   path instead (the human/skill/CLI just deletes — see the
>   `direct-delete-question-cli-helper` task / verb).
> - `WORK-CONTRACT.md` (BOTH `skills/setup/protocol/` source AND `work/protocol/`
>   copy, byte-identical): the "Deletion-on-apply is the SANCTIONED discharge"
>   paragraph describes the discharge using the retired tokens
>   (`promote-task`/`promote-spec`/`promote-adr`, `dropped`/`duplicate`). Rewrite it
>   to describe the discharge via the human's ANSWER + the agent's VERDICT (mint /
>   delete-source), NOT the tokens — while PRESERVING the rule it states
>   (deletion-on-apply is human-authored, not a unilateral agent destroy; work
>   items leave via a terminal FOLDER, only notes discharge by deletion; no
>   resting `triaged:`/`## Recommended: delete` state).
>
> TOKEN vs GENERIC ENGLISH — do NOT over-reach. Remove/rewrite ONLY the disposition
> TOKEN VOCABULARY. The plain-English word "disposition" SURVIVES where it is not the
> token set: e.g. `TASKING-PROTOCOL.md` ("the decomposition, not the disposition")
> and `REVIEW-PROTOCOL.md` ("the assessment, not the disposition") are generic usage
> — LEAVE them. A blanket grep-and-delete of "disposition" would wrongly gut these.
>
> NOT YOURS: do NOT edit `skills/triage-observations/SKILL.md` (its recommendation
> vocabulary is the separate final task
> `triage-observations-skill-retire-disposition-vocabulary`). Do NOT edit
> `surface-gate.ts`/`triage-gate.ts` (CODE owned by the keystone, which removes
> their disposition emit including the prompt-string token list). Stay in the docs/
> skills named above.
>
> Boundary: the `needs-attention/` LIFECYCLE state (bounced build / stuck lock) is a
> SEPARATE concern — do NOT remove references to that. Only the disposition TOKEN
> vocabulary goes.
>
> "Done": no operator-facing prose documents the disposition vocabulary; the
> SURFACE-PROTOCOL source and copy are byte-identical; the skills describe plain-
> language answering + direct delete. Acceptance:
> `pnpm -r build && pnpm -r test && pnpm format:check` is green (run `pnpm format`
> first if needed).
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): confirm the keystone task `agentic-apply-retire-disposition-vocabulary`
> landed and the engine is now binary-entry (so the prose you write is true), and
> confirm where the disposition vocabulary currently appears in the prose. If the
> keystone landed differently than assumed, do NOT write prose that contradicts the
> shipped code — route the task to needs-attention with the discrepancy as the
> reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while editing (e.g. how you reword
> the emitted-question shape, what replaces the disposition concept in the skill
> flow). A doc decision that is hard to reverse + surprising warrants an ADR;
> otherwise note it briefly in the done record / PR description.

---

### Claiming this task

```sh
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/<slug>.md work/tasks/done/<slug>.md
```
