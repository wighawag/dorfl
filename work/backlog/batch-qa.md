---
title: batch-qa — author skills/batch-qa/ (the one-file, one-step human-batching review loop)
slug: batch-qa
prd: batch-qa
blockedBy: [review-skill]
covers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
---

## What to build

The **`batch-qa` skill** (`skills/batch-qa/SKILL.md`) — a methodology skill (prose
an agent follows, like `review`/`to-slices`/`to-prd`; NOT code, NO runner command,
NO test harness) that gathers every open question across `work/` into ONE file the
human answers in a single sitting, applies the answers back, and iterates. Its
acceptance is DOC-SHAPED: the discipline is stated completely enough that an agent
follows it to the correct behaviour.

End-to-end, the skill states this loop:

- **BOUND (step 0):** the human describes the scope at invocation in natural
  language ("just the observations", "the autoslice PRDs", "everything"); select
  from items that are STILL unresolved (state lives in the items — stateless,
  item-derived selection; the work items ARE the ledger), narrow to the
  description, self-limit to a context-sized chunk; record the studied set in the
  batch-file header. Scaling = run again on the next subset (no fan-out/orchestration).
- **GATHER (B→A):** for slices/PRDs/code → run the **`review` skill**
  (`skills/review/`; compose, don't reimplement) and map its emitted `findings` →
  questions, PLUS collect pre-existing `needsAnswers`/`## Open questions`. For
  observations → the triage question ("promote-to-slice / promote-to-ADR / keep /
  delete") is **batch-qa-NATIVE** (NOT a `review` verdict). Write all into ONE
  human-fillable file `work/questions/<date>-batch.md` with inline context +
  suggested defaults; `ideas/` are EXCLUDED.
- **(human answers the one file.)**
- **APPLY (one step per item):** slice/PRD → merge answers + clear `needsAnswers`
  only where fully resolved; observation (promoted) → draft a NEW `backlog/` stub
  slice (or `docs/adr/` stub) with `needsAnswers` set HONESTLY (true unless the
  answer fully specified it); a PRD ALREADY `needsAnswers: false` at run start →
  slice it by composing `to-slices` → `review` (on the no-lock human path). The
  ONE-STEP invariant: advance each item exactly one lifecycle rung, then STOP (the
  loop eats its own output on later runs).
- **ITERATE + READINESS:** re-run GATHER over the bounded set; SOFT-FLOOR stop when
  only non-blocking issues remain (still written; human may continue); never re-ask
  a resolved question; emit a READINESS footer (READY / OPEN / NON-BLOCKING-ONLY).
  The batch file is EPHEMERAL (deletable after APPLY).
- **Boundaries the skill must state:** it FEEDS the per-item gates (it is NOT a
  gate); it NEVER commits / deletes / moves / pushes (leaves drafts/edits in the
  tree, reports paths); review composes ON TOP of `to-slices` (the caller mixes it
  in), `to-slices` is not modified.

Mirror the structure/voice + frontmatter of `skills/review/`, `skills/to-slices/`,
`skills/to-prd/`. Use the source PRD (`work/prd/batch-qa.md`) as the spec — the
batch-file shape, the one-step table, the per-scope question kinds, and the
gate-model-mismatch note all live there.

## Acceptance criteria

- [ ] `skills/batch-qa/SKILL.md` exists with valid `name` + `description`
      frontmatter, in the same shape as the other skills in `skills/`.
- [ ] It states the full loop: BOUND (human-described scope, self-limiting,
      stateless item-derived selection, header records the studied set) → GATHER
      (B→A) → APPLY → ITERATE with the soft-floor stop + READINESS footer.
- [ ] GATHER is correct per scope: `review` skill for slices/PRDs/code;
      observation-triage is batch-qa-NATIVE (NOT a `review` verdict); `ideas/`
      excluded; pre-existing `needsAnswers`/`## Open questions` also collected.
- [ ] It states the ONE-STEP invariant and the per-scope APPLY (slice/PRD merge +
      clear `needsAnswers`; observation → honest `needsAnswers` stub; ready-PRD →
      compose `to-slices` → `review` on the no-lock human path), each advancing
      exactly one rung then stopping.
- [ ] It states the no-write boundary (never commit/delete/move/push; leave in tree,
      report paths) and that batch-qa FEEDS the gates / is NOT itself a gate.
- [ ] It documents the batch-file shape (header + per-scope sections + READINESS
      footer) and that the file is ephemeral.
- [ ] It reads as a pure-prose, tool-agnostic methodology skill consistent with
      `review`/`to-slices`/`to-prd` — NO code, NO test harness introduced.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `review-skill` — `batch-qa` COMPOSES the `review` skill (`skills/review/`) for
  the GATHER (B) pass. It must exist first. (In `done/`.)

## Prompt

> Author the `batch-qa` SKILL at `skills/batch-qa/SKILL.md` — a pure-prose
> methodology skill (like `skills/review/`, `skills/to-slices/`, `skills/to-prd/`;
> NOT code, NO runner command, NO test harness) that gathers every open question
> across `work/` into ONE file the human answers in a single sitting, applies the
> answers, and iterates one lifecycle rung per item.
>
> READ FIRST: `work/prd/batch-qa.md` (the full spec — the loop, the ONE-STEP
> invariant table, per-scope question kinds, the batch-file shape, the
> gate-model-mismatch note, the rejected alternatives), `skills/review/SKILL.md`
> (you COMPOSE it for the B pass on slices/PRDs/code — it emits verdicts, you route
> blocks into the batch file; observation-triage is batch-qa-NATIVE, not review),
> `skills/to-slices/SKILL.md` (you COMPOSE it for the ready-PRD→slices rung, on the
> no-lock human path) + its `WORK-CONTRACT.md` (the `needsAnswers`/`## Open
> questions` convention, bucket polarity, status=folder), and mirror those skills'
> voice + frontmatter.
>
> Write the skill stating: BOUND (human-described scope, self-limiting, stateless
> item-derived selection, header records the studied set, run-again-for-next-subset
> not fan-out); GATHER B→A per scope (review skill for slices/PRDs/code; native
> triage for observations; ideas excluded); the one human-fillable batch file with
> inline context + suggested defaults; APPLY one-step-per-item (merge + clear
> needsAnswers; honest-needsAnswers observation stub; ready-PRD slices via
> to-slices→review); ITERATE with soft-floor stop + READINESS footer; the EPHEMERAL
> batch file; and the boundaries (FEEDS the gates / not a gate; NEVER
> commit/delete/move/push — leave in tree, report paths; review composes ON TOP of
> to-slices). "Done" = acceptance criteria met and the gate green. Per repo
> etiquette: do NOT stage/commit — leave the file for review and report the path.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim batch-qa --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/batch-qa <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/batch-qa.md work/done/batch-qa.md
```
