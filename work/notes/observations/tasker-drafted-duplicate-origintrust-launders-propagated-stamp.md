---
title: 'A tasker-drafted task that repeats originTrust: can override the propagated untrusted stamp'
slug: tasker-drafted-duplicate-origintrust-launders-propagated-stamp
date: 2026-09-27
---

Spotted while building `intake-frontmatter-title-injection-strips-origin-stamp` (not verified end to end). `stageTaskingLifecycle` in `packages/dorfl/src/tasking.ts` stamps an untrusted spec's `origin`/`originTrust` onto each agent-drafted task via `propagateOrigin` → `setFrontmatterMarker` (`frontmatter.ts`), which replaces only the FIRST `originTrust:` line, while `parseFrontmatter` keeps the LAST. A tasker agent (prompt-injectable through the untrusted spec's text) that writes two `originTrust: trusted` lines would therefore keep one after the stamp, and the task would read as trusted at build time. Relatedly, a drafted task with an opening `---` but no closing fence makes `setFrontmatterMarker` return it unchanged, so the stamp is silently dropped. The promote path now refuses the analogous duplicate `slug:`/`promotedFrom:` case via `assertFrontmatterFields`; the tasking stamp could get the same re-parse check (or strip duplicates before stamping), but that path's failure mode (it runs mid-transition inside the lifecycle `stage`) is a design choice left open.
