---
title: propose-mode PR body — the agent's summary on the PR, not an empty description
slug: propose-pr-body
needsAnswers: true
blockedBy: []
covers: []
---

## What to build

> Self-contained feature against the integration seam \u2014 derives from NO PRD
> (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of
> truth. Spotted in real use: `work/observations/propose-pr-has-empty-body-no-agent-
> message.md` (PR #1 opened with an EMPTY body).

Give `propose`-mode PRs a real **description** instead of an empty body. Today the
GitHub provider runs `gh pr create ... --fill` (derives title/body from commit
subjects \u2192 title-only, empty body). A reviewer landing on a multi-file PR gets no
summary, no decisions, no pointer to the slice spec.

- **Add an optional `body` to the provider seam.** `OpenRequestInput`
  (`src/integrator.ts`) gains an optional `body`; the GitHub provider passes it as
  `gh pr create --body <body>` (instead of `--fill` when a body is present); the
  `none` provider includes it in its manual-instruction output; no behaviour change
  when `body` is absent (degrades to today's `--fill`).
- **The body should carry** (whatever the resolved source \u2014 see the open question):
  a short summary of what was built, key decisions/deviations worth a reviewer's
  attention, a pointer back to the slice file (`work/done/<slug>.md`) + the PRD/ADR
  it serves, and optionally any "please check X" the agent was unsure about (a
  lightweight in-PR echo of needs-attention surfacing).
- The body is **advisory prose** \u2014 it gates nothing (no trust-boundary role), so a
  model-authored body is fine (unlike the `verify` gate).

## Open questions (resolve before building \u2014 clear `needsAnswers` when done)

1. **Source of the body \u2014 agent-emitted vs runner-synthesised?** The build agent
   does NO git (the runner owns the PR open), so an agent-authored summary needs a
   clean hand-off channel: the runner captures the agent's final message (or a
   designated `## Summary` block the agent emits) and passes it as the body. The
   alternative is the runner SYNTHESISING the body from the slice file + the diff
   (no agent text needed, but less rich). Decide which (or a hybrid: runner
   scaffolds slice-pointer + diff stat, agent's summary fills the prose). This is
   the load-bearing decision \u2014 it determines whether the harness seam needs a
   "final summary" output channel.
2. **Hand-off channel (if agent-emitted):** how does the agent's summary reach the
   runner without the agent doing git? (e.g. the harness returns the agent's last
   assistant message; or a convention that the agent writes the summary to a known
   transient path the runner reads.) Mind that the agent is sandboxed to editing
   code + getting the gate green.
3. **Human `complete --propose` too?** Should the same body capability apply when a
   HUMAN runs `complete --propose` (a human-authored `--message`-style body), or is
   this autonomous-path-only for now?

## Acceptance criteria

> Provisional \u2014 finalise when the open questions are resolved.

- [ ] `OpenRequestInput` carries an optional `body`; the GitHub provider passes it
      via `gh pr create --body` (and only falls back to `--fill` when absent); the
      `none` provider surfaces it in its manual instructions.
- [ ] The resolved body (per the decided source, Q1) includes a summary + a pointer
      to `work/done/<slug>.md`; absent body ⇒ today's behaviour (no regression).
- [ ] Tests (stubbed provider): a PR opened with a body passes it through; absent
      body degrades cleanly; the GitHub adapter builds the right `gh` args.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None \u2014 self-contained against the integration seam. (`needsAnswers` until Q1\u2013Q3
  are decided.)

## Prompt

> NOTE: `needsAnswers: true` \u2014 do NOT build until the open questions (body SOURCE:
> agent-emitted vs runner-synthesised; the hand-off channel; whether human
> `complete --propose` is in scope) are answered and the flag cleared. If reading
> this with the flag set, surface the questions, don't guess the source design.
>
> Once unblocked: give `propose`-mode PRs a real body instead of `gh pr create
> --fill`'s empty description. Add an optional `body` to `OpenRequestInput`
> (`src/integrator.ts`); the GitHub provider (`src/github.ts`) passes `--body` when
> present (else today's `--fill`); the `none` provider includes it in its manual
> instructions. Source the body per the resolved Q1 decision (capture the agent's
> final summary via the harness seam, or synthesise from slice + diff). Body is
> advisory prose \u2014 no gate role.
>
> READ FIRST: `work/observations/propose-pr-has-empty-body-no-agent-message.md`
> (the gap + direction), `src/integrator.ts` (`ReviewProvider.openRequest` /
> `OpenRequestInput`), `src/github.ts` (the `gh pr create --fill` call to extend),
> `docs/adr/execution-substrate-decisions.md` §6 (the integration seam), and \u2014 if
> agent-emitted \u2014 `src/harness.ts` (how a final agent summary would be captured).
>
> TDD with vitest, house style (stubbed provider): body passed through to `gh`
> args; absent body = no regression; `none` provider surfaces it. "Done" =
> acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim propose-pr-body --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/propose-pr-body <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/propose-pr-body.md work/done/propose-pr-body.md
```
