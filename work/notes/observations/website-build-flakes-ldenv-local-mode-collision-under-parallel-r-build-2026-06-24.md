---
title: website build intermittently fails with ldenv "local cannot be used as a mode name" under `pnpm -r build`
date: 2026-06-24
---

While running the acceptance gate (`pnpm -r build`) the `website` package
intermittently failed with `Loading Svelte config from Vite config failed:
Error: "local" cannot be used as a mode name because it conflicts with the
.local postfix for .env files.` A clean re-run (and an isolated
`pnpm --filter '@dorfl/website' build`) succeeded every time, so it looks like a
transient `ldenv`/Vite mode-name collision that only surfaces under the
concurrent recursive `-r` build, not a real website breakage. Noting it so the
flake is captured; out of scope for the delete-on-discharge task.
