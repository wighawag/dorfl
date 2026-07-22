---
title: review-gate non-blocking nits for 'config-untrusted-landin-keys' (Gate 2 approve)
date: 2026-07-22
status: open
reviewOf: config-untrusted-landin-keys
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'config-untrusted-landin-keys' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The new doc comments in config.ts / env-config.ts / repo-config.ts cite CLI flags --untrusted-tasks-land-in / --untrusted-specs-land-in as the top of the resolution chain, but this task deliberately adds NO CLI flag (deferred to a later task), so those flags do not yet exist. Confirm this forward-reference is intended (it mirrors how tasksLandIn documents --tasks-land-in, which DOES exist) and that the later flag task keeps the exact spelling.
  (grep for the flag names in cli.ts returns no matches; comments describe the eventual chain, not current wiring.)
- Ratify the naming/vocabulary choice: spec US #7 loosely writes untrustedSpecsLandIn: proposed | ready, but the code defaults to pre-proposed to match the existing SpecsLandIn value vocabulary. This is correct and coherent (reuses the established key spelling), just flagging the spec-vs-code wording difference for the record.
  (config.ts SpecsLandIn = 'pre-proposed' | 'ready'; default untrustedSpecsLandIn: 'pre-proposed'.)
