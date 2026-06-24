<!-- dorfl-sidecar: item=observation:review-nits-f1-pool-noun-todo-in-surface-and-apply-readers-2026-06-22 type=observation slug=review-nits-f1-pool-noun-todo-in-surface-and-apply-readers-2026-06-22 allAnswered=false -->

## Q1

**How should the five undocumented in-scope decisions from F1 be ratified — append a `## Decisions` block (to the done-slice file and/or a follow-up notes entry) recording: (a) NEW helper `warnDeprecatedConfigValues` codified as the value-rename shim pattern, (b) three-seam migration of legacy `'backlog'` (env, config file, CLI flag) each with its own warning text, (c) `landingToSide` defensively also accepting `'backlog'` even though all three seams already migrate it (widens runtime accept-set beyond the declared type), (d) `BacklogItem` / `readBacklogItems` kept as deprecated re-exports for the migration window, (e) `prdsLandIn` intentionally NOT renamed because its enum is `'pre-prd' | 'prd'` and never carried the pool-meaning `backlog`?**

> Slice prompt required RECORDING non-obvious in-scope decisions (explicitly naming the shim-reuse question and the deprecated-alias question). Commit message is one line and the done-slice body is unchanged from the brief — no Decisions section exists. Each item is a deliberate call worth ratification or reversal.

_Suggested default: keep — promote to a tiny follow-up slice that appends a `## Decisions` block to the done-slice file (or a sibling notes entry) ratifying all five points as-is._

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

## Q2

**Should the next F-slice tighten `WORK-CONTRACT.md` line 221 (and the explanatory line 226) so the documented operator flow `slicesLandIn: backlog` is rewritten to `slicesLandIn: pre-backlog` (the current correct staging value), or is this deferred to the rest of STEP-B that flips `pre-backlog → backlog` for staging?**

> `skills/setup/protocol/WORK-CONTRACT.md` (and the propagated `work/protocol/` mirror) line 221 documents the PR-free `--merge + land-in-staging` flow as `slicesLandIn: backlog`. Post-F1, `'backlog'` is the deprecated alias of `'todo'` (the POOL) — an operator following the doc will get a deprecation warning AND land slices in the POOL, the opposite of the prose ('land DURABLY on `main` under `work/tasks/backlog/` (the staging folder, NOT eligible)'). F1 made zero protocol-doc edits. The slice's 'mirror vocabulary fix into work/protocol/' criterion is debatable because the doc uses `backlog` to mean STAGING (not pool), so it does not literally carry the old `backlog`-means-pool noun — but it is now actively misleading.

_Suggested default: promote-slice — a small protocol-doc-only slice that flips line 221 to `slicesLandIn: pre-backlog` and rewords line 226 now, independent of STEP-B's later staging rename._

<!-- q2 fields: id=q2 disposition=promote-slice -->

**Your answer** (write below this line):

## Q3

**Should there be a follow-up sweep that retargets all test sites still passing `slicesLandIn: 'backlog'` literally (in `placement-precedence.test.ts` lines 184/193/228/239/248/257/275/320/370 etc. and `pre-backlog-staging-and-promote.test.ts` lines 423/427/458/461/472) onto the new `'todo'` spelling, plus ONE dedicated test that the legacy `'backlog'` value emits the deprecation warning and still maps to the pool?**

> Those test files compile because `tsconfig.json` includes only `src/**/*.ts` (test files are not strictness-checked against `PerformSliceOptions.slicesLandIn: 'pre-backlog' | 'todo'`), and they pass at runtime only because `landingToSide` defensively accepts `'backlog'`. A slab of existing tests now silently exercises the DEPRECATED alias path rather than the new vocabulary, and their `describe` titles ('slicesLandIn: backlog + trusted origin ⇒ lands in `work/tasks/todo/`') read incoherently against the rename.

_Suggested default: promote-slice — small follow-up: retarget tests onto `'todo'`, keep exactly ONE test asserting the `'backlog'` deprecation-warning + same-pool behaviour, then narrow `landingToSide`'s accept-set if possible._

<!-- q3 fields: id=q3 disposition=promote-slice -->

**Your answer** (write below this line):

## Q4

**Is the new helper `warnDeprecatedConfigValues` the intended FUTURE pattern for all value-renames (in which case it should be refactored to a table-driven shape like the existing `DEPRECATED_CONFIG_KEYS` so a second entry does not require touching the function body, and the env-side migration should call it instead of open-coding the same rename), or is it deliberately a one-off shim sized to today's single rename?**

> `packages/dorfl/src/config.ts` added `warnDeprecatedConfigValues` as a hand-rolled `if (parsed.slicesLandIn === 'backlog') …` block; its sibling `warnDeprecatedConfigKeys` is table-driven and mutates by DELETING the key, whereas the new helper mutates by REPLACING the value in place. `env-config.ts` open-codes the same migration inline at the `envOverrides` coercion site rather than calling the shared helper — so the codebase now has three slightly different shapes for 'rename-shim'.

_Suggested default: keep — record the intent as 'one-off shim for now; generalise to table-driven on the SECOND value rename' in the same Decisions block proposed above; no code change yet._

<!-- q4 fields: id=q4 disposition=keep -->

**Your answer** (write below this line):
