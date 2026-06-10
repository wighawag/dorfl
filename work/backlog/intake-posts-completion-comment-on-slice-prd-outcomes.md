---
title: intake-posts-completion-comment-on-slice-prd-outcomes — on a successful SLICE/PRD outcome, post an informational "slice created"/"prd created" comment on the issue (PR link or commit link), never closing it
slug: intake-posts-completion-comment-on-slice-prd-outcomes
prd: issue-intake
blockedBy: [slice-level-issue-field-for-lone-issue-derived-slice]
covers: [1, 6]
---

> Derives from the `issue-intake` PRD. Today intake "talks back" on the ASK and BOUNCE outcomes (it posts a comment) but is SILENT on the productive outcomes (SLICE / PRD), so the issue author gets a question or a rejection narrated to them but never a confirmation when intake actually did the useful thing. This closes that loop. The completion comment is INFORMATIONAL — it reports `slice created` / `prd created`, NEVER `issue resolved`; intake never closes the issue (closing is the future CI close-job's, `runner-in-ci`).

## What to build

On a SUCCESSFUL terminal outcome — `sliced` (a `work/backlog/<slug>.md` was created + integrated) or `prd` (a `work/prd/<slug>.md` was created + integrated) — post ONE informational comment back on the issue via the existing `postIssueComment` seam (runner-owned; the agent stays seam-free, the in-band boundary). The comment:

- says **what was created** — "Created slice `<slug>`" / "Created PRD `<slug>`" — framed as `slice created` / `prd created`, **never** "issue resolved/closed";
- links to the right place by INTEGRATION MODE (two variants):
  - **propose** → link the **PR** that carries the artifact (the PR URL the integrate core returns);
  - **merge** → link the **commit** the artifact landed in on `main` (the commit the integrate core returns);
- does NOT reference/link the PRD beyond naming the created PRD slug (maintainer: no need to link to PRD);
- is purely informational — it changes NO issue state (no close, no label beyond the transient processing lock that already exists).

Post the comment ONLY on `sliced` / `prd`. Do NOT post on `asked` / `bounced` (those already post their own comment), nor on `locked` / `lock-failed` / `stale` / `agent-failed` / `usage-error` (those are not "done").

The comment must not look like a user answer that would RESUME the ASK loop: check it against `intake-event-classification` (`src/intake-event.ts`) — a slice/prd outcome is terminal, but confirm the bot's own comment cannot re-trigger intake (e.g. an `issue-comment` event for intake's own completion comment must classify as `ignore`, like it does for intake's ask/bounce comments today).

The integrate core already computes the propose-vs-merge wording for the LOCAL `note` (`integrationToIntakeResult`: "opened a PR carrying it" / "landed it on the arbiter main") and has the PR url / commit in `core.integration` — reuse that same resolved result to build the issue comment rather than recomputing it.

## Acceptance criteria

- [ ] On a `sliced` outcome, an informational comment is posted on the issue naming the created slug and framed as "slice created" (NOT "resolved"), asserted at the stubbed issue seam.
- [ ] On a `prd` outcome, likewise for the PRD ("PRD created"); no PRD link beyond the slug.
- [ ] PROPOSE mode → the comment links the PR; MERGE mode → the comment links the commit. Two distinct messages, both tested.
- [ ] No comment is posted on `asked` / `bounced` / `locked` / `lock-failed` / `stale` / `agent-failed` / `usage-error` (tested for at least the non-success success-adjacent ones, e.g. `locked`).
- [ ] The comment NEVER closes the issue or changes issue state (informational only); intake still never calls any close path.
- [ ] The completion comment cannot resume the ASK loop (classified `ignore` by `intake-event-classification`), with a test pinning it.
- [ ] The comment poster DEGRADES (a missing/unauthenticated `gh` surfaces the text, never throws) — same advisory discipline as the ask/bounce poster; a degrade does not change the run's success outcome.
- [ ] Tests STUB the issue seam (no network); mirror the existing intake tests.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `slice-level-issue-field-for-lone-issue-derived-slice` — the completion comment must reflect the SETTLED closure model (it says "slice/prd created", and must not imply `Fixes #N`/auto-close). Build the field/closure correction first so this slice's wording and the underlying linkage agree.

## Prompt

> Make intake post an INFORMATIONAL completion comment on the issue for the SUCCESSFUL outcomes (`sliced` / `prd`), closing the loop the ASK/BOUNCE comments already close for the other outcomes. PRD: `work/prd-sliced/issue-intake.md`. The comment reports `slice created` / `prd created` — NEVER `issue resolved`; intake never closes the issue (that is the future CI close-job's job).
>
> DRIFT CHECK FIRST: confirm intake posts NO comment on the slice/prd success paths today (only the `note`/stdout + GitHub's own cross-reference). Confirm the blocking slice `slice-level-issue-field-for-lone-issue-derived-slice` has landed (lone slice carries `issue:`, no `Fixes #N`) — the comment wording depends on it. If intake already posts a completion comment, this slice is done.
>
> WHAT TO BUILD: in `dispatchSlice` / `dispatchPrd` (or right after, where the terminal `IntakeResult` is built), post ONE comment via `postIssueComment` on success: name the created slug, frame as created (not resolved), and link the PR (propose) or the commit (merge) using the resolved integrate result the local `note` already uses. No PRD link beyond the slug. The RUNNER posts it; the agent stays seam-free.
>
> SCOPE FENCE: comment ONLY on `sliced` / `prd`. Informational only — no close, no state change, no new label. Do NOT build the CI close-job. Confirm the bot's own comment classifies as `ignore` in `intake-event-classification` so it cannot resume the ASK loop.
>
> SEAM TO TEST AT: the stubbed issue seam (`postIssueComment` recorded). Assert: a comment on slice success (created wording, slug, PR link in propose); the merge variant (commit link); NO comment on `locked`/`asked`/`bounced`; degrade on a missing `gh` does not change the success outcome; the comment is `ignore`d by event-classification.
>
> "Done" = intake confirms `slice created`/`prd created` on the issue with the right PR/commit link, never closes the issue, cannot resume its own loop, and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
