---
title: propose-mode PR title + body — a short title and the agent's summary, not gh --fill's run-on subject + empty description
slug: propose-pr-body
blockedBy: []
covers: []
---

> **`needsAnswers` CLEARED 2026-06-06** — Half B's open questions are resolved (see
> "Open questions" below, now answered): the body is the AGENT'S final summary,
> captured via the harness seam's `LaunchResult.output` (built by
> `harness-agent-output`, PR #12) — the exact hand-off channel Q1/Q2 needed. Q3:
> human `complete --propose` MAY pass a `--message`-style body too (same optional
> `body` field), but that is a thin add, not required for the autonomous path.

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

- **Add an optional `body` (and `title`) to the provider seam — AND thread it from
  `complete.ts` (verified layer note 2026-06-06).** `OpenRequestInput`
  (`src/integrator.ts`) gains optional `body`/`title`; the GitHub provider passes
  them as `gh pr create --title <t> --body <body>` (instead of `--fill` when
  present); the `none` provider includes them in its manual-instruction output; no
  behaviour change when absent (degrades to today's `--fill`). **NOTE the call
  chain (one layer longer than just `OpenRequestInput`):** `openRequest` is called
  INSIDE the integrator (`integrateWithRebase`), which is built from
  `IntegrateInput` passed DOWN from `complete.ts`. So `body`/`title` must also be
  added to `IntegrateInput` and threaded `complete.ts` → `IntegrateInput` →
  `OpenRequestInput` → `gh`. The body's SOURCE (the agent's `LaunchResult.output`)
  lives in `complete.ts`, so that is where it enters the chain.
- **Source (RESOLVED):** the agent's FINAL SUMMARY via `LaunchResult.output`
  (`harness-agent-output`, PR #12) as the prose, optionally under a runner-scaffolded
  header (slice pointer + PRD/ADR + diff stat).
- **The body should carry:** a short summary of what was built, key
  decisions/deviations worth a reviewer's attention, a pointer back to the slice
  file (`work/done/<slug>.md`) + the PRD/ADR it serves, and optionally any "please
  check X" the agent was unsure about (a lightweight in-PR echo of needs-attention
  surfacing).
- **Shared seam note:** the optional `body` on `OpenRequestInput` (added here) and
  the PR-COMMENT capability `review-gate-pr-comment` adds are BOTH "write text to the
  PR" on the provider seam. This slice adds the **creation body** (`--body` at PR
  open); `review-gate-pr-comment` adds a **follow-up comment** (`postComment` on the
  opened PR). Design them consistently — same provider, same graceful-degradation
  discipline — but they are separate fields/methods (body at open vs comment after).
- The body is **advisory prose** — it gates nothing (no trust-boundary role), so a
  model-authored body is fine (unlike the `verify` gate).

## Open questions — RESOLVED 2026-06-06 (were Half B gates; now answered)

> Half A (the title) was always decided. Half B's questions are now resolved by the
> `harness-agent-output` seam (PR #12), which built the exact hand-off channel Q1/Q2
> needed.

1. **Source of the body — RESOLVED: AGENT-EMITTED (hybrid-friendly).** The body is
   the build agent's FINAL SUMMARY, captured via the harness seam's
   `LaunchResult.output` (the last assistant message — built by
   `harness-agent-output`). The runner MAY scaffold a deterministic header
   (slice-pointer `work/done/<slug>.md` + the PRD/ADR it serves + diff stat) and
   append the agent's `output` summary as the prose — the hybrid the question
   floated, now cheap because the channel exists. No new "final summary" channel is
   needed; reuse `LaunchResult.output`.
2. **Hand-off channel — RESOLVED: `LaunchResult.output`.** The harness already
   returns the agent's final assistant message (pi from its `.jsonl`, null/shell
   from stdout — `harness-agent-output`). The agent does NO git; the runner reads
   `output` and composes the PR body. No transient-path convention needed.
3. **Human `complete --propose` — RESOLVED: YES, optionally.** The same optional
   `body` field applies; a human may pass a `--message`/`--body`-style description
   on `complete --propose`. Thin add (the field already exists for the autonomous
   path); not required to ship the autonomous body, but in scope so the two paths
   share one mechanism.

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

- None for the code. (`needsAnswers` is now CLEARED — Q1–Q3 resolved.) Half B reads
  the agent summary from `LaunchResult.output`, which `harness-agent-output` (PR #12)
  built — so for the live agent body to be non-empty, that must be merged first
  (it is, on `main`). Half A (title) depends on nothing.

## Prompt

> NOTE: `needsAnswers` is CLEARED (2026-06-06) — both halves are buildable. Body
> SOURCE is RESOLVED: the agent's final summary via `LaunchResult.output`
> (`harness-agent-output`, PR #12); human `complete --propose` may pass a body too.
>
> HALF A (title, decided): stop letting `gh pr create --fill` set the title from
> the commit subject (PR #6 got a 4-clause run-on title ending `; done`). Pass an
> explicit `--title` synthesised runner-side from the slice frontmatter `title:` +
> `slug:` (e.g. `<type>(<slug>): <title>`, reusing `complete`'s `--type`
> convention; default `feat`), forced to a single line and capped to a sane
> length. No agent text needed — pure runner synthesis from the slice file.
>
> HALF B (body, now unblocked): give `propose`-mode PRs a real body instead of `gh
> pr create --fill`'s empty description. Add an optional `body` to `OpenRequestInput`
> (`src/integrator.ts`); the GitHub provider (`src/github.ts`) passes `--body` when
> present (else today's `--fill`); the `none` provider includes it in its manual
> instructions. SOURCE (resolved): the agent's final summary from
> `LaunchResult.output` (the harness seam built by `harness-agent-output`), optionally
> under a runner-scaffolded header (slice pointer + PRD/ADR + diff stat). Body is
> advisory prose — no gate role. NOTE the SHARED provider seam with
> `review-gate-pr-comment` (which adds a follow-up `postComment`): keep the "write
> text to the PR" surface consistent, but body-at-open and comment-after are
> separate.
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
