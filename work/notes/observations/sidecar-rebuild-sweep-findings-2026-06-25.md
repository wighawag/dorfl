---
title: sidecar rebuild sweep (delete-then-surface) findings and drift catalogue
date: 2026-06-25
status: spotted
needsAnswers: false
---

## What was done

After the PRD `agentic-question-resolution-retire-disposition-vocabulary` merged
(7 tasks, all in `work/tasks/done/`), the question sidecars under
`work/questions/` still carried the now-retired `disposition=` field token in
their per-entry comments. Rather than scrub the field, every stale sidecar was
DELETED and the advance surface rung was driven to REBUILD it fresh in the new
binary (`no-answer | answered`) format, re-grounded against current code. This
both cleans the data and was a real end-to-end exercise of the newly-shipped
surface system.

Mechanism (for the record): a question sidecar is identity-keyed to its source
item; the source body carries `needsAnswers: true`. The classifier treats
`needsAnswers:true` + NO sidecar as the trigger to regenerate the sidecar (a
fresh-context surface agent investigates the item against current code and emits
questions; the engine persists them). So deleting ONLY the sidecar (leaving the
source body's `needsAnswers: true` intact) is the correct rebuild trigger. The
invariant `needsAnswers:false <=> no active sidecar` was never violated.

Work was driven from a scratch git worktree off `origin/main`; the human's
working checkout was never touched. Each delete was an append-only commit pushed
to `main` with committer `wighawag <wighawag@gmail.com>`; the surface rebuilds
were authored by the surface agent (`wighawag` / the CI `dorfl[bot]`).

## Outcome counts

- Sidecars in scope: 64 (the live `work/questions/` set minus the two canaries
  `observation-cli-autopick-pool-keyword-still-slice` and
  `task-apply-rung-merge-disposition`, already done earlier).
- Rebuilt cleanly in the new binary format: 64 / 64. Verified by reading the
  bytes on `origin/main`: every sidecar's per-entry comment is now
  `<!-- qN fields: id=qN -->` with ZERO `disposition=` field tokens
  (a sweep over all 64 returned `stale-field-token=0`). Total questions
  surfaced across the set: 146.
- Orphans (source item gone, sidecar would vanish with nothing to re-surface):
  0. All 64 sources were re-verified present on `main` at delete time.
- Invariant violations: 0.
- Transient hiccups, all self-resolved (NOT counted against the 64):
  - 2 surface-tick JSON/harness flakes (`review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23`,
    `transient-infra-failure-indistinguishable-from-genuine-stuck-state`):
    the delete had landed, the rebuild flaked, the item was left
    `needsAnswers:true` + no sidecar (self-healing); a later CI `dorfl[bot]`
    tick rebuilt both cleanly. Confirmed clean binary on `main`.
  - 2 push failures from a transient network blip (`No route to host` on
    github.com:22), NOT non-fast-forward rejections:
    `review-nits-fix-scan-json-brief-pool-jq-and-close-job-via-2026-06-23`
    (retried by hand: delete pushed + surfaced clean) and
    `review-nits-land-time-reverify-and-parallel-merge-ceiling-2026-06-22`
    (the CI bot had already surfaced it into clean binary format, so no stale
    sidecar remained to delete; confirmed clean).

So: 64/64 now clean binary, 0 orphans, 0 violations, 0 residual stale tokens.

## DRIFT FINDINGS (the high-value output)

The surface agent re-grounds each item against TODAY's code, so the rebuilt
sidecars flag where an item's premise has drifted. Findings below are grouped by
the action they imply. Each is verified (the cited reasoning lives in the
rebuilt sidecar on `main`; file:line claims were made by the surface agent
against the current tree). Re-confirm before acting; `main` keeps moving.

### A. Premise retired by the disposition-vocabulary keystone (re-task / re-scope)

Already known and captured in
`work/notes/observations/merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md`
(do not duplicate; the rebuilds below CONFIRM and cross-reference it):

- `task:merge-questions-gate-axis` (sidecar
  `work/questions/task-merge-questions-gate-axis.md`). The rebuild
  independently re-discovered the drift and self-cross-referenced the
  observation above: the gate's `auto` sub-state is defined as "auto-land an
  answered/unblocked merge", which presupposes the retired `merge|hold|drop`
  disposition mechanism. Suggested: HOLD out of the build pool; resolve as part
  of the `land-time-reverify-and-parallel-merge-ceiling` re-decompose; keep the
  FIXED parts (separate axis, default not `off`, same precedence chain) but
  restate `auto` in binary `answered` terms (no `merge` token). The name/shape
  (OQ7 a/c) do not depend on the retired vocabulary and can be decided locally.
- (Siblings `merge-question-surfacer` and `apply-rung-merge-disposition` are
  already in the prior observation; the second is one of the two excluded
  canaries.)

New, related:

- `observation:review-nits-sidecar-promote-task-vocabulary-and-dropped-routing-doc-2026-06-22`.
  The nit's "ratify the parse policy that rejected the legacy `promote-slice`
  disposition" half is now MOOT: there is no longer a `promote-slice` /
  `promote-task` disposition whose parse policy needs ratifying
  (`packages/dorfl/src/sidecar.ts:33-35` documents `disposition=` as retired and
  parsed away; `packages/dorfl/test/sidecar.test.ts:175` pins it). Residual:
  the merged task left its AC-required `## Decisions` block unwritten in the
  done record. Suggested: delete as overtaken-by-events (or keep as a record);
  not worth a back-fill task.

### B. Genuine masked test gap (worth a real fix)

- `observation:close-job-via-prd-code-literal-vs-renamed-brief-field`. The
  surface agent reports the supposedly-done `prd` -> `brief` rename of the
  close-job discriminator is ABSENT in code while a green test
  (`close-job.test.ts:225-226` asserting `toBe('prd')`) is MASKING the gap.
  Suggested: re-open a small task under the existing
  `code-identifier-slice-prd-to-task-brief-rename` brief to rename the
  discriminator (`type`, literals, the `cand.via === 'prd'` branch,
  `closeComment`) AND flip the test assertion to `'brief'` in the same unit,
  scoping to the full `via`/`prd:` lineage (`frontmatter.ts resolveClosingIssue`
  + `close-job.ts` + tests). This is the highest-value non-cosmetic finding in
  the sweep: verify it before trusting the green.

### C. Residual user-facing prose drift (small follow-up cleanups, human-facing)

- `observation:stale-needs-attention-folder-prose-in-ledger-write-and-do-after-lock-cutover-2026-06-22`.
  The `work/needs-attention/` folder no longer exists (the move is retired;
  `routeToNeedsAttention` records `state: stuck` on the per-item lock), yet
  human-facing runtime strings still point users at it: `do.ts`
  ~1432/1434/1547/1550/2432/2434 ("routed it to work/needs-attention/ ...") and
  `cli.ts:3207` (the `requeue` help text). Suggested: mint a small text-only
  task prioritising the misleading runtime strings over pure docstring drift.
- `observation:review-nits-f3b-promote-takes-per-item-advancing-lock-2026-06-22`.
  The promote path still emits `pre-backlog`/`work/backlog/`/`pre-prd`/
  `work/prd/` nouns in `needs-attention.ts` `note()` messages, the commit
  subject (~825), and `reasonNotMoved` text (~818-869, ~1034-1050, plus pre-prd
  at 683/881/1063/1087). NOTE the canonical target noun is genuinely unsettled:
  done layout-rename tasks introduce `todo`, but the LIVE `work/tasks/` tree
  still has `backlog`/`ready`. Suggested: confirm the target noun against the
  live layout FIRST, then mint a small alignment slice.

### D. Item already overtaken-by-events / already-remediated (candidates to DELETE/discharge)

The surface agent verified these against current code and found the work already
landed or the premise already gone. Each suggests delete/discharge (some with a
tiny optional residual). Listed so the human can sweep them:

- `observation:advance-rung-prose-still-says-build-slice` — `build/slice` /
  `build-slice` prose is gone from all `.ts` files; the named site reads
  `build/task`. Delete (or mint a formal absence-asserting test first).
- `observation:advance-task-folder-set-omits-tasks-backlog-staged-surface-items-misroute-to-build-2026-06-24`
  — the reported mis-route is fixed and regression-tested. Delete; optional
  separate hardening task to unify the two folder-set constants.
- `observation:review-nits-rename-advance-rung-and-sliced-outcome-tokens-2026-06-23`
  — both nits' `sliced` -> `tasked` comment sweeps already happened
  (`do.ts` / `integration-core.ts` carry zero `sliced`). Delete as discharged.
- `observation:review-nits-rename-protocol-doc-slicing-to-tasking-2026-06-23`
  — ADR reference already fixed; the capture note it pointed at was already
  resolved-as-duplicate. Both nits overtaken. Delete.
- `observation:review-nits-rename-slice-stop-sentinel-to-task-stop-2026-06-22`
  — the deferred prose sweep (`rename-src-comment-prose-slicing-to-tasking`)
  landed; `agent-stop.ts` reads `task`/`cross-task`. Delete as fully-closed.
- `observation:test-comments-cite-renamed-sliceablePrds-symbol-2026-06-23`
  — the comment/describe-name sweep already done (symbol landed as
  `taskablePrds`, not the anticipated `taskableBriefs`; no `sliceablePrds`
  remains in tests). Delete.
- `observation:review-nits-f1-pool-noun-todo-in-surface-and-apply-readers-2026-06-22`
  — most nits reference symbols that no longer exist (`slicesLandIn`,
  `warnDeprecatedConfigValues`, the `'backlog'|'todo'` enum); live config is
  `tasksLandIn: 'pre-backlog' | 'ready'`. Delete as overtaken; mint a fresh
  test/comment sweep against today's vocabulary only if still wanted.
- `observation:review-nits-f3a-apply-resolves-item-by-identity-at-write-time-2026-06-22`
  — headline nit (`APPLY_LIFECYCLE_FOLDERS` vs `FOLDERS_FOR_TYPE` asymmetry)
  resolved (sets now identical); the rest minor/ratified. Delete; optionally
  promote one residual nit.
- `task:integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21`
  — an empty stub whose substance is fully owned by
  `land-time-reverify-and-parallel-merge-ceiling` PRD slices (Applied Answer q1:
  scaled `mergeRetries` floor + optional ref-lock + GitHub `concurrency:` sugar;
  the cap is already 1000 and re-rebase no longer charged). Drop as a duplicate.
- `task:triage-cas-race-test-still-flakes-under-parallel-load` — the chosen fix
  (serialise the test via `RACE_SENSITIVE` + `fileParallelism:false`) already
  landed (via `cas-create-nonce-authoritative-same-identity`). Suggested:
  reproduce under the current serialised config; if the flake is gone, cancel as
  already-delivered.

### E. Verified-LIVE premise, but a STALE sub-part to trim (keep + amend)

- `observation:triage-observations-skill-ignores-pending-questions-2026-06-20`.
  Core gap is STILL LIVE: the `triage-observations` skill's step-2
  investigate-sources list omits the question/answer sidecars and an item's
  `needsAnswers`/`## Open questions` state. But one part is now stale: it frames
  impact in the retired disposition-token vocabulary
  (`leave/delete/make-task/amend/fold-into-ADR`), retired by done task
  `triage-observations-skill-retire-disposition-vocabulary`. Suggested: amend
  the skill to add the pending-questions surface to step 2 (exact-item match
  cheap/required; topical overlap surfaced to the human, never auto-decided),
  and drop the disposition-token framing.

### F. Substantive open decisions surfaced (not drift, but worth the human's eye)

These rebuilds produced sharp, well-grounded decision questions on still-valid
premises (no action implied by the sweep beyond noting they are now cleanly
surfaced):

- `prd:mention-flow` (6 questions, bare-mention default intent etc.).
- `task:questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21`
  (flat-identity-keyed vs subfolder; the default preserves the load-bearing
  `sidecarPathFor(identity)` purity).
- `task:scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20`
  (unify the bare-mirror scan gates on `resolveRepoConfigFromMirror`).
- `task:needs-attention-test-cleanup-enotempty-flake`,
  `task:cross-job-ref-based-land-lock`,
  `task:integratelock-...` (overlaps B/D), and the F2/F3 review-nit cluster.

## Why it matters

The delete-then-surface rebuild worked at scale (64/64 clean, self-healing on
flakes, no invariant breakage) and, as hoped, the re-grounding turned the
sidecar set into a live drift report: one masked test gap (B), two human-facing
prose cleanups (C), a cluster of already-overtaken records to discharge (D), a
skill amendment (E), and confirmation of the known disposition-retirement
re-task work (A). The high-value items for the human are B (masked green) and
the A re-task; D is a low-risk discharge sweep.

## Suggested next step

Human triages the groups above: act on B (verify the masked close-job test) and
A (re-task the merge-ceiling PRD), schedule C as small text fixes, run a
discharge pass over D (delete/cancel the overtaken records), and amend the skill
per E. This note itself is a standing capture (needsAnswers:false); it does not
need a sidecar.
