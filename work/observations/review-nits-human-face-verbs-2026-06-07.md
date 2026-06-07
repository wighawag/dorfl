---
title: review-gate non-blocking nits for 'human-face-verbs' (Gate 2 approve)
date: 2026-06-07
status: open
slug: human-face-verbs
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'human-face-verbs' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- The `isCliEntryPoint()`/`runCli()` refactor (making cli.ts import-safe) is a real change not named in the slice's bullet list — is it worth a one-line mention in the slice/commit so future readers know it landed alongside the verbs?
  (cli.ts replaced the unconditional module-level `program.parseAsync(process.argv)` with an entry-point guard. It is a necessary enabler for the surface tests (which import buildProgram) and preserves the installed-bin behaviour via realpathSync symlink handling, so it is correct — just slightly out of the slice's stated bullet scope.)
- The committed observation `work/observations/test-suite-intermittent-exit1.md` reports an intermittent `pnpm -r test` exit-1 with all 832 tests passing — out of this slice's scope but worth a triage pass so the green gate stays trustworthy.
  (Captured correctly as an append-only observation (right bucket: spotted/unverified, not investigated). Not a blocker for this slice since it is unrelated to the verb changes, but flagged so the signal is routed rather than lost.)
