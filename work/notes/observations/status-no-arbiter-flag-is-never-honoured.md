---
title: '`status --no-arbiter` is never honoured'
slug: status-no-arbiter-flag-is-never-honoured
date: 2026-09-28
status: resolved
resolvedBy: status-no-arbiter-is-honoured
resolvedDate: 2026-09-28
---

> RESOLVED 2026-09-28 by task `status-no-arbiter-is-honoured`: `status` now reads the commander negation (`arbiter: false`) to skip the arbiter section and never passes `false` on as a remote name; `scan --reconcile-locks` is arbiter-scoped by default with `--all-arbiters` for the global drain and the same refusal `status` has. No other command pairs a valued `--x <v>` with `--no-x` (pinned by a test).

# `status --no-arbiter` is never honoured

2026-09-28: In `packages/dorfl/src/cli.ts` the `status` command declares both `--arbiter <remote>` and `--no-arbiter`. Commander treats `--no-arbiter` as the negation of `--arbiter`, so it sets `flags.arbiter = false` and never sets `flags.noArbiter` (verified with a minimal commander repro). Result: the `flags.noArbiter === true` check never fires (the arbiter section is never skipped), and `lockArbiterRemote: flags.arbiter ?? 'origin'` passes `false` as the remote name to `resolveCwdSection`. Spotted while building `reconcile-locks-stays-within-the-current-arbiter` (which guards its own read with `typeof flags.arbiter === 'string'`). `scan --reconcile-locks` also still reconciles every registered mirror with no arbiter scope, which may deserve the same treatment.
