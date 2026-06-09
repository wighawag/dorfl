---
title: propose-mode PR title + body — a short title and the agent's summary, not gh --fill's run-on subject + empty description
slug: propose-pr-body
blockedBy: []
covers: []
---

> **`needsAnswers` CLEARED 2026-06-06** — Half B's open questions are resolved (see "Open questions" below, now answered): the body is the AGENT'S final summary, captured via the harness seam's `LaunchResult.output` (built by `harness-agent-output`, PR #12) — the exact hand-off channel Q1/Q2 needed. Q3: human `complete --propose` MAY pass a `--message`-style body too (same optional `body` field), but that is a thin add, not required for the autonomous path.

## What to build

> Self-contained feature against the integration seam — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Spotted in real use: PR #1 opened with an EMPTY body (the spawning observation has since been deleted, its signal captured here); and PR #6 opened with a **multi-line run-on title** (the whole commit subject `feat(...): ... ; --reset ... ; --message ... ; done`).

Give `propose`-mode PRs **both a short, single-line title AND a real description**, instead of `gh pr create --fill`'s commit-subject-derived title + empty body.

**Two independent halves — and the title half is answerable NOW (no `needsAnswers` dependency); the body half is what the open questions below gate:**

### Half A — TITLE (runner-synthesised; answerable now, no open question)

Today `--fill` makes the PR title the first line of the build-agent's commit subject, which is an unbounded run-on sentence (PR #6: a four-clause title ending `; done`). Instead, synthesise a short, single-line title from data the runner ALREADY has — no agent text needed:

- Source: the slice file's frontmatter `title:` (human-authored, already concise) and `slug:`. Compose e.g. `<type>(<slug>): <slice title>` (reuse the same `--type` convention `complete` already supports; default `feat`).
- ENFORCE a single line + a sane length cap (e.g. ≤ ~72 chars, truncate with `…`), so it can never be multi-line again regardless of the source.
- This stops relying on `--fill` for the title: pass `--title <synthesised>` explicitly. (A PRD-derived slice could prefer the PRD title; a `covers: []` chore uses its own slice title — both live in frontmatter.)

This half is the immediate pain (felt live on PR #6) and depends on NONE of the open questions below — it is pure runner-side synthesis from the slice file.

### Half B — BODY (the open-question half)

Give `propose`-mode PRs a real **description** instead of an empty body. Today the GitHub provider runs `gh pr create ... --fill` (derives title/body from commit subjects → title-only, empty body). A reviewer landing on a multi-file PR gets no summary, no decisions, no pointer to the slice spec.

- **Add an optional `body` (and `title`) to the provider seam — AND thread it end-to-end (call chain VERIFIED 2026-06-07 against the real code; the chain is TWO layers longer than the original note claimed):** `OpenRequestInput` (`src/integrator.ts`) gains optional `body`/`title`; the GitHub provider (`src/github.ts`) passes them as `gh pr create --title <t> --body <body>` (instead of `--fill` when present); the `none` provider includes them in its manual-instruction output; no behaviour change when absent (degrades to today's `--fill`). The full thread is: `do.ts (captures the build agent's LaunchResult.output)` → `CompleteOptions` (NEW `body` field) → `performComplete` → `ledgerWrite.applyCompleteTransition(ApplyCompleteTransitionInput)` (NEW `body`) → `Integrator.integrate(IntegrateInput)` (NEW `body`) → `provider.openRequest(OpenRequestInput)` (NEW `body`) → `gh`. Note the seam goes THROUGH `ledger-write.ts`'s `applyCompleteTransition`, not directly `complete.ts`→`integrator.ts` — so `ApplyCompleteTransitionInput` gains the field too.
- **Source (RESOLVED) — BUT the SOURCE does NOT live in `complete.ts` (original note was WRONG; corrected 2026-06-07):** the agent's FINAL SUMMARY is `LaunchResult.output` (`harness-agent-output`, PR #12), and it is produced in `do.ts`'s `runDoAgent` — which TODAY DISCARDS it (`return {ok: launched.ok, detail: launched.detail}` drops `launched.output`). So Half B has a REAL, implementer-blocking prerequisite the original slice glossed: (a) `runDoAgent` must RETURN `launched.output`; (b) the injectable `DoAgentRunner` seam (`do.ts`, today `=> {ok, detail}`) must gain an optional `output` so the test-injected agent can supply a body too; (c) `do.ts` must capture it and pass it into `performComplete` via the NEW `CompleteOptions.body`. `complete.ts` never sees `LaunchResult` on its own — it only gets the body if `do.ts` hands it over. The runner MAY wrap it under a deterministic header (slice pointer + PRD/ADR + diff stat).
- **The body should carry:** a short summary of what was built, key decisions/deviations worth a reviewer's attention, a pointer back to the slice file (`work/done/<slug>.md`) + the PRD/ADR it serves, and optionally any "please check X" the agent was unsure about (a lightweight in-PR echo of needs-attention surfacing).
- **Shared seam note:** the optional `body` on `OpenRequestInput` (added here) and the PR-COMMENT capability `review-gate-pr-comment` adds are BOTH "write text to the PR" on the provider seam. This slice adds the **creation body** (`--body` at PR open); `review-gate-pr-comment` adds a **follow-up comment** (`postComment` on the opened PR). Design them consistently — same provider, same graceful-degradation discipline — but they are separate fields/methods (body at open vs comment after).
- The body is **advisory prose** — it gates nothing (no trust-boundary role), so a model-authored body is fine (unlike the `verify` gate).

## Open questions — RESOLVED 2026-06-06 (were Half B gates; now answered)

> Half A (the title) was always decided. Half B's questions are now resolved by the `harness-agent-output` seam (PR #12), which built the exact hand-off channel Q1/Q2 needed.

1. **Source of the body — RESOLVED: AGENT-EMITTED (hybrid-friendly).** The body is the build agent's FINAL SUMMARY, captured via the harness seam's `LaunchResult.output` (the last assistant message — built by `harness-agent-output`). The runner MAY scaffold a deterministic header (slice-pointer `work/done/<slug>.md` + the PRD/ADR it serves + diff stat) and append the agent's `output` summary as the prose — the hybrid the question floated, now cheap because the channel exists. No new "final summary" channel is needed; reuse `LaunchResult.output`.
2. **Hand-off channel — RESOLVED: `LaunchResult.output`, BUT it is produced in `do.ts`, not `complete.ts` (corrected 2026-06-07).** The harness returns the agent's final assistant message on `LaunchResult.output`; `do.ts`'s `runDoAgent` is the ONLY place that holds the build agent's `LaunchResult`, and it currently DROPS `output` (returns only `{ok, detail}`). To carry a live body, `runDoAgent` (and the `DoAgentRunner` injectable seam) must surface `output`, and `do.ts` must thread it into `performComplete`. The agent does NO git; the runner reads `output` and composes the PR body. No transient-path convention needed.
3. **Human `complete --propose` — RESOLVED: YES, optionally, via a NEW flag.** The same optional `body` field on `CompleteOptions` applies. NOTE (verified 2026-06-07): the existing `complete --message`/`flags.message` is the COMMIT-summary, threaded to `options.message` and used for the commit, NOT a PR body — so a human PR body needs a DISTINCT field/flag (e.g. `--body`), it can NOT reuse `--message`. Thin add (the underlying `body` field exists for the autonomous path); not required to ship the autonomous body, but in scope so the two paths share one mechanism.

## Acceptance criteria

> Half A (title) is final; Half B (body) is provisional — finalise when the open questions are resolved.

- [ ] **(Half A — title)** the GitHub provider passes an explicit single-line `--title` synthesised from the slice's frontmatter `title:` + `slug:` (e.g. `<type>(<slug>): <title>`), capped to one line ≤ a sane length, instead of letting `--fill` derive a multi-line title from the commit subject. A test proves a long/multi-line source yields a single capped line, and that the `none` provider's manual instruction shows the same title.
- [ ] **(Half B — body)** `OpenRequestInput` carries an optional `body`; the GitHub provider passes it via `gh pr create --body` (and only falls back to `--fill` when absent); the `none` provider surfaces it in its manual instructions.
- [ ] **(Half B — wiring)** the optional `body` is threaded through the WHOLE chain verified to exist: `CompleteOptions.body` → `performComplete` → `ApplyCompleteTransitionInput.body` (`ledger-write.ts`) → `IntegrateInput.body` (`integrator.ts`) → `OpenRequestInput.body`. Absent at every hop ⇒ today's behaviour (no regression).
- [ ] **(Half B — source capture)** `do.ts`'s `runDoAgent` RETURNS the build agent's `LaunchResult.output` (today it drops it), the `DoAgentRunner` injectable seam gains an optional `output` (so a test agent can supply a body), and `do.ts` passes it into `performComplete` as `body`. A test proves a stubbed agent's `output` reaches the (stubbed) provider's body on the `do` propose path.
- [ ] The resolved body includes a summary + a pointer to `work/done/<slug>.md`; absent body ⇒ today's behaviour (no regression).
- [ ] Tests (stubbed provider): a PR opened with a body passes it through; absent body degrades cleanly; the GitHub adapter builds the right `gh` args.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None for the code. (`needsAnswers` is now CLEARED — Q1–Q3 resolved.) Half B reads the agent summary from `LaunchResult.output`, which `harness-agent-output` (PR #12) built — so for the live agent body to be non-empty, that must be merged first (it is, on `main`). NOTE (verified 2026-06-07): although `LaunchResult.output` exists, `do.ts`'s `runDoAgent` currently DISCARDS it; Half B's source-capture criterion above is part of THIS slice (no extra blocker, but real work). Half A (title) depends on nothing.

## Prompt

> NOTE: `needsAnswers` is CLEARED (2026-06-06) — both halves are buildable. Body SOURCE is RESOLVED: the agent's final summary via `LaunchResult.output` (`harness-agent-output`, PR #12); human `complete --propose` may pass a body too.
>
> HALF A (title, decided): stop letting `gh pr create --fill` set the title from the commit subject (PR #6 got a 4-clause run-on title ending `; done`). Pass an explicit `--title` synthesised runner-side from the slice frontmatter `title:` + `slug:` (e.g. `<type>(<slug>): <title>`, reusing `complete`'s `--type` convention; default `feat`), forced to a single line and capped to a sane length. No agent text needed — pure runner synthesis from the slice file.
>
> HALF B (body, now unblocked): give `propose`-mode PRs a real body instead of `gh pr create --fill`'s empty description. Add an optional `body` and thread it the WHOLE chain (VERIFIED 2026-06-07): `do.ts` captures the build agent's `LaunchResult.output` (TODAY `runDoAgent` DROPS it — make it return `output`, and add `output` to the `DoAgentRunner` seam) → `CompleteOptions.body` → `performComplete` → `ApplyCompleteTransitionInput.body` (`src/ledger-write.ts`) → `IntegrateInput.body` (`src/integrator.ts`) → `OpenRequestInput.body` → the GitHub provider (`src/github.ts`) passes `--body` when present (else today's `--fill`); the `none` provider includes it in its manual instructions. SOURCE (resolved): the agent's final summary from `LaunchResult.output`, optionally under a runner-scaffolded header (slice pointer + PRD/ADR + diff stat). Body is advisory prose — no gate role. The human `complete` body (Q3) needs a NEW flag (NOT `--message`, which is the commit summary). NOTE the SHARED provider seam with `review-gate-pr-comment` (which adds a follow-up `postComment`): keep the "write text to the PR" surface consistent, but body-at-open and comment-after are separate.
>
> READ FIRST: `src/integrator.ts` (`ReviewProvider.openRequest` / `OpenRequestInput`, AND `IntegrateInput` — the body must thread through both); `src/github.ts` (the `gh pr create --fill` call to extend); `src/ledger-write.ts` (`ApplyCompleteTransitionInput` / `applyCompleteTransition` — the seam the body passes THROUGH, between `complete.ts` and `integrator.ts`); `src/complete.ts` (`CompleteOptions` + the `applyCompleteTransition` call); `src/do.ts` (`runDoAgent` — which DROPS `launched.output` today — and the `DoAgentRunner` seam + the `performComplete` call); `src/harness.ts` (`LaunchResult.output`, the source channel); `docs/adr/execution-substrate-decisions.md` §6 (the integration seam).
>
> TDD with vitest, house style (stubbed provider): body passed through to `gh` args; absent body = no regression; `none` provider surfaces it. "Done" = acceptance criteria met and the gate green.

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
