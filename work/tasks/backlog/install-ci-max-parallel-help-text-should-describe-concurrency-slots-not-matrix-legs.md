---
title: 'install-ci --max-parallel help text should describe concurrency slots, not matrix legs'
slug: install-ci-max-parallel-help-text-should-describe-concurrency-slots-not-matrix-legs
issue: 426
origin: issue
originTrust: trusted
covers: []
blockedBy: []
---

## What to build

The help text for the `dorfl install-ci --max-parallel <n>` option (in `packages/dorfl/src/cli.ts`, around line 5189) still describes the value as 'cap on CONCURRENT advance-lifecycle matrix legs (the propose/merge `max-parallel`)'. That framing is now stale: the CI split there has no matrix leg — the value is the number of `dorfl-slot-<n>` concurrency slots that the per-item `dorfl-item-dispatch.yml` runs queue into (each item run joins `dorfl-slot-<index mod maxParallel>` with `queue: max`, per `advance-lifecycle-template.ts`).

Update the option's help string so it describes the `dorfl-slot-<n>` concurrency slots rather than matrix legs. The SAME stale 'matrix leg(s)' framing also appears in the JSDoc for the `maxParallel` field in `packages/dorfl/src/install-ci-core.ts` (around lines 108-114) and `packages/dorfl/src/install-ci.ts` (around lines 83-86); update those to match so all three describe the value consistently. This is a documentation/help-text change only — NO behaviour change (the flag still parses the same positive integer, default 2).

## Acceptance criteria

- The `--max-parallel` help text in `packages/dorfl/src/cli.ts` no longer mentions 'matrix legs' and instead describes the value as the number of `dorfl-slot-<n>` concurrency slots the per-item `dorfl-item-dispatch.yml` runs queue into.
- The `maxParallel` JSDoc in `packages/dorfl/src/install-ci-core.ts` and in `packages/dorfl/src/install-ci.ts` no longer uses the 'matrix leg(s)' / 'propose/merge matrices' framing; they describe the same slot-based concurrency cap.
- The default (2) is still documented in the help text.
- No behaviour change: flag parsing/validation and the value passed downstream are unchanged.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Prompt

In `packages/dorfl/src/cli.ts`, find the `.option('--max-parallel <n>', ...)` for the `install-ci` command (near line 5189). Rewrite its description so it no longer says 'cap on CONCURRENT advance-lifecycle matrix legs' — instead describe it as the cap on the number of `dorfl-slot-<n>` concurrency slots that the per-item `dorfl-item-dispatch.yml` runs queue into (each slot runs a full agent session, so a large fan-out can exhaust the model provider rate limit + thrash the CAS; default 2). Then fix the SAME stale 'matrix' framing in the `maxParallel` JSDoc in `packages/dorfl/src/install-ci-core.ts` (around lines 108-114) and `packages/dorfl/src/install-ci.ts` (around lines 83-86) so all three describe the slot-based cap consistently. Do not change any parsing, validation, or downstream behaviour. Then run `pnpm format`, and confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.
