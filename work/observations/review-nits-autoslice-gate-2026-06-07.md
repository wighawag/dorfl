---
title: review-gate non-blocking nits for 'autoslice-gate' (Gate 2 approve)
date: 2026-06-07
status: open
slug: autoslice-gate
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'autoslice-gate' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- No `--auto-slice` CLI flag is registered in `cli.ts` (unlike `allowAgents`, which has `allowAgentsFromCli`). Acceptance criterion 1 says `autoSlice` resolves 'flag > env > ...' — the flag *layer* is supported and tested via `resolveRepoConfig`'s `flags` param, but no command currently surfaces an `--auto-slice` option. Confirm the consuming `autoslice-command` slice will register the CLI flag when it introduces the `do prd:<slug>` surface, so the flag tier isn't left perpetually unwired.
  (src/cli.ts registers `--allow-agents` (lines 47-80) but nothing for autoSlice; this slice is explicitly scoped to 'config plumbing... the substrate the command (a later slice) consumes', so omitting the flag registration is consistent with scope rather than a defect. The resolution chain itself accepts and prioritises `flags: {autoSlice: true}` correctly (verified in test/repo-config.test.ts:233-239).)
