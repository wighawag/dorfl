<!-- dorfl-sidecar: item=observation:drive-recovery-landed-task2-direct-on-main-bypassing-pr-2026-06-23 type=observation slug=drive-recovery-landed-task2-direct-on-main-bypassing-pr-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation? It recommends a real follow-up task: make the --isolated recovery path ALWAYS re-open the PR (never land the green work directly on main) when the integrate push loses a --force-with-lease race and/or the Gate-2 verdict parser crashes, and squash the requeue/wip `chore:` commits out of the integrated result. Do you want to promote a task for that recovery-path hardening, or take another path (defer, fold into an existing PRD, or keep as a triaged record)?**

> Observation §ROOT-CAUSE HYPOTHESIS (work/notes/observations/drive-recovery-landed-task2-direct-on-main-bypassing-pr-2026-06-23.md). The triggering task `rename-advance-rung-and-sliced-outcome-tokens` is now in `tasks/done/` (its Requeue 2026-06-23 note confirms the manual stranded-branch recovery), so the incident is closed but the recovery-path defect is NOT addressed by any open task. The two COMPOUNDING infra faults are each already tracked separately: the Gate-2 'review verdict was not valid JSON' crash has its own observation+sidecar (`gate2-review-verdict-json-parse-crash-on-large-diffs`, needsAnswers:true), and the stale-lease push race has multiple DONE tasks (`work-branch-push-retry-on-stale-lease`, `stale-lease-retry-all-push-sites-and-treeless-surface`). What is NOT yet captured anywhere is the COMBINED-failure outcome this observation names: that the two faults together can replay green work onto main directly instead of re-opening the PR, defeating the `propose` guarantee. That gap is the unique signal here.

_Suggested default: promote-task — a follow-up task to harden the --isolated recovery path so the combined (stale-lease-race + Gate-2-parse-crash) failure ALWAYS re-opens the PR rather than replaying green work onto main, and squashes requeue/wip `chore:` commits out of the integrated result; scoped to the recovery/replay path only (the two component faults stay tracked by their existing observation/done-tasks). The do.ts:548 `sliced`->`tasked` doc-comment nit named in this observation is already separately surfaced in `questions/observation-review-nits-rename-advance-rung-and-sliced-outcome-tokens-2026-06-23.md`, so it is NOT part of this disposition._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Mint the recovery-path-hardening task. Scope it to the recovery/replay path only: when the `--isolated` recovery path hits the combined failure (integrate push loses the --force-with-lease race AND/OR the Gate-2 verdict parser crashes), it must ALWAYS re-open the PR rather than replay green work directly onto main, and it must squash the requeue/wip `chore:` commits out of the integrated result. The two component faults stay tracked by their existing homes (the gate2-review-verdict-json-parse observation, and the done stale-lease tasks); the unique gap this task owns is the COMBINED-failure outcome that defeats the `propose` guarantee. The do.ts `sliced`->`tasked` doc-comment nit is out of scope here (separately surfaced).

## Q2

**Is it acceptable that task #2's WIP/handoff `chore:` commits (`e30a622` requeue handoff, `9edf582` `chore: save aborted work (wip)`, `90a25bd` `feat ...; done`) leaked into origin/main's permanent first-parent linear history with NO `(#NNN)` PR reference, or should main's history be tidied (e.g. squashed/rewritten) for this landed range?**

> Observation 'NET RESULT' + 'OPEN' sections. Contrast task #1, which landed as one squashed `... ; done (#217)` via a proper PR. The CONTENT on main was verified trustworthy by the conductor's manual Gate-3 review + full acceptance gate (build + 2585 tests + format:check green on the real main tree), per the observation's MITIGATION section, so this is purely a history-hygiene decision, not a correctness one. Rewriting already-pushed main history is a destructive, coordination-sensitive operation, which is why it is surfaced as a human decision rather than auto-dispositioned.

_Suggested default: Accept the leaked commits in main history (do NOT rewrite already-pushed main): the landed content is verified-green, and a force-rewrite of public main history carries more risk than the cosmetic cost of three un-squashed commits. Capture 'recovery path should squash requeue/wip chores out of the FUTURE integrated result' as part of the recovery-path-hardening task above, rather than retroactively rewriting this range._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Accept the leaked commits; do NOT rewrite already-pushed main. The landed content is verified-green, and a force-rewrite of public main history is destructive and coordination-sensitive, more risk than the cosmetic cost of three un-squashed commits. The forward-looking fix (recovery path should squash requeue/wip chores out of the FUTURE integrated result) belongs in the recovery-path-hardening task from Q1, not a retroactive history rewrite of this range.
