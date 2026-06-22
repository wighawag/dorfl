---
title: Gate-2 review verdict crashes with "review verdict was not valid JSON" on large-diff builds
date: 2026-06-22
status: open
---

## Signal (recurring failure, observed twice in one drive)

During the `drive-tasks` backlog drive of the rename tasks, the PR/code-review gate (Gate 2)
crashed the `do` run TWICE with:

> error: review verdict was not valid JSON: Expected ',' or '}' after property value in JSON at position 8101 (line 7 column 4811)

and (a second task)

> error: review verdict was not valid JSON: Expected ',' or '}' after property value in JSON at position 7593 (line 8 column 2)

Both crashes happened:
- AFTER a fully GREEN Gate-1 acceptance build (2585 tests passed in the fresh rebased-tip worktree), and
- on the TWO LARGEST diffs of the drive (`rename-config-keys-slicing-to-tasking`: ~24 src + ~40 test files; `rename-cli-verb-and-flags-do-prd-to-do-brief`: cli.ts + do-config.ts + tests).

The two SMALL-diff tasks of the same drive (`rename-slice-stop-sentinel-to-task-stop`, `rename-docs-prose-slicing-to-tasking`) did NOT hit it — their Gate-2 verdict parsed fine and approved.

## Impact

The crash is an UNHANDLED exception, not a routed failure: it leaves an orphaned `active` lock
(on origin + mirror), does NOT push the work branch to origin (the green build survives only on the
hub mirror branch), and opens NO PR. Recovery cost per occurrence: push the kept mirror branch to
origin, `requeue` (keep+continue), clear the mirror lock by hand, then re-`do` — which takes the
"recovered stranded already-complete branch" path and opens the PR WITHOUT re-running Gate-1/Gate-2.
That means the conductor must do a FULL manual Gate-3 + gate re-verify (Gate-2 never actually ran on
the merged PR).

## Likely mechanism (hypothesis)

The review agent's JSON verdict for a large diff likely contains an unescaped control character, a
raw newline inside a string, or a truncated/over-long field (both failures are deep into the payload:
position ~7.5k-8.1k). The verdict parser appears to do a strict `JSON.parse` with no salvage/repair,
no length cap on quoted findings, and no retry — so one malformed verdict is terminal AND crashes
the whole run instead of routing to `review-blocked`/`config-error`.

## Suggested fix directions (not done here)

1. Make the verdict parse FAULT-TOLERANT: on parse failure, route to needs-attention with a
   `transient-infra`/`config-error` cause (the work is fine; the gate misbehaved) instead of throwing
   an unhandled error that strands the lock + branch.
2. Harden the review agent's output contract: instruct it to emit STRICT minified JSON, escape control
   chars, and cap per-finding length; consider a fenced-block extraction + a lenient JSON repair pass
   before the strict parse.
3. On a parse crash, still PUSH the kept work branch to origin and mark the lock stuck (so recovery
   does not require a manual mirror→origin push).

Captured during the rename drive (conductor recovered both occurrences by hand and merged the green
work after manual re-verify). Filed so this is treated as a real gate-robustness bug, not noise.
