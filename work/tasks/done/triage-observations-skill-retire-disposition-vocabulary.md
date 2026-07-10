---
title: Retire the disposition vocabulary from the triage-observations skill
slug: triage-observations-skill-retire-disposition-vocabulary
spec: agentic-question-resolution-retire-disposition-vocabulary
blockedBy: [surface-skill-prose-drop-disposition-vocabulary]
covers: [6]
---

## What to build

Update the `triage-observations` skill (and sweep the borderline mentions in
`orchestrate` / `work`) so the operator-facing observation-draining workflow matches
the retired-vocabulary, agent-driven world (US #6). The final prose surface, kept
separate from the protocol-doc sync (#5) because it is a larger human-workflow
rewrite. A thin doc-only path:

- **`skills/triage-observations/SKILL.md`.** This is the human, no-runner inbox-drain
  workflow; it carries its OWN `## The disposition vocabulary` section + table
  (`leave | delete | make a task | amend | fold-into-ADR`) and uses "disposition"
  throughout. With the engine's disposition tokens retired and apply now
  agent-driven, bring this skill into line: the human answers/decides in plain terms;
  promotion mints a self-contained task/prd/ADR; throwing a signal away is the
  DIRECT delete (the `direct-delete-question-cli-helper` verb / `git rm`), not a
  disposition token round-tripped through an engine. Preserve the skill's actual
  WORKFLOW (investigate → recommend → human decides → execute, the live-only inbox
  goal, the heavy-work-hands-off-as-a-prompt rule); only the VOCABULARY framing
  changes. Decide whether the skill's own recommendation taxonomy
  (`leave/delete/make-task/amend/fold-into-ADR`) is kept as a HUMAN workflow
  taxonomy (it is distinct from the engine's retired `disposition=` tokens) or
  re-expressed — RECORD that decision; the bar is that nothing implies the retired
  ENGINE token vocabulary is still live.
- **Borderline sweeps.** `skills/orchestrate/SKILL.md` ("triage them
  (route/keep/delete) where the disposition is obvious") and `skills/work/SKILL.md`
  ("recommend a disposition") use the word loosely in a way that echoes the retired
  tokens. Reword so they do not imply the retired token vocabulary; keep them
  pointing at the `triage-observations` skill.
- **Token vs generic English.** As in #5: only the disposition TOKEN VOCABULARY is
  retired. Generic-English "disposition" elsewhere is fine. Do not gut prose that
  merely uses the word.

`triage-observations` is a PLAIN skill (single copy under `skills/`, no
`work/protocol/` mirror) — no byte-identical-pair concern here.

## Acceptance criteria

- [ ] `skills/triage-observations/SKILL.md` no longer implies the retired ENGINE
      disposition token vocabulary is live; promotion/throw-away are described via
      mint-a-self-contained-artifact and the direct-delete path; the skill's
      investigate→recommend→decide→execute workflow + live-only-inbox goal +
      hands-off-heavy-work rule are PRESERVED.
- [ ] The kept-vs-reframed decision for the skill's own
      `leave/delete/make-task/amend/fold-into-ADR` taxonomy is RECORDED (done note /
      PR description), with the rationale that it is a human-workflow taxonomy
      distinct from the engine's retired `disposition=` tokens.
- [ ] `orchestrate` and `work` skill mentions are reworded to not imply the retired
      token vocabulary, still pointing at `triage-observations`.
- [ ] Generic-English "disposition" (e.g. in TASKING/REVIEW-PROTOCOL.md) is left
      untouched; this task does not over-reach beyond the named files.
- [ ] `pnpm format:check` passes.

## Blocked by

- `surface-skill-prose-drop-disposition-vocabulary` — the protocol-doc prose
  (SURFACE-PROTOCOL.md, WORK-CONTRACT.md) is settled there first; this task completes
  the operator-facing prose sweep on top of it. (Transitively after the keystone, so
  the engine has actually shipped binary-entry before any prose claims it.)

## Prompt

> Update dorfl's `triage-observations` skill (plus borderline mentions in
> `orchestrate` and `work`) so the operator-facing observation-draining prose matches
> the retired-vocabulary, agent-driven world. This is doc-only and the FINAL prose
> sweep for US #6 (the protocol docs were handled by the sibling
> `surface-skill-prose-drop-disposition-vocabulary`).
>
> Context: dorfl retired the sidecar `disposition=` token vocabulary (`promote-task |
> promote-prd | promote-adr | keep | delete | dropped | needs-attention`); the apply
> rung is now agent-verdict-driven (mint-task / mint-prd / delete-source /
> ask-follow-up), and throwing a signal away outright is a DIRECT delete (the
> `direct-delete-question-cli-helper` verb / `git rm`), not a token round-tripped
> through the engine.
>
> What to edit:
> - `skills/triage-observations/SKILL.md`: the human, no-runner inbox-drain workflow.
>   It has its OWN `## The disposition vocabulary` table
>   (`leave | delete | make a task | amend | fold-into-ADR`) and uses "disposition"
>   throughout. IMPORTANT nuance (a real judgement the human asked to be made HERE):
>   this skill's taxonomy is ADJACENT to but NOT the same as the engine's retired
>   `disposition=` tokens — it is a human workflow's recommendation set. So you are
>   NOT mechanically deleting it; you are ensuring nothing in this skill implies the
>   retired ENGINE token vocabulary is still live, and that promotion (mint a
>   self-contained task/prd/ADR) and throw-away (the direct-delete verb / `git rm`)
>   are described in today's terms. PRESERVE the skill's workflow
>   (investigate → recommend → human decides → execute), its live-only-inbox goal,
>   and its hand-off-heavy-work-as-a-fresh-context-prompt rule. Decide explicitly
>   whether to KEEP the `leave/delete/make-task/amend/fold-into-ADR` taxonomy as a
>   labelled human-workflow vocabulary or re-express it, and RECORD that decision
>   with the rationale.
> - `skills/orchestrate/SKILL.md` ("triage them (route/keep/delete) where the
>   disposition is obvious") and `skills/work/SKILL.md` ("recommend a disposition"):
>   reword so they do not imply the retired token vocabulary; keep them pointing at
>   the `triage-observations` skill.
> - TOKEN vs GENERIC ENGLISH: only the disposition TOKEN VOCABULARY is retired. The
>   plain-English word "disposition" elsewhere (e.g. TASKING-PROTOCOL.md / REVIEW-
>   PROTOCOL.md "the decomposition/assessment, not the disposition") is fine — do NOT
>   touch it. Stay within the named files.
>
> `triage-observations` is a plain skill (single copy under `skills/`, no
> `work/protocol/` mirror) — no byte-identical-pair concern.
>
> "Done": the `triage-observations` skill (and the orchestrate/work mentions) no
> longer imply the retired engine token vocabulary is live; the skill's workflow is
> preserved; the kept-vs-reframed taxonomy decision is recorded. Acceptance:
> `pnpm -r build && pnpm -r test && pnpm format:check` is green (run `pnpm format`
> first if needed).
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): confirm the keystone landed (engine is binary-entry, apply is
> agent-driven), that the sibling `surface-skill-prose-drop-disposition-vocabulary`
> updated the protocol docs (so this builds on settled prose), and that the
> direct-delete verb exists to point at. If a dependency landed differently, do NOT
> write prose that contradicts the shipped code — route the task to needs-attention
> with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention
> signal").
>
> RECORD non-obvious in-scope decisions (the kept-vs-reframed taxonomy call above is
> the main one). If a choice meets the ADR gate, write the WHY as an ADR in
> `docs/adr/`; otherwise note it briefly in the done record / PR description.

---

### Claiming this task

```sh
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/<slug>.md work/tasks/done/<slug>.md
```
