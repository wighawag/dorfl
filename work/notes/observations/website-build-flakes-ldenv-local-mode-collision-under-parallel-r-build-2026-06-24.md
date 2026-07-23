---
title: 'website build intermittently fails with ldenv "local cannot be used as a mode name" under `pnpm -r build`'
date: 2026-06-24
needsAnswers: false
triaged: keep
---

While running the acceptance gate (`pnpm -r build`) the `website` package
intermittently failed with `Loading Svelte config from Vite config failed:
Error: "local" cannot be used as a mode name because it conflicts with the
.local postfix for .env files.` A clean re-run (and an isolated
`pnpm --filter '@dorfl/website' build`) succeeded every time, so it looks like a
transient `ldenv`/Vite mode-name collision that only surfaces under the
concurrent recursive `-r` build, not a real website breakage. Noting it so the
flake is captured; out of scope for the delete-on-discharge task.

## Applied answers 2026-06-24

### q1: Triage: what becomes of this signal — keep as a noted flake, promote to a task to investigate/fix the ldenv mode-name collision under `pnpm -r build`, or drop it?

keep — record the flake as a watch-item. It is rare, self-clearing on rerun, and the suspected root cause (ldenv mode-name handling under concurrent invocation) is UPSTREAM of this repo, so a task now would chase an upstream cause on thin evidence. Promote to a task only once it recurs frequently enough to actually red the gate.

disposition: keep
