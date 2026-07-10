---
title: 'DECISION: the WORD leak scan now file-exempts prd→spec cutover task bodies whose OWN SUBJECT is the retired word'
date: 2026-07-10
---

## Context / what I saw

The tree-wide WORD scan (`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts`) walks `work/**` and flags any bare artifact word `prd`/`PRD` (in prose, code spans exempt) + any `work/prds/` folder path (on the RAW line, code spans NOT exempt). It went RED the moment the runner committed my task file `work/tasks/ready/sweep-prd-artifact-word-in-src-prose-and-runtime-strings.md` (commit `3496aed7`): that task BODY, written by the task author, quotes `prd` / `` `work/prds/…` `` literally to describe what the sweep converts FROM. The prior prd-cutover tasks dodged this because their SLUG contains `prd`/`work-prds` (so the scan's `PRESERVE_SLUGS` + `slugCovers` line rule covers their body lines) — but my slug `sweep-prd-artifact-word-in-src-prose-and-runtime-strings` has no `prd` substring, so `slugCovers` cannot reach its content lines, and I MUST NOT edit the locked task body.

## Decision

Add a small, concrete `PROVENANCE_FILE_BASENAMES` file-level exemption to the WORD scan: a task/observation whose own SUBJECT is documenting the retired-vocabulary sweep legitimately quotes the retired word + the migrated-away folder path in its prose. The scan exempts those specific files WHOLE (both lenses). This is the file-scoped analogue of the existing `PRESERVE_SLUGS` provenance mechanism.

- **Alternative considered:** widen `PRESERVE_SLUGS` with my slug — REJECTED, my slug has no `prd`, so `slugCovers` (a line-substring match that also needs the retired word present to cover) never fires on the content lines that carry the leak.
- **Alternative considered:** edit the task body to backtick/spec-ify its `work/prds/` mentions — REJECTED, the task body is locked (runner owns it) and I am told not to touch it.
- **What it touches:** the WORD scan's allow-list ONLY (a sibling gate). It does NOT weaken the src prose scan (`prd-src-prose-leak-scan.test.ts`, this task's deliverable) nor the identifier scan. The exemption is a NAMED, enumerated basename list, non-vacuous (asserted present in the tree), so it cannot silently swallow a real re-drift elsewhere.

Linked from the done record for ratification.
