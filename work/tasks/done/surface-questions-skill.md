---
title: advance — author the NEW `surface-questions` skill (GATHER-only, PERSIST-NEVER — mirrors `review`)
slug: surface-questions-skill
spec: advance-loop
blockedBy: []
covers: [32, 33, 34, 35]
---

## What to build

A NEW skill, **`surface-questions`** (a doc-shaped skill like `review`), that GATHERS the open-judgement residue for a `work/` item and EMITS questions — writing NOTHING. This is the question-formulation JUDGEMENT half of the retired `batch-qa`, extracted into a fresh skill so an engine-loaded agent and a human-invoked agent behave IDENTICALLY (one question/answer contract).

This is a NEW skill, NOT an in-place rename (MAINTAINER-RESOLVED §2). The OLD `batch-qa` skill is retired in a SEPARATE slice (`retire-batch-qa-skill`); this slice only authors the new one. It is file-orthogonal (a skill markdown file) and can be built in parallel with the code slices.

### What the skill must specify

- **GATHER-only:** formulate questions by composing `review` (for a slice / PRD / code) + the native triage question (for an observation: promote / keep / delete)
  - collecting pre-existing `needsAnswers` / `## Open questions` already on the item. Each emitted question carries inline CONTEXT (so the human need not open the item) and an optional suggested DEFAULT (the humility aid).
- **PERSIST-NEVER:** the skill EMITS questions and writes nothing — exactly as `review` emits a verdict and the caller routes it. The advance engine spawns a fresh-context agent with this skill loaded, gets the questions, and ITSELF writes the sidecar (CAS-atomic) — the skill judges, the engine persists.
- **The humility rule:** surface the residue, NEVER invent an answer. (No answer-creation — that is REJECTED by design in the PRD.)
- **Human-invokable for the no-runner path (US #34):** a human may invoke it by hand and persist via the `advance` verb (the apply rung — a later slice; NOT `do advance`, since `advance` is a SIBLING top-level verb and `do` subcommands are REJECTED in the PRD) or by hand-writing the documented sidecar format from `advance-sidecar-contract` — with NO separate write-skill added unless hand-writing proves annoying.
- **`to-slices`/`review` stay COMPOSED by the rungs, UNCHANGED** (US #35) — only `batch-qa`'s orchestration is absorbed (by the engine); the producer/reviewer skills stay the single sources. This skill must reference/compose them, not duplicate them.

The emitted question shape must MATCH the sidecar entry fields from `advance-sidecar-contract` (question / context / default / optional disposition) so the engine can persist them with zero translation.

## Acceptance criteria

- [ ] A new skill `surface-questions` exists (in the repo's `skills/` area, following the house skill format), GATHER-only + PERSIST-NEVER, mirroring `review`'s "emit, don't persist" stance.
- [ ] It composes `review` (slice/PRD/code) + the native observation-triage question + pre-existing `needsAnswers`/`## Open questions`; it does NOT duplicate `to-slices`/`review` (they stay the single sources, unchanged).
- [ ] Emitted questions carry inline context + an optional suggested default and MATCH the sidecar entry field shape from `advance-sidecar-contract`.
- [ ] The skill explicitly states the humility rule (surface residue, NEVER invent an answer) and that it WRITES NOTHING.
- [ ] It documents the human-invokable no-runner path (persist via the `advance` verb — NOT `do advance` — or hand-write the documented sidecar format); no separate write-skill is added.
- [ ] Its acceptance, like `review`'s, is doc-shaped: it emits questions and writes nothing (persistence + its tests live with the engine, in the rung slices).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green (a doc-only change keeps the gate green).

## Blocked by

- None — a skill markdown file, file-orthogonal; build in parallel with the code slices. (The retirement of `batch-qa` is a SEPARATE later slice.)

## Prompt

> Author a NEW skill `surface-questions` (doc-shaped, like `review`): GATHER-only + PERSIST-NEVER. Read the PRD `advance-loop` (it now resides in `work/spec-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/prd/`) ("batch-qa → surface-questions", US #32–35, and MAINTAINER-RESOLVED §2 — it is a NEW skill, NOT an in-place rename; the OLD `batch-qa` is retired in a SEPARATE slice). It EMITS questions and writes NOTHING — exactly as `review` emits a verdict and the caller routes it; the advance engine spawns it fresh-context and ITSELF writes the sidecar (CAS-atomic).
>
> GATHER by composing `review` (slice/PRD/code) + the native observation-triage question (promote/keep/delete) + pre-existing `needsAnswers`/`## Open questions`; inline context + an optional suggested default per question; the humility rule (surface residue, NEVER invent an answer). Keep `to-slices`/`review` COMPOSED and UNCHANGED (single sources). Stay human-invokable for the no-runner path (persist via the `advance` verb — NOT `do advance`; `advance` is a sibling top-level verb — or hand-write the documented sidecar format) — no separate write-skill.
>
> The emitted question shape MUST match the sidecar entry fields from `advance-sidecar-contract` (question / context / default / optional disposition) so the engine persists with zero translation.
>
> READ FIRST: the existing `review` skill (the emit-don't-persist stance + the doc-shaped acceptance to mirror), the existing `batch-qa` skill (the question-formulation judgement to carry over), and the sidecar entry shape from the `advance-sidecar-contract` slice. Look at the repo's `skills/` directory for the house skill format.
>
> FIRST, check this slice against current reality (drift). "Done" = the skill exists per the acceptance criteria and the gate is green.

---

### Claiming this slice

```sh
dorfl claim surface-questions-skill --arbiter origin
git fetch origin && git switch -c work/surface-questions-skill origin/main
git mv work/in-progress/surface-questions-skill.md work/done/surface-questions-skill.md
```
