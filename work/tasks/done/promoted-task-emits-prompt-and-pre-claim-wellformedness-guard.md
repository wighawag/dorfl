---
title: Promoted task emits a `## Prompt` + a pre-claim well-formedness guard (no more stuck locks)
slug: promoted-task-emits-prompt-and-pre-claim-wellformedness-guard
spec: observation-discharge-by-deletion-self-contained-promotion-and-prd-route
blockedBy: []
covers: [1]
---

## What to build

Close the residual gap in the observation→task promotion path: a promoted task
must be DISPATCHABLE on its own, not merely content-complete. Today
`buildPromotedBody` (`packages/dorfl/src/triage-persist.ts:~393`) emits
`## What to build` + the observation's mechanism prose + (optional)
`## Open questions`, but NO `## Prompt`. The validator `resolveTask`
(`packages/dorfl/src/prompt.ts:595`; the throw is at ~L620 via
`extractPromptSection(content) === undefined`) REQUIRES a `## Prompt` heading and
throws `task '<slug>' ... has no '## Prompt' section`. Crucially, `resolveTask`
is called only at the DISPATCH step (`do.ts:~1003`, step 5 "run the agent"),
which runs AFTER the per-item claim lock is taken; the `PromptError` is caught
and routed to `saveAgentFailure`, which stamps the lock `state: stuck` — a wasted
dispatch and a litter of stuck locks the human must `requeue --reset`. So the
validation ALREADY EXISTS and is correct; the bug is purely that it runs too
LATE (post-claim), and that the promotion producer emits a body that fails it.

This is a residual against PRD US #1 ("the spawned task is buildable on its own"):
the keystone task `promotion-self-contained-body-and-delete-on-promote-task-route`
(now in `tasks/done/`) delivered self-containment of CONTENT but not structural
dispatchability. Evidence: `grep -n Prompt packages/dorfl/src/triage-persist.ts`
returns nothing, and commit `532d894` (created 2026-06-24, after that work) shows
a promoted body with no `## Prompt`. Full write-up:
`work/notes/observations/advance-promotion-builds-promptless-task-that-self-claims-stuck-2026-06-25.md`.

Two changes, defence in depth:

1. **`buildPromotedBody` emits a `## Prompt` section** when `artifact === 'task'`
   (a PRD does not need one). Seed it from the observation's mechanism prose, the
   same way intake's `renderTask` default scaffold (`intake.ts:~1617`) already
   emits a thin `## Prompt`. A promoted task must then pass `assembleWorkPrompt`
   without throwing.
2. **Run the EXISTING `## Prompt` validation PRE-CLAIM** — do NOT author a second,
   divergent check. `resolveTask`/`extractPromptSection` already rejects a body
   with no `## Prompt`; the fix is to call that same validation BEFORE the claim
   lock is acquired, so a malformed body is refused with a clean usage error and
   NO lock is taken (instead of claiming, then failing at dispatch and stranding a
   stuck lock). Reusing the one validator (not forking a parallel prompt-presence
   check) keeps a single source of truth for "what makes a task dispatchable."
   This guards malformed task bodies from ANY source (hand-authored, externally
   edited), not only the promotion path, so it is worth keeping even after change 1.

   Cover the claim path GENERALLY, not just one site: `resolveTask` is called from
   `do.ts:~1003` (in-place) AND `do.ts:~2172` (worktree), plus `run.ts:~775`. The
   pre-claim guard must sit at the shared chokepoint so a malformed body is
   refused on EVERY build entry, not only the in-place one (else the worktree /
   advance path still strands a lock).

Scope note: this is an INTERIM guard. The durable fix is centralizing ONE shared
buildable-task renderer used by both `intake.renderTask` and
`triage-persist.buildPromotedBody` (PRD
`centralize-buildable-task-renderer-shared-by-intake-and-promotion`, the deferred
Resolved-decision-1 extraction). That PRD SUPERSEDES change 1 by moving the
`## Prompt` synthesis into the shared renderer; this task's tests stay valid and
protect that refactor from regressing. Land this guard now; refactor behind it
later.

## Acceptance criteria

- [ ] A promoted observation's spawned task body contains a `## Prompt` section,
      and `assembleWorkPrompt` accepts that task without throwing
      "has no '## Prompt' section".
- [ ] The `## Prompt` is seeded from the observation's mechanism prose (assert it
      carries the real signal, not an empty/placeholder-only prompt).
- [ ] A task body with NO `## Prompt` is refused at the PRE-CLAIM well-formedness
      check (a clean usage error), and the per-item claim lock is NOT acquired
      (assert no lock ref is created / left `stuck`).
- [ ] A well-formed task still claims and dispatches exactly as today (no
      regression to the happy path).
- [ ] Tests cover both changes, mirroring the throwaway-git-repo pattern already
      used by `triage-persist`/`apply-persist`/the claim tests.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- None — can start immediately. (Independent of the centralization PRD; that PRD
  later folds change 1 into the shared renderer.)

## Prompt

> Goal: make the observation→task promotion path produce a DISPATCHABLE task and
> stop it stranding stuck locks, per the observation
> `advance-promotion-builds-promptless-task-that-self-claims-stuck-2026-06-25`
> and PRD `observation-discharge-by-deletion-self-contained-promotion-and-prd-route`
> (this closes the residual against that PRD's US #1 — "buildable on its own"
> must include "passes `assembleWorkPrompt` without throwing").
>
> Two changes, defence in depth:
> 1. In `packages/dorfl/src/triage-persist.ts`, make `buildPromotedBody` emit a
>    `## Prompt` section for the `task` artifact (not for `prd`), seeded from the
>    observation's mechanism prose. Mirror the thin-`## Prompt` shape intake's
>    `renderTask` default scaffold already uses (`packages/dorfl/src/intake.ts`,
>    around the `'## Prompt'` scaffold ~L1617) so the producer and consumer agree
>    on the buildable-task schema.
> 2. Run the EXISTING `## Prompt` validation BEFORE the claim lock is acquired —
>    do NOT write a new, parallel check. The validator is `resolveTask` /
>    `extractPromptSection` (`packages/dorfl/src/prompt.ts:595`, throw at ~L620),
>    NOT `assembleWorkPrompt`. It currently runs only at the dispatch step
>    (`do.ts:~1003`, step 5), AFTER the claim, so the failure is caught by
>    `saveAgentFailure` and the lock is left `state: stuck` (the bug this task
>    removes). Reorder/relocate that same validation to the PRE-CLAIM point so a
>    body missing `## Prompt` is refused with a clean usage error and NO lock is
>    acquired. Apply it at the shared claim chokepoint so EVERY build entry is
>    covered — `resolveTask` is called from `do.ts:~1003` (in-place),
>    `do.ts:~2172` (worktree), and `run.ts:~775`; a one-site fix leaves the others
>    stranding locks. The guard must apply to a malformed body from ANY source,
>    not just promotion.
>
> Do NOT centralize the renderer here — that is the separate PRD
> `centralize-buildable-task-renderer-shared-by-intake-and-promotion`. This task
> is the interim guard it supersedes; keep the change minimal and well-tested so
> that refactor can safely absorb change 1.
>
> Tests: a promoted task carries a real `## Prompt` and passes `assembleWorkPrompt`;
> a promptless body is refused pre-claim with NO lock acquired; the happy path is
> unchanged. Use the throwaway-git-repo test pattern already in the
> `triage-persist`/`claim` tests. Finish green:
> `pnpm -r build && pnpm -r test && pnpm format:check`.
