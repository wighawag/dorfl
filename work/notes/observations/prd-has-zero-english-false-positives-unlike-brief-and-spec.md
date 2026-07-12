---
title: 'spec' has ZERO English false-positives (unlike brief/spec) — the forward spec→spec sweep is safe; only 'SPEC is a spec' adjacencies needed rewording
date: 2026-07-09
needsAnswers: true
---

## What was spotted

While doing `preisolate-spec-false-positive-words` (task 1 of the `spec → spec` cutover) I surveyed every word containing the string `spec` across `packages/dorfl/{src,test}`, `skills/`, `docs/`, `CONTEXT.md`, `AGENTS.md`. **Every single one is the artifact** (`spec`, `specs`, `seedPrd`, `prdsLandIn`, `renderPrdBody`, `taskablePrds`, `LedgerPrdItem`, …). There is NO genuine-English word containing `spec` — because `spec` is a coined acronym, it never hides inside real English.

This is UNLIKE the two prior cutovers' words: `brief` hides in `briefly`/`briefing`/`debrief`, and `spec` hides in `specific`/`especially`/`inspect`/`refspec`. Those needed sentinel/synonym protection; `spec` does not.

## Why it matters (for the remaining cutover batches)

1. **The forward `spec → spec` sweep is inherently safe** — a blind keep-case `spec → spec` substring replace cannot corrupt English (there is none to corrupt). The pre-isolation task's job #1 (synonym-rename false positives) was therefore a NO-OP; the real work was only job #2 below.
2. **The ONE real hazard is direction-specific and small:** phrases where `spec`/`SPEC` sits next to a pre-existing `spec`, which the sweep would turn into "spec is a spec". Found + reworded 7: `buildable-body.ts`, `triage-persist.ts` (×3), `skills/work/SKILL.md`, `docs/adr/work-tree-taxonomy…`, `skills/setup/protocol/REVIEW-PROTOCOL.md` (+ mirror + VERSION). Reworded the pre-existing "spec" (→ "north-star doc" / "document" / "target") so post-sweep prose reads clean.
3. **The REVERSE leak scan still matters** — after the sweep, `spec` DOES collide with English (`specific`, `refspec`, `BranchProtectionSpec`, `remote spec`, `git show ${spec}`), so the contract task's reverse scan must allow-list those legitimate `spec` terms. But that is the reverse scan's job, NOT a forward pre-isolation job. The domain terms (`refspec`, `BranchProtectionSpec`, `remote spec`) are CORRECT and must be LEFT ALONE — do not synonym-rename them.
4. **Tooling implication:** because the forward direction is safe, the `change-name`/keep-case sweep for `spec → spec` needs no sentinel gymnastics; the migration command's engine can do a plain keep-case `spec → spec` on data. The bi-word leak scan (`spec` AND `brief`) remains the acceptance proof.

## Provenance

Derived from a survey of the live tree @ commit 29b4745f (grep of `[a-z]*spec[a-z]*` word forms + `spec…spec` adjacency search). Weakest provenance (reading our own code), but the claim "no English word contains spec" is structural (coined acronym), not incidental.
