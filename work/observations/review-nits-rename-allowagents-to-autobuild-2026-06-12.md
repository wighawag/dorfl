---
title: review-gate non-blocking nits for 'rename-allowagents-to-autobuild' (Gate 2 approve)
date: 2026-06-12
status: open
slug: rename-allowagents-to-autobuild
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'rename-allowagents-to-autobuild' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the slice said to 'mirror the precedent migration rename-reviewpr-to-review for the alias/warning shape', but that precedent shipped with NO back-compat alias (it was an unreleased clean rename). The slice's own acceptance criteria mandate an alias/deprecation window, and that is what was built (correctly). Just confirming the alias-bearing migration is the intended outcome despite the precedent it cites having had none.
  (work/done/rename-reviewpr-to-review.md: 'No back-compat alias (the flag/key is days old, unreleased — a clean rename, not a deprecation).' vs this slice's criterion: 'The OLD allowAgents key/flag/env still works for a deprecation window (aliased to autoBuild with a deprecation warning).' The implementation followed the slice's criteria, not the cited precedent's actual shape.)
- The CLI deprecated-flag path (autoBuildFromCli honouring --allow-agents/--no-allow-agents and emitting the deprecation warning) has no dedicated unit test, unlike the file/env/per-repo alias paths which each have full map+warn+new-key-wins coverage. Not a regression (the resolver was equally untested as allowAgentsFromCli before this slice, and it reuses the centrally-tested aliasDeprecationMessage), but a small targeted test on the flag alias would close the last gap. Optional.
  (packages/agent-runner/src/cli.ts:113-131 (autoBuildFromCli, with the getOptionValueSource('allowAgents')==='cli' deprecated branch). No test references getOptionValueSource or the --allow-agents flag's deprecation; format.test.ts only asserts --auto-build appears in help.)
