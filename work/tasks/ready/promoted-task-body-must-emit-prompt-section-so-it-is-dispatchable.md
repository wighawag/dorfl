---
title: A promoted-observation task body must emit a ## Prompt section so the minted task is dispatchable
slug: promoted-task-body-must-emit-prompt-section-so-it-is-dispatchable
covers: []
blockedBy: []
---

## What to build

When the apply rung promotes an answered observation into a task (`promoteObservation` → `buildPromotedBody` → `renderTaskBody`), the minted `work/tasks/ready/<slug>.md` is coming out with NO `## Prompt` section. Every such auto-minted task is therefore NON-DISPATCHABLE: when `advance --propose` (autoBuild) later picks it up, the build leg fails with `error: '<slug>' has no '## Prompt' section, so it is not dispatchable — add a '## Prompt' section to the task body before claiming it` (the `extractPromptSection`/`resolveTask` guard in `prompt.ts`). This blocks the entire promote→build pipeline: the observation-apply loop successfully MINTS tasks from a human's "mint a task" answer, but none of them can then be built autonomously.

This directly contradicts the DESIGNED behaviour recorded in `triage-persist.ts` and `buildable-body.ts`: those doc-comments state the promotion body is `## What to build` + optional `## Open questions` + a `## Prompt` seeded (blockquoted) from the mechanism prose, and explicitly note that the `## Prompt` is "the STRUCTURAL dispatchability the validator requires; without it a dispatched build throws 'has no ## Prompt section'." So the renderer is SUPPOSED to emit it, but the promote route is not producing it in practice.

Fix: make the promote path emit a `## Prompt` section in the minted task body, matching the documented buildable-task shape, so an auto-minted task is dispatchable without human hand-editing. Diagnose WHERE the prompt is lost: is `buildPromotedBody` calling `renderTaskBody` with a shape that suppresses the prompt (e.g. an empty/omitted prompt seed that renders to nothing), is the prompt heading rendered under a different level/spelling that `extractPromptSection` doesn't match, or is the promote route bypassing the shared renderer for observations? Then close the gap so a `## Prompt` is always present.

Evidence (verify against current main, references by symbol not line): on 2026-07-07 the apply loop minted `pi-harness-polish`, `in-place-scan-subtracts-held-locked-slugs-from-propose-matrix`, `harden-fresh-worktree-gate-sandbox-count-against-parallel-flake` (and ~30 more) — each has ZERO `## Prompt` sections and each failed its `advance --propose` build leg with the "no ## Prompt section" error, while hand-written tasks (e.g. `jitter-and-widen-cas-contention-retry-for-lifecycle-fanout`) that DO carry `## Prompt` build fine.

## Acceptance criteria

- [ ] `buildPromotedBody` (the observation→task promote renderer) emits a `## Prompt` section in the minted task body, so the minted `work/tasks/ready/<slug>.md` passes the `extractPromptSection`/`resolveTask` dispatchability guard.
- [ ] The emitted `## Prompt` is seeded from the observation's mechanism/fix prose (blockquoted), per the documented shape — not an empty stub that renders to nothing.
- [ ] A test asserts that a task minted via `promoteObservation` from a fully-answered observation contains a `## Prompt` section AND is accepted by the same dispatchability check the build path uses (`resolveTask`/`extractPromptSection`), i.e. it does not throw "has no ## Prompt section". Mirror the existing `triage-persist` / `buildable-body` test style.
- [ ] The `namespace: 'spec'` promote route is unaffected (a SPEC legitimately has no `## Prompt`); only the task route must gain/keep the prompt.
- [ ] Full acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately. High priority: it unblocks the autonomous BUILD of every task the observation-apply loop mints.

## Prompt

> Self-contained. Goal: make every task the apply rung mints from an answered observation DISPATCHABLE by ensuring its body carries a `## Prompt` section. Symptom: on the 2026-07-07 lifecycle run, ~33 `advance --propose` build legs failed with `error: '<slug>' has no '## Prompt' section, so it is not dispatchable`, and inspection shows every BOT-MINTED task in `work/tasks/ready/` has ZERO `## Prompt` sections, while hand-written tasks have one. The promote path is `promoteObservation` → `buildPromotedBody` (both in `triage-persist.ts`) → `renderTaskBody` (in `buildable-body.ts`). Those modules' own doc-comments say the promotion body is `## What to build` + optional `## Open questions` + a `## Prompt` seeded from the mechanism prose, and that the `## Prompt` is required for dispatchability (`extractPromptSection`/`resolveTask` in `prompt.ts` throws its absence) — so the renderer is SUPPOSED to emit it but does not in practice.
>
> Diagnose where the prompt is dropped: (1) does `buildPromotedBody` pass a prompt seed to `renderTaskBody` at all, or pass `undefined`/empty so the prompt renders to nothing; (2) does `renderTaskBody` gate the `## Prompt` block on a non-empty seed (so an empty seed omits the whole section); (3) is the heading spelled/levelled in a way `extractPromptSection` won't match? Fix so a `## Prompt` (seeded from the observation's mechanism/fix prose, blockquoted, per the documented shape) is ALWAYS present for the task route. Keep the SPEC route promptless (a SPEC is not dispatched by `do`/`run`).
>
> FIRST check against current reality (launch snapshot; may have drifted): re-read `triage-persist.ts` (`promoteObservation`, `buildPromotedBody`), `buildable-body.ts` (`renderTaskBody`/`renderPrdBody` and the empty-prompt-seed handling), and `prompt.ts` (`extractPromptSection`/`resolveTask`, the exact guard + heading match). If a recent change already added the prompt or reshaped the renderer, adjust; do not build on a stale premise. Reproduce the bug first: mint a task from a fully-answered observation fixture and assert it currently lacks `## Prompt`, then make it pass.
>
> Test at the seam the repo already tests (`triage-persist` promote with a throwaway git repo, and `buildable-body` rendering). RECORD any non-obvious in-scope decision (e.g. the exact default prompt text when the observation's mechanism prose is thin) per the task template's decision rule. Done = promoted tasks carry a dispatchable `## Prompt`, a test pins it against the real dispatchability guard, and the full acceptance gate is green.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim promoted-task-body-must-emit-prompt-section-so-it-is-dispatchable --arbiter origin   # default --arbiter origin
# then start work on the updated main:
git fetch origin && git switch -c work/promoted-task-body-must-emit-prompt-section-so-it-is-dispatchable origin/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/promoted-task-body-must-emit-prompt-section-so-it-is-dispatchable.md work/tasks/done/promoted-task-body-must-emit-prompt-section-so-it-is-dispatchable.md
```
