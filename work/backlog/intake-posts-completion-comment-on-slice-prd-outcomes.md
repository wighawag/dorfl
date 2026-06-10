---
title: intake-posts-completion-comment-on-slice-prd-outcomes — on a successful SLICE/PRD outcome, post an informational "slice created"/"prd created" comment on the issue (PR link or commit link), never closing it
slug: intake-posts-completion-comment-on-slice-prd-outcomes
prd: issue-intake
blockedBy:
  - slice-level-issue-field-for-lone-issue-derived-slice
  - intake-self-awareness-resumption-tracking
covers: [1]
---

> Derives from the `issue-intake` PRD. Today intake "talks back" on the ASK and BOUNCE outcomes (it posts a comment) but is SILENT on the productive outcomes (SLICE / PRD), so the issue author gets a question or a rejection narrated to them but never a confirmation when intake actually did the useful thing. This closes that loop. The completion comment is INFORMATIONAL — it reports `slice created` / `prd created`, NEVER `issue resolved`; intake does NOT close the issue ON THE SLICE/PRD PATH (the future CI close-job closes those via the `issue:` field). (Intake DOES close on BOUNCE — that is the sibling slice `intake-closes-issue-on-bounce` — but the slice/prd completion comment here is purely informational and never closes.)

## What to build

On a SUCCESSFUL terminal outcome — `sliced` (a `work/backlog/<slug>.md` was created + integrated) or `prd` (a `work/prd/<slug>.md` was created + integrated) — post ONE informational comment back on the issue via the existing `postIssueComment` seam (runner-owned; the agent stays seam-free, the in-band boundary). The comment:

- says **what was created** — "Created slice `<slug>`" / "Created PRD `<slug>`" — framed as `slice created` / `prd created`, **never** "issue resolved/closed";
- links to the right place by INTEGRATION MODE (two variants):
  - **propose** → link the **PR** that carries the artifact (the PR URL the integrate core already returns: `IntegrateResult.url`);
  - **merge** → link the **commit** the artifact landed in on `main`. NOTE (verified 2026-06-10): `IntegrateResult` (`integrator.ts`) today carries `mode` / `mergedToMain` / `url?` but NO commit SHA. So this slice must EXTEND `IntegrateResult` (+ the integrator's merge branch + `IntegrationCoreResult.integration`) to surface the landed commit SHA. This touches the SHARED integrate seam used by `do`/`run`/`complete` — acknowledged added scope; keep it additive (a new optional `commit?` field), so existing callers are unaffected.
- does NOT reference/link the PRD beyond naming the created PRD slug (maintainer: no need to link to PRD);
- is purely informational — it changes NO issue state (no close on the slice/prd path, no label beyond the transient processing lock that already exists; bounce-closing is the separate `intake-closes-issue-on-bounce` slice, not this one);
- carries the intake MARKER (from `intake-self-awareness-resumption-tracking`), using that slice's SHARED stamp helper so the FULL grammar is produced: `<!-- ${brand.base}:intake kind=created slug=<slug> seen=<id>,… -->` (today `agent-runner:intake`; namespace from `brand.base`; `seen=` = the comment ids this intake run READ — the per-run delta the chain model requires). `kind=created` is TERMINAL, so the triage's `already-terminal` branch then treats the issue as already-transformed; intake never re-triggers on its own completion comment.

Post the comment ONLY on `sliced` / `prd`. Do NOT post on `asked` / `bounced` (those already post their own comment), nor on `locked` / `lock-failed` / `stale` / `agent-failed` / `usage-error` (those are not "done").

SELF-TRIGGER SAFETY: the completion comment is a new thread comment like any other. It does NOT re-trigger intake because the BLOCKING slice `intake-self-awareness-resumption-tracking`'s TRIAGE GATE sees the `kind=created` (terminal) marker and SKIPS via `already-terminal` (and, when intake's marker is the last comment with nothing unseen, via `no-new-input`). There is NO `classifyIntakeEvent` self-filter (that classifier is deliberately `{kind}`-only — the triage gate is the whole safety mechanism). This slice's only job is to STAMP the completion comment with the FULL marker (incl. `seen=`) via the shared helper, so the triage recognises it.

The integrate core already computes the propose-vs-merge wording for the LOCAL `note` (`integrationToIntakeResult`: "opened a PR carrying it" / "landed it on the arbiter main") and has the PR url in `core.integration` (the commit comes from the new `commit?` field this slice adds) — reuse that same resolved result to build the issue comment rather than recomputing it.

## Acceptance criteria

- [ ] On a `sliced` outcome, an informational comment is posted on the issue naming the created slug and framed as "slice created" (NOT "resolved"), asserted at the stubbed issue seam.
- [ ] On a `prd` outcome, likewise for the PRD ("PRD created"); no PRD link beyond the slug.
- [ ] `IntegrateResult` gains an additive optional `commit?` (the landed commit SHA), populated on the MERGE (`mergedToMain`) path; threaded through `IntegrationCoreResult.integration`. Existing `do`/`run`/`complete` callers are unaffected (additive field). A test pins it is populated in merge mode.
- [ ] PROPOSE mode → the comment links the PR (`url`); MERGE mode → the comment links the commit (`commit`). Two distinct messages, both tested.
- [ ] No comment is posted on `asked` / `bounced` / `locked` / `lock-failed` / `stale` / `agent-failed` / `usage-error` (tested for at least the non-success success-adjacent ones, e.g. `locked`).
- [ ] The slice/prd completion comment NEVER closes the issue or changes issue state (informational only) — the close-on-bounce path (sibling slice) is NOT reachable from slice/prd; a test confirms no close happens on `sliced`/`prd`.
- [ ] The completion comment carries the FULL intake marker (`kind=created slug=<slug> seen=<id>,…`, via the blocking slice's shared stamp helper), and a test confirms the triage SKIPS (`already-terminal`) on a thread carrying it — so the completion comment cannot re-trigger intake. (No `classifyIntakeEvent` involvement — the triage gate is the guard.)
- [ ] The comment poster DEGRADES (a missing/unauthenticated `gh` surfaces the text, never throws) — same advisory discipline as the ask/bounce poster; a degrade does not change the run's success outcome.
- [ ] Tests STUB the issue seam (no network); mirror the existing intake tests.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `slice-level-issue-field-for-lone-issue-derived-slice` — the completion comment must reflect the SETTLED closure model (it says "slice/prd created", and must not imply `Fixes #N`/auto-close). Build the field/closure correction first so this slice's wording and the underlying linkage agree.
- `intake-self-awareness-resumption-tracking` — provides the intake MARKER (incl. `seen=`), the shared stamp helper, and the TRIAGE GATE. WITHOUT it, this completion comment (a new thread comment) would re-trigger intake. This slice only STAMPS the completion comment with the `created` marker via that helper; the triage gate's `already-terminal` branch is what makes it non-triggering.

## Prompt

> Make intake post an INFORMATIONAL completion comment on the issue for the SUCCESSFUL outcomes (`sliced` / `prd`), closing the loop the ASK/BOUNCE comments already close for the other outcomes. PRD: `work/prd-sliced/issue-intake.md`. The comment reports `slice created` / `prd created` — NEVER `issue resolved`; intake never closes the issue (that is the future CI close-job's job).
>
> DRIFT CHECK FIRST: confirm intake posts NO comment on the slice/prd success paths today (only the `note`/stdout + GitHub's own cross-reference). Confirm the blocking slice `slice-level-issue-field-for-lone-issue-derived-slice` has landed (lone slice carries `issue:`, no `Fixes #N`) — the comment wording depends on it. If intake already posts a completion comment, this slice is done.
>
> WHAT TO BUILD: (a) EXTEND `IntegrateResult` with an additive optional `commit?` (the landed SHA), populate it on the merge path, thread it through `IntegrationCoreResult.integration` — keep it additive so `do`/`run`/`complete` are unaffected; (b) in `dispatchSlice` / `dispatchPrd` (or right after, where the terminal `IntakeResult` is built), post ONE comment via `postIssueComment` on success: name the created slug, frame as created (not resolved), and link the PR (`url`, propose) or the commit (`commit`, merge). No PRD link beyond the slug. The RUNNER posts it; the agent stays seam-free.
>
> SCOPE FENCE: comment ONLY on `sliced` / `prd`. Informational only — no close, no state change, no new label. Do NOT build the CI close-job. Do NOT build the triage gate here — it is the BLOCKING slice; here you only STAMP the completion comment with that slice's FULL `created` marker (incl. `seen=`) via its shared helper, so the triage's `already-terminal` branch recognises it. Do NOT touch `classifyIntakeEvent`.
>
> SEAM TO TEST AT: the stubbed issue seam (`postIssueComment` recorded) + `IntegrateResult.commit` populated on the merge path. Assert: a comment on slice success (created wording, slug, FULL marker incl. `seen=` present, PR link in propose); the merge variant (commit link from the new `commit` field); NO comment on `locked`/`asked`/`bounced`; degrade on a missing `gh` does not change the success outcome; the triage SKIPS (`already-terminal`) on a thread carrying the completion marker.
>
> "Done" = intake confirms `slice created`/`prd created` on the issue with the right PR/commit link, never closes the issue, cannot resume its own loop, and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
