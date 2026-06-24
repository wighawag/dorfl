---
title: 'setup: ask the test-first nudge question in the adoption chat and persist promptGuidance.testFirst'
slug: prompt-guidance-testfirst-setup-adoption-question
brief: prompt-guidance-test-first
blockedBy: [prompt-guidance-testfirst-config-and-prompt-seam]
covers: [6]
---

## What to build

Extend the `setup` skill's adoption conversation so the maintainer is asked ONCE, phrased AS a nudge (not a gate), whether AFK builds in this repo should default to test-first. On "yes", `promptGuidance.testFirst: true` is merged into `.dorfl.json` (never clobbering existing config); on "no" / "skip" / "don't know", nothing is written (omitted ⇒ `false`, the runtime default from the sibling tracer slice).

End-to-end behaviour:

1. The setup A-phase question round (`skills/setup/SKILL.md`, the existing adoption chat) gains ONE more question, FOLDED into the existing round (do NOT add a new round — per the brief and per setup's "batch the asks" rule). Phrasing must signal nudge-not-gate, e.g.: _"Should AFK builds in this repo default to writing the failing test BEFORE the production code? Your `verify` gate still decides pass/fail either way — this just strengthens the wording the worker is given."_
2. On a positive answer, merge `promptGuidance: { testFirst: true }` into the target repo's `.dorfl.json` per setup's existing merge-don't-clobber rule (A1) — preserve sibling keys, do not rewrite the file.
3. On a negative / skip / don't-know answer, write NOTHING (per setup's "if the user is absent / declines / does not know → write NOTHING" doctrine in `skills/setup/SKILL.md`). The runtime default (`false`) takes over from the sibling tracer slice.
4. Do NOT write or modify `AGENTS.md`. AGENTS.md is host-owned and setup's explicit invariant forbids writing it (PRD Out of Scope; setup SKILL §A1 / methodology-and-skills.md).
5. Update `CONTEXT.md`'s glossary (only if setup is already touching it for this adoption pass — per its existing append-only rule) with one short line on what `promptGuidance` means, so a future reader of a repo that opted in can find what the key does.

## Acceptance criteria

- [ ] The setup adoption flow asks the test-first nudge question exactly ONCE per adoption, inside the existing A-phase round (no extra round; tested by counting prompts or by snapshotting the question sequence in the existing setup tests).
- [ ] Phrasing reads as a nudge, not a gate (e.g. mentions that `verify` still decides pass/fail) — covered by a snapshot/string test.
- [ ] On "yes", `.dorfl.json` ends up with `promptGuidance.testFirst: true` merged in, with every other existing key preserved verbatim (merge-don't-clobber test: pre-populate the file with unrelated keys and assert they survive).
- [ ] On "no" / "skip" / "don't know" / absent user, `.dorfl.json` is NOT created or modified for this key (no `promptGuidance` written; if the file already exists, it is byte-identical to its pre-run contents w.r.t. this key).
- [ ] AGENTS.md is NEVER written or modified by setup as part of this question (existing invariant — add a test if one does not already cover it).
- [ ] Setup's other A-phase questions and their ordering are unchanged in behaviour (regression-guard the existing setup tests).
- [ ] If the runtime path actually reads the written `promptGuidance.testFirst: true`, the prompt is strengthened end-to-end (one integration-style test exercising setup → config → prompt assembly, OR an explicit handoff test, depending on what the existing setup test style supports).
- [ ] Tests ISOLATE the writes — setup's existing tests already point HOME / config dirs at temp scratch dirs; this slice MUST keep that isolation (assert no write to the real `~/.dorfl` / real `.dorfl.json` outside the fixture).

## Blocked by

- `prompt-guidance-testfirst-config-and-prompt-seam` — the config schema + resolver + runtime semantics for `promptGuidance.testFirst` must exist first; otherwise setup would be writing a key nothing reads.

## Prompt

> You are extending the `setup` skill's adoption conversation with ONE additional nudge question, asked once, that on "yes" merges `promptGuidance.testFirst: true` into the target repo's `.dorfl.json`. The key's runtime meaning is already implemented by the blocker slice; this slice is purely the onboarding ask + merge.
>
> FIRST: read the source brief (`work/briefs/ready/prompt-guidance-test-first.md`) — User Story #6 + the setup-specific decisions — AND the setup SKILL itself (`skills/setup/SKILL.md`, especially A1 "merge, never clobber", A2 "adoption conversation", and the "if the user is absent/declines/does not know → write NOTHING" doctrine). Drift-check: do not bolt on a separate question round; FOLD into the existing A-phase round.
>
> DOMAIN VOCAB: `nudge` (prompt-text guidance, NOT an enforced gate); `A-phase` (setup's adoption-conversation round); `merge-don't-clobber` (A1 — preserve every existing key in `.dorfl.json`); the host-ownership rule for AGENTS.md (setup MUST NOT write it).
>
> WHERE TO LOOK: `skills/setup/SKILL.md` (the question round and the merge rules — this is the SOURCE OF TRUTH, do not silently drift it); the existing setup tests / fixtures that exercise the adoption flow; the `.dorfl.json` writer/merger code paths setup already uses to persist `autoBuild`/`autoSlice`/`verify`/etc.
>
> SEAMS TO TEST AT: the setup adoption flow itself (assert the question is asked once, with nudge phrasing, and the post-condition on `.dorfl.json` matches the answer); the integration handoff (a "yes" produces a config file that, fed to the runtime, strengthens the prompt).
>
> CONSTRAINTS: AGENTS.md MUST NOT be written. SETUP MUST NOT add a separate question round; fold into the existing one. All tests MUST isolate any HOME / config-dir writes per `work/protocol/WORK-CONTRACT.md` "Task quality rule — tests must not touch the real environment" and the existing setup-test convention (assert the real `~/.dorfl.json` is UNTOUCHED).
>
> DONE means: setup asks the nudge question once in-band; on yes, the key is merged; on anything else, nothing is written; AGENTS.md untouched; existing setup tests still pass; `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> RECORD non-obvious decisions — e.g. the EXACT question wording, whether to also ask interactively when running setup non-interactively (CI), or how to behave if `promptGuidance` already exists in the file with conflicting members.
