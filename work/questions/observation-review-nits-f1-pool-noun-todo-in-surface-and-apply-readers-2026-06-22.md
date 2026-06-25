<!-- dorfl-sidecar: item=observation:review-nits-f1-pool-noun-todo-in-surface-and-apply-readers-2026-06-22 type=observation slug=review-nits-f1-pool-noun-todo-in-surface-and-apply-readers-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this whole review-nits signal now that the vocabulary it triages has been renamed out from under it? Most of its four nits reference symbols that NO LONGER EXIST in src/ (`slicesLandIn`, `warnDeprecatedConfigValues`, the widened `landingToSide` accept of `'backlog'`, the `'backlog'|'todo'` enum). The current code uses `tasksLandIn: 'pre-backlog' | 'ready'`, and the STEP-B pool/staging rename appears landed. Delete as overtaken-by-events, keep as a ratification record that the F1 decisions were superseded, or carve out the still-live residue (a test/comment sweep) into a fresh follow-up task?**

> Item is an observation with needsAnswers: true (Gate-2 APPROVE nits for f1-pool-noun-todo-in-surface-and-apply-readers).\nVerification (cwd 2026-06-25): `grep -rln slicesLandIn|warnDeprecatedConfigValues|landingToSide packages/dorfl/src` shows slicesLandIn and warnDeprecatedConfigValues appear ONLY in this observation file; landingToSide still exists but in tasking.ts/intake.ts; the live config key is now `tasksLandIn` with values `'pre-backlog' | 'ready'` (cli.ts:645-651). The `slicesLandIn: 'backlog'` test literals the obs cites are gone. PRD folder-taxonomy-reorg-and-rename.md is in prds/tasked/. So nits 1/3/4 are overtaken by later renames.

_Suggested default: Delete as overtaken-by-events: the F1 vocabulary the nits triage (`slicesLandIn`/`backlog` enum/`warnDeprecatedConfigValues`) has been renamed away by the subsequent `tasksLandIn`/`ready`/`pre-backlog` work, so the nits no longer point at live code. If any test/comment sweep residue is still wanted, mint it as a fresh task against today's vocabulary rather than reviving this stale frame._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Nit (a)-(e) — RECORD rule: the F1 commit added no `## Decisions` block, but five non-obvious in-scope decisions were made and asked to be ratified or reverted: (a) new helper `warnDeprecatedConfigValues` as the value-rename shim pattern; (b) the legacy `'backlog'` shim wired at three input seams (env/config/CLI); (c) `landingToSide` also defensively accepting literal `'backlog'`, widening the runtime accept-set beyond the declared type; (d) `BacklogItem`/`readBacklogItems` kept as deprecated TYPE/FUNCTION aliases for the migration window; (e) `prdsLandIn` intentionally NOT renamed (its value space never carried the backlog-means-pool noun). Are these decisions still worth ratifying for the record, or moot because the symbols have since been renamed away?**

> Observation finding #1 (verbatim source). Slice prompt asked to RECORD non-obvious in-scope decisions per the task template's RECORD rule; the commit body is one line and the done/ slice body is unchanged. Reality check: `warnDeprecatedConfigValues` and `slicesLandIn` no longer exist in src/; `landingToSide` no longer references `'backlog'`. So (a)/(b)/(c) describe a migration shim that has been fully superseded; (d)/(e) may or may not still hold.

_Suggested default: Treat (a)-(c) as moot (the value-rename shim and widened accept-set were removed by the later `tasksLandIn` rename). Ratify (d)/(e) only if the deprecated aliases / un-renamed `prdsLandIn` are still present today; otherwise fold into the overall delete._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Nit on WORK-CONTRACT.md line 221: should the protocol doc that documented the PR-free `--merge + land-in-staging` flow as `slicesLandIn: backlog` be tightened, given the F1 rename made that text actively misleading? Is this the F-slice's job or deferred to STEP-B's `pre-backlog → backlog` flip?**

> Observation finding #2. Verification: WORK-CONTRACT.md now reads `tasksLandIn: pre-backlog` / `tasksLandIn: ready`, with `work/tasks/backlog/` as staging and `work/tasks/ready/` as the pool (lines 224/237/242/243/247). The `slicesLandIn: backlog` text the nit flagged is GONE. The doc appears already fixed by the later taxonomy/config-rename work. A sibling review-nits observation (slicing-protocol-doc-and-vocabulary-fix-2026-06-22) tracks remaining JSDoc/comment drift separately.

_Suggested default: Close as already-fixed: WORK-CONTRACT.md now uses `tasksLandIn: pre-backlog|ready` and the misleading `slicesLandIn: backlog` line is gone. No new doc edit needed from this item; any residual comment-level drift belongs to the sibling slicing-protocol-doc observation, not here._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Nit on tests passing `slicesLandIn: 'backlog'` literally (placement-precedence.test.ts, pre-backlog-staging-and-promote.test.ts) — worth a follow-up sweep to retarget them onto the new spelling and add one dedicated deprecation-warning test? And the coherence question on `warnDeprecatedConfigValues` (replace-in-place vs. its sibling `warnDeprecatedConfigKeys` deleting the key; table-driven shape for future value-renames vs. one-off shim)?**

> Observation findings #3 and #4. Verification: `grep -rn "slicesLandIn: 'backlog'" packages/dorfl` returns NOTHING today, and `warnDeprecatedConfigValues` no longer exists in src/ — both the test literals and the helper were removed by the later rename. The coherence question about the helper's mutation shape is therefore about code that is gone.

_Suggested default: Drop both as overtaken: the `slicesLandIn: 'backlog'` test literals and the `warnDeprecatedConfigValues` helper no longer exist, so the sweep and the mutation-shape coherence question apply to removed code. If a deprecation-warning test pattern is still wanted for the CURRENT `tasksLandIn` values, raise it fresh against today's code._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
