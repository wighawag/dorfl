---
title: 'promptGuidance.testFirst: a per-repo, per-item NUDGE (not a gate) that strengthens the test-first line in the AFK worker''s in-band prompt'
slug: prompt-guidance-test-first
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) plus the code; remaining work: `work/tasks/todo/` tasks. Governing context: `docs/adr/methodology-and-skills.md` §6 (the v1.0.0 alignment plus the TDD-invisibility gap this brief closes) and the in-band-for-portability doctrine in `work/protocol/CLAIM-PROTOCOL.md` ("the boundary travels with the prompt").

## Problem Statement

The autonomous worker that `dorfl do` spawns cannot see any `SKILL.md` (the skills are human-facing tools, deliberately NOT part of the self-contained protocol; see `methodology-and-skills.md` §6). So Matt's `tdd` discipline never reaches the AFK worker. Today the only test-first signal it gets is the soft per-task line in the CLAIM-PROTOCOL wrapper: *"TDD where the task asks for it."* Tests therefore pass mostly because the `verify` gate forces them green. That is test-PASSING, not test-FIRST.

A maintainer who wants AFK builds in their repo to default to test-first has no per-repo lever for it. They can write it per-task (the existing escape hatch), but there is no repo-wide policy, and there is no honest place to record one. `verify` is an enforced outcome (wrong category, because you cannot verify red→green from a final diff), and AGENTS.md is host-owned (setup must not write it; the portable runner cannot assume a target host even loads it).

## Solution

Add a **NUDGE category** to the config and frontmatter, `promptGuidance`, whose first member is `testFirst`. A nudge modifies the *prompt text* handed to the worker; it changes the agent's disposition, NOT the acceptance criteria. The name `promptGuidance` exists precisely to signal "guidance, not guarantee" and to keep it CATEGORICALLY SEPARATE from the enforced gate family (`verify`, `autoBuild`, `humanOnly`), so no one ever mistakes a nudge for an acceptance bar.

From the maintainer's perspective:

- During `setup`'s adoption chat, they are asked once (phrased AS a nudge) whether AFK builds here should default to test-first.
- If yes, it is recorded as `promptGuidance.testFirst: true` in `dorfl.json`.
- When the runner assembles the worker's prompt, the existing soft "TDD where the task asks for it" line is STRENGTHENED in-band to a test-first nudge ("at the agreed seam, write the failing test before the code; this is guidance, acceptance is still the verify gate"), reaching the worker reliably and portably.
- The `verify` gate still decides pass/fail. Nothing about enforcement changes.
- A single task or brief can override the repo default in its frontmatter (this task is exploratory, so skip; or this task, so force on), exactly like `humanOnly` / `autoBuild`.

This sits entirely inside doctrines the codebase already states: **in-band-for-portability** (the load-bearing channel is the prompt, never AGENTS.md), **repo-policy-plus-item-override** (the shape of `humanOnly`/`autoBuild`), and **enforced-outcome-vs-advisory-instruction** (the gate enforces results; the prompt advises process). It is the same patterns applied to a new "nudge" axis, not a bolt-on.

## User Stories

1. As a maintainer, I want to declare `promptGuidance.testFirst: true` once in `dorfl.json`, so every AFK build in this repo is nudged to write the failing test first, without my having to repeat it per task.
2. As a maintainer, I want the flag named `promptGuidance.*` (not `testFirst` at top level, not in the gate family), so it is OBVIOUS this is a prompt nudge and not an enforced acceptance criterion the runner guarantees.
3. As the runner, I want the nudge resolved like the other policies (`flag > env > per-repo > global > default:false`), so it composes with the existing config-resolution machinery rather than introducing a new one.
4. As the runner, I want the nudge injected IN-BAND into the worker's prompt (strengthening the existing CLAIM-PROTOCOL "TDD where the task asks for it" line), so it reaches the AFK worker reliably and portably, not via AGENTS.md, which the runner cannot assume exists.
5. As a maintainer, I want a single task or brief to OVERRIDE the repo default in its frontmatter (`promptGuidance.testFirst` true/false on the item), so an exploratory task can opt out (or a critical one opt in). This is the same repo-default-plus-item-override shape as `humanOnly`/`autoBuild`.
6. As `setup`, I want to ASK the maintainer once during the adoption chat (phrased as a nudge: "...your verify gate still decides pass/fail either way"), so the policy is captured at onboarding without being presented as a hard gate.
7. As a maintainer, I want the `verify` gate to remain the ONLY acceptance bar regardless of the nudge, so turning on `testFirst` never changes what passes or fails, only how the worker is encouraged to get there.
8. As a future contributor, I want `promptGuidance` to be an EXTENSIBLE namespace (testFirst is just the first nudge), so later prompt nudges (e.g. preferSmallDiffs, explainTradeoffs) land in the same honest category via the same channel.

### Autonomy notes (the two gate axes)

Omit both `humanOnly` and `needsAnswers`. This brief is resolved and straightforwardly agent-sliceable. The design is locked in conversation; the open decision below is a SLICING-time detail, not a blocker.

## Implementation Decisions

- **New config key `promptGuidance` (object) in `dorfl.json`**, first member `testFirst: boolean`. NOT under the gate family; a distinct namespace whose name says "nudge". Default off (omitted = false).
- **Resolution** mirrors the existing policy chain: `CLI flag > env > per-repo config > global config > default (false)`. Reuse the resolver pattern the gate family already uses; do not invent a parallel one.
- **Per-item override**: slice/brief frontmatter may carry `promptGuidance.testFirst` (true/false) to override the repo default for that item, same precedence idea as `humanOnly`/`autoBuild` at the item level.
- **Prompt assembly** (`prompt.ts` plus the CLAIM-PROTOCOL wrapper): when the resolved nudge is on, the worker prompt's existing soft test-first line is strengthened in-band. The wrapper TEMPLATE owns the canonical text (single source of truth, per the existing "wrapper is read verbatim from CLAIM-PROTOCOL" rule), so the strengthened line, and its conditional inclusion, must be expressible from the protocol doc plus the resolved flag, NOT hardcoded in TS prose. Confirm the cleanest seam: a conditional fragment in CLAIM-PROTOCOL, or a flag-gated wrapper variant.
- **setup**: add ONE adoption-chat question (fold into the existing A-phase question round, do NOT add a separate round), phrased as a nudge. On "yes", write `promptGuidance.testFirst: true` into `dorfl.json` (merge-in, never clobber, per setup's A1 rule). setup MUST NOT write AGENTS.md (host-owned, now an explicit invariant per `methodology-and-skills.md`).
- **AGENTS.md is untouched** by this feature end-to-end. The human-facing statement, if any, is the maintainer's to add to their own host config; the runner's load-bearing channel is the in-band prompt.

## Testing Decisions

- Test EXTERNAL behaviour at the prompt-assembly seam: given a resolved `promptGuidance.testFirst` (on/off, repo-default, item-override), assert the strengthened test-first line is present/absent in the assembled worker prompt. Prior art: `packages/dorfl/test/prompt.test.ts` already asserts on assembled prompt text and wrapper resolution.
- Test the resolution precedence (flag > env > per-repo > global > default) at the config-resolution seam, mirroring the existing gate-family resolution tests.
- Do NOT attempt to test "the worker actually went red→green". It is unobservable from outcomes by design; that non-enforceability is the whole reason this is a nudge, not a gate. (See Out of Scope.)

## Out of Scope

- **Enforcing/verifying that the worker actually wrote the test first.** The runner sees outcomes (gate green), not process (write order). This is a nudge precisely because order is unobservable. If stronger evidence is ever wanted, the lever is *requiring a non-trivial test diff to exist*, not verifying ordering, and that is a separate future decision, not this brief.
- **Writing AGENTS.md / CONTEXT.md as the load-bearing channel.** AGENTS.md is host-owned and setup must not write it; CONTEXT.md is the glossary and is not in the worker's in-band prompt. Either may carry a human-facing restatement, but neither is load-bearing here.
- **Additional nudges** (preferSmallDiffs, explainTradeoffs, etc.). The `promptGuidance` namespace is designed to be extensible, but only `testFirst` is in scope now.

## Further Notes

One slicing-time decision to settle (not a blocker): the exact prompt-assembly seam (a conditional fragment inside CLAIM-PROTOCOL.md vs a flag-gated wrapper variant) must keep the "wrapper text is single-source-of-truth in the protocol doc" rule intact. Pick the option that keeps the canonical text in the protocol doc, not in TS.
