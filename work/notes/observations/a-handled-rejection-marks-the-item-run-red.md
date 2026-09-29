---
title: 'An apply phase that handled a rejected handoff correctly still ends the item run red'
slug: a-handled-rejection-marks-the-item-run-red
date: 2026-09-29
status: spotted
---

Found in the CI sandbox `wighawag/dorfl-ci-sandbox`. The item run for `task:mark-docs-as-documentation-for-linguist` (a task that adds a root `.gitattributes`) behaved exactly as designed: the apply job rejected the handoff (`protected-path`), surfaced the task to needs-attention, and wrote nothing to `main`. But the apply job exits 1, so the run shows as a failure in the Actions list, next to runs that genuinely broke. Worth deciding whether a clean, handled surface (protected path, rejected handoff, agent STOP) should exit 0 like the other "clean surface is green" cases, keeping red for real failures.
