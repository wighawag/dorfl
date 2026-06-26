---
title: strictMergeApproval config axis — opt-in re-surface of a merge-question on a changed merge-base (default OFF)
slug: strict-merge-approval-gate
prd: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: false
blockedBy: [merge-questions-gate-axis]
covers: [16]
---

## What to build

Add a NEW per-repo config axis `strictMergeApproval` (boolean, default
OFF) that controls the OPT-IN strictness layered on top of the OQ6
stale-approval default. Resolved through the SAME gate-family precedence
chain as the other gates (flag > env > per-repo > global > default).

This is the config carve-out of `apply-rung-merge-disposition`'s OQ6
answer, deliberately separated because adding a gate-family member is a
USER-VISIBLE config-axis decision (flag name, env name, default,
resolution chain, CLI plumbing) other tasks/CLI surfaces inherit — it
mirrors exactly how `merge-questions-gate-axis` carved out
`mergeQuestions` rather than improvising it inside the surfacer.

The POLICY is already fixed by the PRD (sidecar OQ6) and this task does
NOT reopen it:

- Default (OFF / `strictMergeApproval` not set): apply HONOURS the prior
  merge answer and lands when the rebased tip re-verifies GREEN, even if
  `main` moved (merge-base changed) since the human answered. A green
  re-verify is trusted as sufficient.
- ON (`strictMergeApproval` true): when the merge-base CHANGED between
  the human's answer and the apply step, apply RE-SURFACES the
  merge-question (clears the answer back to no-answer and re-authors the
  question on `main`/runner under the `advancing` lock — no branch-side
  mutation) instead of auto-landing, even on a green re-verify. This is
  the host-agnostic analogue of GitHub's "dismiss stale approvals when
  the base changes". Story #16's RED-re-verify refusal is UNCHANGED and
  independent of this flag.

This task provides the FLAG + RESOLVER + precedence wiring and exposes a
single resolved boolean the apply rung consults. The consumption (the
actual re-surface vs. land branch in the apply dispatch) lives in
`apply-rung-merge-disposition`, which reads this resolved value; until
this task lands, `apply-rung-merge-disposition` hard-codes the default
(OFF = no re-surface on merge-base change).

## Acceptance criteria

- [ ] New boolean axis `strictMergeApproval` resolved via the existing
      gate-family precedence helper (the same one extended by
      `merge-retries-gate-precedence` / `merge-questions-gate-axis`):
      flag > env > per-repo > global > default.
- [ ] Default is OFF (the cheap green-re-verify-is-enough path is the
      default; matches PRD sidecar OQ6).
- [ ] Flag + env names follow the existing gate-family vocabulary
      (`--strict-merge-approval` / the established env-name convention;
      pick consistent with siblings and state the chosen names in the
      done record).
- [ ] Does NOT alter `mergeQuestions` or `observationTriage` default or
      shape; this is a separate, independent axis.
- [ ] Exposes a single resolved boolean the apply rung consults; no
      policy logic (the re-surface vs. land branch) lives here.
- [ ] Tests cover every precedence rung and the default, in the style of
      the existing gate-precedence tests.
- [ ] Tests isolate global locations.
- [ ] Acceptance gate green.

## Blocked by

- `merge-questions-gate-axis` — extends the SAME gate-family precedence
  helper / config-resolution module; serialise by file to avoid
  conflicts.

## Prompt

> Read Story 16 + the PRD's Implementation Decision fixing the OQ6
> stale-approval policy (`strictMergeApproval`, per-repo, default OFF).
> Locate the gate-family precedence helper extended by
> `merge-questions-gate-axis` / `merge-retries-gate-precedence` and add
> the new boolean axis `strictMergeApproval` in the same shape and the
> same precedence chain (flag > env > per-repo > global > default),
> default OFF. Add the flag + env names consistent with the existing
> gate vocabulary and the CLI plumbing siblings use. Expose ONE resolved
> boolean; do NOT put the re-surface-vs-land policy branch here (that is
> `apply-rung-merge-disposition`'s consumer). Tests mirror the sibling
> gate-precedence tests in style. Run the AGENTS.md acceptance gate.

## Requeue 2026-06-26

stuck: acceptance gate exit 1 on rebased tip (18:42Z); kept work branch; requeued to retry from tip
