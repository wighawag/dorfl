---
title: 'requeue-continue-and-reset "a CONFLICTING continue rebase routes to needs-attention" timed out (5000ms) in a full-suite run'
date: 2026-09-28
status: spotted
---

2026-09-28, noticed while building `install-ci-auth-json-mode-wires-its-secret`: in one full `pnpm -r test` run, `test/requeue-continue-and-reset.test.ts > requeue default — REBASE onto fresh main at onboard-time > a CONFLICTING continue rebase routes to needs-attention (never auto-resolves)` failed with "Test timed out in 5000ms"; it passed in isolation (~3s for the file) and on an immediate full re-run. Looks like a real-git test near the default timeout under parallel load; unrelated to the change being built.
