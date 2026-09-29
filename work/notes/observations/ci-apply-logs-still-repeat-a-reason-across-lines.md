---
title: 'CI apply logs no longer print a line twice, but still repeat the same reason or note across two or three lines'
date: 2026-09-29
status: spotted
---

Found re-testing `ci-phase-logs-each-line-once` in the CI sandbox `wighawag/dorfl-ci-sandbox` (dorfl `main@071cb5a1`). No job log line is printed twice in a row any more, but the content still repeats:

- Build apply, protected-path rejection (run 36562499839, `task:mark-docs-as-documentation-for-linguist`): the rejection reason appears three times, as `>> handoff rejected (protected-path): ...`, inside `>> Surfaced '...' on origin/main (stuck): handoff rejected ...`, and in the result line `>> handoff rejected ...; surfaced it to needs-attention.`
- Tree-less apply of an answered sidecar (runs 36562251442 and 36564305246): the result line is the earlier notes joined, e.g. `>> merge-question ... answered MERGE: landed ... applied task:... → resolved (needsAnswers cleared, sidecar deleted).` right after the same two sentences were printed as their own notes.

Related: `laptop-verbs-print-their-result-line-twice.md` (the `applyRung` result built from its notes) and `tasking-rejected-handoff-notes-its-reason-twice.md` (the tasking path).
