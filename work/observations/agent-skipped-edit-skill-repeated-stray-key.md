---
title: Agent repeatedly hit a documented edit-tool pitfall without loading the skill that names it
type: observation
status: spotted
spotted: 2026-06-05
---

# An agent hit the same documented edit-tool error 4x without loading the skill

> **NOTE ON SCOPE:** this is an **agent/harness CONDUCT** signal, NOT an
> agent-runner domain signal (unlike the other notes in this folder, which are
> about mirrors/ledger/gc). It is captured here because this is the repo where it
> happened and there is no better place to keep it from evaporating (maintainer's
> call: capture > lose). A future reader should NOT mistake it for a code issue in
> `agent-runner`.

## What was spotted

While doing four review passes over the phase-2 command-surface slices
(2026-06-05), the agent (me) **repeatedly emitted `edit` tool calls with a stray
extra key inside an `edits[]` object** (e.g. `newText_unused`, `id_unused`,
`id_x`, `newText_x`, `newText_z`, `id_skip`, `id_strip`). The `edit` tool rejects
this every time with:

```
Validation failed for tool "edit":
  - edits.0: must not have additional properties
```

It happened on AT LEAST these calls (all caught by the tool's validation, so
nothing landed wrong \u2014 but each cost a wasted round-trip + a retry):

- pass 2: `registry-remote` edit (`newText_unused`) \u2014 and the botched retry of
  THAT call is what caused a separate **lost-edit** (two intended edits never
  applied; only found in pass 3 by re-reading the committed file). So the stray-key
  habit had a real downstream cost beyond the wasted turn.
- pass 2: `human-face-verbs` edit (`id_unused`).
- pass 3: `flag-cleanup-renames` edit (`newText_z`), `scan-status-fetch-first`
  edit (`newText_x`).
- pass 4: `do-in-place` edit (`id_skip`).

## The kicker: a skill documents this EXACT error, and it was never loaded

`edit-best-practices`
(`/home/wighawag/.pi/agent/skills/edit-best-practices/SKILL.md`, listed in the
agent's available skills) names this precisely:

> **"Check for Extra Properties \u2014 `edits[]` objects only allow `oldText` and
> `newText`."**
> Error: `Validation failed: edits.0: must not have additional properties` \u2014
> "Remove any properties besides `oldText` and `newText` from inside `edits[]`."

It even has a **red-flag rule**: *"Stop and reassess if you see the same
validation error twice in a row."* The agent hit it FOUR times across multiple
turns and never loaded the skill (whose description is literally "best practices
for using the edit tool... to avoid common pitfalls") until the maintainer asked
about it.

## The real failure (and the lesson)

The bug itself is trivial (a typo'd extra key, harmlessly rejected). The
SIGNAL is the meta-behaviour:

1. **A documented, named pitfall recurred without the relevant skill being
   loaded** \u2014 i.e. "same validation error twice" did not trigger "load the skill
   about this tool." Skill discovery is happening too late / not on repeated-error.
2. **A recurring tool-misuse pattern that the harness silently catches is easy to
   normalise** ("the retry works, move on") instead of treating it as a red flag.
   That normalisation is what let it recur four times AND caused the pass-3
   lost-edit (a failed batch's partial retry dropped two edits).

Corrective taken: load + follow `edit-best-practices`; treat a SECOND identical
tool-validation error as a stop-and-load-the-skill trigger; after any failed edit
batch, re-read the file to confirm what actually landed (not what was intended).

## Why an observation, not a work item

It is not actionable as agent-runner code. It is a conduct/harness signal worth
remembering (it cost real turns + caused a lost edit). If a pattern of
"documented-skill-not-loaded-on-repeated-error" shows up elsewhere, this is prior
art. Delete once it stops being a useful reminder.
