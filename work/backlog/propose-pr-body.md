---
title: propose-mode PR title + body — a short title and the agent's summary, not gh --fill's run-on subject + empty description
slug: propose-pr-body
needsAnswers: true
blockedBy: []
covers: []
---

## What to build

> Self-contained feature against the integration seam — derives from NO PRD
> (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of
> truth. Spotted in real use: PR #1 opened with an EMPTY body (the spawning
> observation has since been deleted, its signal captured here); and PR #6 opened
> with a **multi-line run-on title** (the whole commit subject
> `feat(...): ... ; --reset ... ; --message ... ; done`).

Give `propose`-mode PRs **both a short, single-line title AND a real description**,
instead of `gh pr create --fill`'s commit-subject-derived title + empty body.

**Two independent halves — and the title half is answerable NOW (no `needsAnswers`
dependency); the body half is what the open questions below gate:**

### Half A — TITLE (runner-synthesised; answerable now, no open question)

Today `--fill` makes the PR title the first line of the build-agent's commit
subject, which is an unbounded run-on sentence (PR #6: a four-clause title ending
`; done`). Instead, synthesise a short, single-line title from data the runner
ALREADY has — no agent text needed:

- Source: the slice file's frontmatter `title:` (human-authored, already concise)
  and `slug:`. Compose e.g. `<type>(<slug>): <slice title>` (reuse the same
  `--type` convention `complete` already supports; default `feat`).
- ENFORCE a single line + a sane length cap (e.g. ≤ ~72 chars, truncate with `…`),
  so it can never be multi-line again regardless of the source.
- This stops relying on `--fill` for the title: pass `--title <synthesised>`
  explicitly. (A PRD-derived slice could prefer the PRD title; a `covers: []`
  chore uses its own slice title — both live in frontmatter.)

This half is the immediate pain (felt live on PR #6) and depends on NONE of the
open questions below — it is pure runner-side synthesis from the slice file.

### Half B — BODY (the open-question half)

Give `propose`-mode PRs a real **description** instead of an empty body. Today the
GitHub provider runs `gh pr create ... --fill` (derives title/body from commit
subjects → title-only, empty body). A reviewer landing on a multi-file PR gets no
summary, no decisions, no pointer to the slice spec.

- **Add an optional `body` to the provider seam.** `OpenRequestInput`
  (`src/integrator.ts`) gains an optional `body`; the GitHub provider passes it as
  `gh pr create --body <body>` (instead of `--fill` when a body is present); the
  `none` provider includes it in its manual-instruction output; no behaviour change
  when `body` is absent (degrades to today's `--fill`).
- **The body should carry** (whatever the resolved source — see the open question):
  a short summary of what was built, key decisions/deviations worth a reviewer's
  attention, a pointer back to the slice file (`work/done/<slug>.md`) + the PRD/ADR
  it serves, and optionally any "please check X" the agent was unsure about (a
  lightweight in-PR echo of needs-attention surfacing).
- The body is **advisory prose** — it gates nothing (no trust-boundary role), so a
  model-authored body is fine (unlike the `verify` gate).

## Open questions (gate Half B only; Half A — the title — is decided)

> NOTE: these questions gate the **body** (Half B). **Half A (the title) is
> answerable now** and can ship even while these stay open — if a future build
> wants to land the title fix first and leave `needsAnswers` set for the body,
> that is in-contract (the title needs no agent hand-off channel).

1. **Source of the body — agent-emitted vs runner-synthesised?** The build agent
   does NO git (the runner owns the PR open), so an agent-authored summary needs a
   clean hand-off channel: the runner captures the agent's final message (or a
   designated `## Summary` block the agent emits) and passes it as the body. The
   alternative is the runner SYNTHESISING the body from the slice file + the diff
   (no agent text needed, but less rich). Decide which (or a hybrid: runner
   scaffolds slice-pointer + diff stat, agent's summary fills the prose). This is
   the load-bearing decision — it determines whether the harness seam needs a
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

> Half A (title) is final; Half B (body) is provisional — finalise when the open
> questions are resolved.

- [ ] **(Half A — title)** the GitHub provider passes an explicit single-line
      `--title` synthesised from the slice's frontmatter `title:` + `slug:` (e.g.
      `<type>(<slug>): <title>`), capped to one line ≤ a sane length, instead of
      letting `--fill` derive a multi-line title from the commit subject. A test
      proves a long/multi-line source yields a single capped line, and that the
      `none` provider's manual instruction shows the same title.
- [ ] **(Half B — body)** `OpenRequestInput` carries an optional `body`; the GitHub
      provider passes it via `gh pr create --body` (and only falls back to `--fill`
      when absent); the `none` provider surfaces it in its manual instructions.
- [ ] The resolved body (per the decided source, Q1) includes a summary + a pointer
      to `work/done/<slug>.md`; absent body ⇒ today's behaviour (no regression).
- [ ] Tests (stubbed provider): a PR opened with a body passes it through; absent
      body degrades cleanly; the GitHub adapter builds the right `gh` args.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — self-contained against the integration seam. (`needsAnswers` until Q1–Q3
  are decided.)

## Prompt

> NOTE: `needsAnswers: true` gates the BODY (Half B) only. The TITLE (Half A) is
> DECIDED and answerable now — a build MAY land Half A (and only Half A) while the
> flag stays set for the body. Half B's open questions (body SOURCE: agent-emitted
> vs runner-synthesised; the hand-off channel; whether human `complete --propose`
> is in scope) must be answered + the flag cleared before building the body.
>
> HALF A (title, decided): stop letting `gh pr create --fill` set the title from
> the commit subject (PR #6 got a 4-clause run-on title ending `; done`). Pass an
> explicit `--title` synthesised runner-side from the slice frontmatter `title:` +
> `slug:` (e.g. `<type>(<slug>): <title>`, reusing `complete`'s `--type`
> convention; default `feat`), forced to a single line and capped to a sane
> length. No agent text needed — pure runner synthesis from the slice file.
>
> HALF B (body, blocked on Qs): give `propose`-mode PRs a real body instead of `gh
> pr create --fill`'s empty description. Add an optional `body` to `OpenRequestInput`
> (`src/integrator.ts`); the GitHub provider (`src/github.ts`) passes `--body` when
> present (else today's `--fill`); the `none` provider includes it in its manual
> instructions. Source the body per the resolved Q1 decision (capture the agent's
> final summary via the harness seam, or synthesise from slice + diff). Body is
> advisory prose — no gate role.
>
> READ FIRST: `work/observations/propose-pr-has-empty-body-no-agent-message.md`
> (the gap + direction), `src/integrator.ts` (`ReviewProvider.openRequest` /
> `OpenRequestInput`), `src/github.ts` (the `gh pr create --fill` call to extend),
> `docs/adr/execution-substrate-decisions.md` §6 (the integration seam), and — if
> agent-emitted — `src/harness.ts` (how a final agent summary would be captured).
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
