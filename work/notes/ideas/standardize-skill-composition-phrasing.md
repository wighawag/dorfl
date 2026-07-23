---
title: 'Standardize the skill-composition phrasing (file-path-load), so composition reads as a deliberate, uniform pattern'
slug: standardize-skill-composition-phrasing
type: idea
status: incubating
---

# Standardize the skill-composition phrasing (file-path-load)

> Captured 2026-06-21 during the Matt Pocock skills v1.0.0 alignment work (`docs/adr/methodology-and-skills.md` §6). Polish, not a behaviour fix: composition already WORKS; this is about making it read uniformly.

## The signal

Our skills compose each other by **loading the sibling `SKILL.md` by path and following it inline** (NOT by slash / model-invocation). That divergence from Matt is now recorded in ADR §6 and is what lets a user-invoked skill compose another user-invoked one safely. But the PHRASING of that composition is inconsistent across skill bodies:

- `orchestrate`: "load and FOLLOW the `drive-backlog` skill", "loading and following the `drive-backlog` skill inline".
- `drive-backlog`: "**`review`** (`skills/review/`): the discipline for your own diff-vs-criteria pass".
- `to-task` / `triage-observations`: "Compose with the `to-task` discipline", "compose the `to-task` discipline if available".
- `surface-questions`: "Run the `review` skill", "composed and UNCHANGED".

A reader cannot tell at a glance that every one of these means the same mechanism (open the file at `skills/<name>/SKILL.md` and follow it), and crucially that NONE of them means a slash-invocation. This is a `writing-great-skills` concern: single-source-of-truth and predictability for the composition pattern itself.

## The idea

Pick ONE composition verb/phrasing and apply it everywhere a skill composes another, e.g. *"load `skills/<name>/SKILL.md` and follow it"*, so the reader always knows it is a file-path load and never a slash-invocation. Then state the rule ONCE, centrally (the `work` router is a natural home, and ADR §6 already records the why): *compose by loading the sibling SKILL.md by path; never rely on slash-invocation; a user-invoked skill can compose any other skill this way.*

## Why not done now

It touches the BODIES of ~5 skills (`orchestrate`, `drive-backlog`, `to-task`, `triage-observations`, `surface-questions`, and the `setup` Phase-B references). It is cosmetic relative to the substantive v1 changes (the flag, the taxonomy, the router, the descriptions), and doing it in the same change risked entangling a phrasing sweep with the load-bearing edits. Deferred deliberately.

## Open questions

- The exact canonical phrasing (verb + whether to always include the `skills/<name>/SKILL.md` path inline, vs just the backticked name plus a one-time "all composition is file-path load" rule stated in the router).
- Whether the relocation-awareness concern (a skill referencing `skills/review/` vs a future copied-in location) should be solved at the same time, or stays out of scope because the skills are NOT copied into target repos (ADR §6).
