---
title: review-gate non-blocking nits for 'provider-arbiter-derived-and-nopr-intent' (Gate 2 approve)
date: 2026-06-14
status: open
slug: provider-arbiter-derived-and-nopr-intent
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'provider-arbiter-derived-and-nopr-intent' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The up-front PR-intent failure guard is wired ONLY into the in-place `performDo` path (do.ts step 3c). The autonomous build paths — `performDoRemote`/`runRemotePipeline` (`do --remote`/`--isolated`) and the `run` daemon — do NOT run the probe, so a propose build against a GitHub arbiter with `gh` genuinely unauthed will run the full build there and then silently degrade to manual-PR instructions at integration, which is the exact 'wanted a PR, silently didn't get one' failure the axis exists to prevent. Note `--isolated` is the primary autonomous path (drive-backlog mandates it). Should the guard be extended to the remote/isolated/run paths as a follow-up?
  (do.ts: `shouldFailProposePrIntent` is invoked only in `performDo` (~L643, step 3c). `runRemotePipeline` (~L1609) and run.ts have no such guard. This faithfully matches the slice, which scoped the guard to mirror 'the two IN-PLACE pre-flight GUARDS (dirty-tree + diverged-main, src/do.ts ~L64)' — and those siblings are themselves in-place-only by design (an isolated worktree is always clean off fresh main). So this is an inherited scope choice, not an implementation slip; flagging it as a ratification/follow-up candidate because the honest-failure value is arguably needed MOST on the autonomous path.)
- The slice's build steps 5 and 6 ask the agent to 'Decide + document in a `## Decisions` block' (the probe-at-pre-flight choice and the stale-key-warns-not-errors choice). Both decisions are implemented exactly as the slice itself pre-specified, and they are well-documented in code comments + ADR §6, but I could not find a `## Decisions` block (no PR-description artifact in the worktree). Confirm the PR description carries the Decisions block for the record.
  (Both 'decisions' were prescribed by the slice text (probe via GitHubProvider.available, not config inspection; stale `provider` warns + maps `none`→`noPR`), so they are pre-ratified by the slice rather than free agent choices — hence non-blocking. The implementation matches the slice verbatim (do-config.ts `shouldFailProposePrIntent`/`PROPOSE_PR_INTENT_GH_UNAVAILABLE_MESSAGE`; config.ts `warnDeprecatedConfigKeys`/`DEPRECATED_CONFIG_KEYS`).)
