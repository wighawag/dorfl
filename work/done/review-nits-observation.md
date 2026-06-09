---
title: review-nits-observation — on approve-with-non-blocking-findings, the runner writes ONE per-run observation (works on all paths incl. --merge)
slug: review-nits-observation
prd: review
blockedBy: []
covers: [2]
---

## What to build

Give the review gate's **non-blocking findings a durable, contract-native home** on an APPROVE. Today (verified 2026-06-07, post-convergence) the runner routes BLOCKING findings to `needs-attention/` but DROPS non-blocking ones on approve — they survive only in the terminal/session log and evaporate (PR #14's gate raised 2 real nits with nowhere to go; PR #17/#18's gates raised more). See `work/findings/review-nonblocking-findings-disposition.md`.

> **DRIFT UPDATE 2026-06-07 — the target layer MOVED (verified).** This slice was written against `complete.ts`'s review/approve block. The run/do convergence (PR #17 `extract-integration-core` + #18 `run-through-integration-core`) MOVED the whole gate→review→done-move→`git add -A` band into `src/integration-core.ts` (`performIntegration`), and BOTH `do`/`complete` AND `run` now call it. So the write belongs in `integration-core.ts`'s approve fall-through, NOT `complete.ts`. This is a WIN: putting it in the shared core makes the slice's "works on ALL paths incl. --merge" promise STRUCTURALLY true (it now covers `run`/the fleet for free, which a `complete.ts`-only write would have missed).

On a review **approve that carries ≥1 non-blocking finding**, the runner writes **ONE observation file for that run**:

```
work/observations/review-nits-<slug>-<YYYY-MM-DD>.md
```

containing that run's non-blocking findings (all of them, in the one file — NOT one file per nit). This complements `review-gate-pr-comment` (which posts the verbatim review to the PR, propose-path only): the OBSERVATION works on **all** paths — `--merge`, propose, CI — so the nits survive even when there is no PR.

### Why this shape (decisions — do not relitigate; from the finding)

- **The RUNNER writes it, not the review agent.** The reviewer emits a verdict and must not write (the review-skill contract); the runner (deterministic code in `integration-core.ts`'s `performIntegration` — post-convergence) already holds the parsed `findings[]` (`lastVerdict.findings`) and is the writer (it already writes the block case via `applyNeedsAttentionTransition`). New behaviour: the runner currently writes only `needs-attention/`; this adds an `observations/` write.
- **ONE file per RUN** (content-derived slug `review-nits-<slug>-<date>`), NOT one per nit (no file explosion), NOT one shared append-only ledger (a shared mutable file violates the contract's one-file-per-item / no-shared-index rule and would race on parallel `--merge`/CI runs).
- **Date in the filename** is deliberate lifecycle hygiene: if the PR is later CLOSED/abandoned, the matching observation is trivially findable + deletable — you do not have to remember a stray nit-observation was recorded. (`<slug>-<date>` ties it to the run.)
- **No empty observations:** an approve with ZERO non-blocking findings writes NOTHING. A BLOCK still goes to `needs-attention/` (unchanged) — this is ONLY for the approve-with-non-blocking-findings case that currently evaporates.
- **Git ownership — SIMPLER than the needs-attention path (call sites VERIFIED 2026-06-07, post-convergence):** the approve case does NOT need its own commit/move machinery. After an approve, `performIntegration` (`src/integration-core.ts`) continues to the done-move + the ONE ATOMIC `git add -A` commit (it stages the agent's work + the `git mv` source→done together — steps 2 and 3 in the core). So the observation just needs to be WRITTEN to `work/observations/<…>.md` on disk INSIDE the approve fall-through (where `lastVerdict.findings` is in scope), BEFORE the `git mv` / `git add -A`, and it is swept into the SAME done-commit automatically — on EVERY path (merge / propose / CI, `do` AND `run`), with no separate commit, no separate push, and no surface-on-main step. This is the in-band discipline, but it is NOT the `applyNeedsAttentionTransition` move pattern (that helper does its own `git mv` + commit + autonomous surface, which is the WRONG, heavier model here — do NOT reuse it for the write). The block path keeps using `applyNeedsAttentionTransition` unchanged; only the approve path adds this plain pre-commit file write.

### Observation file content

Frontmatter (matching the `observations/` convention): `title`, `date`, `status: open`, plus a pointer to the slug + PR/run it came from. Body: the non-blocking findings (each `question` + `context`), and a one-line note that these are review-gate non-blocking nits for triage (promote-to-slice / keep / delete via batch-qa). Mirror the existing `work/observations/*.md` shape so batch-qa triages it like any other observation.

### Scope fence

- IN: on approve-with-non-blocking-findings, the runner writes one per-run `work/observations/review-nits-<slug>-<date>.md` (the findings + frontmatter); committed per the path's git ownership; works on all paths; no file when no nits.
- OUT: the PR comment (that is `review-gate-pr-comment`); changing the BLOCK path (`needs-attention/` unchanged); the review VERDICT/routing/gate decision (unchanged — this is post-decision capture only); auto-deletion on PR close (documented as a human/lifecycle action via the dated filename, not built here).

## Acceptance criteria

- [ ] On a review APPROVE with ≥1 non-blocking finding, the runner writes exactly ONE `work/observations/review-nits-<slug>-<YYYY-MM-DD>.md` containing all of that run's non-blocking findings (question + context each), with `observations/`-convention frontmatter (incl. a pointer to the slug/run).
- [ ] An approve with ZERO non-blocking findings writes NO observation (no empty files).
- [ ] A BLOCK is unchanged — findings still go to `needs-attention/`; no review-nits observation is written for a block.
- [ ] The file is one-per-RUN (not per-nit) and is NOT an append to any shared file; the dated, content-derived name avoids collisions across runs.
- [ ] Git ownership: the observation is written to disk INSIDE `performIntegration` (`src/integration-core.ts`) approve fall-through, BEFORE the core's done-move + atomic `git add -A` commit, so it is swept into that SAME done-commit on every path (merge / propose / CI, `do` AND `run`) — NOT via `applyNeedsAttentionTransition` (no separate commit/move/surface). It is never left uncommitted/dangling.
- [ ] The review VERDICT, routing (approve→integrate / block→needs-attention), and gate decision are UNCHANGED (this is post-decision capture only; assert the decision is identical with and without the observation write).
- [ ] Works on ALL integration paths (merge / propose / CI) AND both callers (`do` AND `run`) — since the write lives in the shared `integration-core.ts`. A test exercises the merge path (no PR) and asserts the observation lands; a `run` path test (or a core-level test) asserts the fleet path also writes it.
- [ ] Tests (stubbed review agent returning an approve + non-blocking findings): observation written with the right name + content; zero-nit approve writes nothing; block writes none. No real model/network.
- [ ] **Test isolation:** observation writes go to a temp work tree; the real `~/.agent-runner/` + `~/.pi/agent/sessions/` are UNTOUCHED.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — builds on the merged review gate (#11/#12) + the run/do convergence (#17/#18), which produces the parsed `findings[]` (`lastVerdict.findings`) in `integration-core.ts`'s `performIntegration` (NOT `complete.ts` anymore — see the drift update). Independent of `review-gate-pr-comment` (complementary sink; different path-coverage). (`review` flag/key, post-PR-#13 rename — `review`, not `reviewPr`.)

## Prompt

> Give the review gate's NON-BLOCKING findings a durable home: on an APPROVE that carries ≥1 non-blocking finding, the RUNNER writes ONE per-run observation `work/observations/review-nits-<slug>-<YYYY-MM-DD>.md`. Today (verified) the runner routes BLOCKING findings to needs-attention/ but DROPS non-blocking ones on approve — they evaporate. This works on ALL paths (merge/propose/CI), unlike the PR comment (`review-gate-pr-comment`, propose-only). See `work/findings/review-nonblocking-findings-disposition.md`.
>
> FIRST run the drift check: the review/approve band MOVED in the run/do convergence (#17/#18) from `complete.ts` into `src/integration-core.ts` (`performIntegration`) — confirm THAT is where the `review` block parses `lastVerdict` with `findings[]` carrying `severity: 'blocking' | 'non-blocking'` (`review-gate.ts`), that the APPROVE fall-through currently does nothing with non-blocking findings, that the done-move (`git mv`, step 2) + atomic `git add -A` commit (step 3) follow it in the core, and that the BLOCK path uses `applyNeedsAttentionTransition` (`ledger-write.ts`). Write the observation INSIDE the approve fall-through (where `lastVerdict.findings` is in scope), BEFORE the core's `git mv`/`git add -A`, so the existing atomic done-commit sweeps it in — do NOT use `applyNeedsAttentionTransition`'s heavier move/commit/surface for the write. Confirm the recent `work/observations/*.md` YAML frontmatter shape (`title`/`date`/`status: open`) to match. Route to needs-attention on any real discrepancy.
>
> Implement: after an approve, if the parsed verdict has ≥1 non-blocking finding, the runner writes one `work/observations/review-nits-<slug>-<date>.md` (all of the run's non-blocking findings + observations-convention frontmatter incl. a slug/run pointer). WRITE it BEFORE the done-move + atomic `git add -A` commit so it is swept into the SAME done-commit on every path (merge/propose/CI) — do NOT use `applyNeedsAttentionTransition` for the write (that is the block path's heavier move/commit/surface pattern). ZERO non-blocking findings → write nothing. BLOCK → unchanged (needs-attention/). Change NO verdict/routing/gate logic — post-decision capture only. The review agent does NOT write — the runner does.
>
> READ FIRST: `src/integration-core.ts` (`performIntegration` — the `review`/approve block, the done-move step 2 + `git add -A` step 3 it sweeps into; THIS is where the write goes, shared by `do` AND `run`); `src/review-gate.ts` (`ReviewVerdict`/ `ReviewFinding`, `severity`); `src/ledger-write.ts` (`applyNeedsAttentionTransition` — the BLOCK-path precedent, NOT the model for the approve write); an existing `work/observations/*.md` (the frontmatter/shape to match); `work/findings/review-nonblocking-findings-disposition.md` (the decisions).
>
> TDD with vitest, house style (stub the review agent's approve+findings, temp work tree, isolatePiAgentDir): approve-with-nits writes one correctly-named observation with the findings; zero-nit approve writes nothing; block writes none; the merge path (no PR) still lands the observation; the gate decision is identical with/ without the write; real ~/.agent-runner + ~/.pi/agent/sessions untouched. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim review-nits-observation --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/review-nits-observation <remote>/main
git mv work/in-progress/review-nits-observation.md work/done/review-nits-observation.md
```
