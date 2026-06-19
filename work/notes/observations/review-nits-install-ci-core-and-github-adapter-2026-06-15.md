---
title: review-gate non-blocking nits for 'install-ci-core-and-github-adapter' (Gate 2 approve)
date: 2026-06-15
status: open
reviewOf: install-ci-core-and-github-adapter
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-core-and-github-adapter' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- RATIFY: per-capability SELECTION was not built; the CLI passes EVERY registered capability to `buildSetupArtifacts` unconditionally (no selection gate). Is deferring selection to a later wiring/sibling slice the intended split?
  (PRD US #2 and the Solution section repeatedly stress that each capability is 'independently selectable' (adopt auto-build without ever wiring intake). This core slice's wizard prompts only for auth/providers/harness, never for which capabilities to emit, and `cli.ts` does `const capabilities = await loadCapabilityRegistry()` then emits all of them. For THIS slice it is harmless (only the no-op `example-noop` registers, emitting []), but once a sibling slice registers a real emitter it will be emitted with NO user choice unless a selection gate is added. The seam is correct; the SELECTION UX is simply absent. Confirm a later slice owns selection, or that selection should have been part of this foundation.)
- COHERENCE: the name `GitHubCIContext` now means TWO different things. The core exports `type GitHubCIContext = CIProviderContext` (the generic seam interface); the adapter exports `class GitHubCIContext implements CIProviderContext` (the concrete live impl). Should one be renamed so the term is single-meaning?
  (Re-meaning a term in two modules is the kind of inconsistency that survives many slices. The collision already forces `index.ts` to re-export the core type as `GitHubCIContextType` to avoid a name clash with the class. The canonical seam name IS `CIProviderContext` (used consistently), and the `GitHubCIContext` type alias is justified in a comment as 'keep whitesmith's vocabulary readable', but having the same identifier denote both the abstract seam and a specific provider's class is a coherence smell. Non-blocking because it compiles and the load-bearing name is `CIProviderContext`; flagging so the human can decide to drop the type alias or rename the class.)
- RATIFY default: the `install-ci` scaffolder defaults the harness to `pi` (`DEFAULT_HARNESS = 'pi'`, and the wizard's first harness choice is `pi`), whereas the engine `Config.harness` defaults to `null`. Is the scaffolder-side `pi` default intended?
  (config.ts documents `harness` as defaulting to `null` (shell out to `agentCmd`). The scaffolder choosing `pi` is defensible (the composite action must install a concrete harness, and `npm install -g @mariozechner/pi-coding-agent` is the natural CI default), but it is a user-visible default that diverges from the engine default and was not specified by the slice. Worth a nod from the human.)
- RATIFY new behaviour: the readline prompt seam returns an EMPTY string for every prompt when stdin is not a TTY (silent fallback) rather than erroring or refusing. Acceptable, or should a non-interactive invocation without `--config` fail loudly?
  (`readlinePrompts()` in cli.ts: `if (!process.stdin.isTTY) { resolvePrompt(''); return; }`. A piped/CI invocation of bare `install-ci` (no `--config`) therefore silently accepts all defaults / blanks instead of hanging or erroring. The comment says 'use --config for a fully non-interactive reproduction', so this is deliberate, but a silent all-defaults run of a SECRET-setting scaffolder is a slightly surprising failure mode worth ratifying (e.g. consider erroring with 'no TTY; pass --config').)
