<!-- agent-runner-sidecar: item=observation:drive-recovery-landed-task2-direct-on-main-bypassing-pr-2026-06-23 type=observation slug=drive-recovery-landed-task2-direct-on-main-bypassing-pr-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation — promote to a task to harden the --isolated recovery path so it ALWAYS re-opens the PR (never lands on main) and squashes requeue/wip chore commits out of the integrated result, or keep as a signal only?**

> The observation documents a concrete protocol bypass: task #2 of brief code-identifier-slice-prd-to-task-brief-rename landed on origin/main as three raw linear first-parent commits (e30a622 requeue handoff, 9edf582 'chore: save aborted work (wip)', 90a25bd 'feat ...; done') with NO (#NNN) PR reference — bypassing integration:propose, Gate-2-as-PR-review, and the conductor's Gate-3 PR review. Root-cause hypothesis (stated in the observation itself): the --isolated recovery path, when the integrate push loses a --force-with-lease race AND/OR the Gate-2 verdict parser crashes, can leave the green work reachable such that a subsequent sync replays it onto main directly rather than re-opening the PR. Two compounding infra faults are named: (a) Gate-2 'review verdict was not valid JSON' parser crash (already filed) and (b) the stale-info integrate-push race after a requeue from an older-main aborted tip. Content on main is trustworthy (conductor ran full Gate-3 + manual acceptance gate: build + 2585 tests + format:check green), but the propose guarantee was defeated for this task — a recurrence risk worth fixing in code, not just in the runbook.

_Suggested default: promote-task — the observation already articulates a concrete, scoped fix (recovery path must re-open the PR + squash wip/handoff chore commits) and names the two compounding infra faults that triggered it; a sibling task to the already-filed Gate-2 JSON parser crash task closes the loop._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

## Q2

**Is the WIP/handoff chore commits leaking into main's first-parent history (e30a622 requeue handoff authored wighawag, 9edf582 'chore: save aborted work (wip)' agent, then 90a25bd '...; done' agent) acceptable as a one-off cost of recovery, or should main's history be tidied (e.g. an interactive rebase / squash-and-force-push of those three commits into one)?**

> Pre-existing OPEN item in the observation body. The three commits are on the permanent first-parent line of main, not in a merged-and-squashed PR. Tidying main would require a force-push to a shared branch, which has its own cost; leaving them sets a precedent that recovery-path artefacts are permitted in main's linear history.

_Suggested default: Leave main as-is — it is permanent history; rewriting shared main to clean three cosmetic commits is a larger ergonomic/safety cost than the noise it removes, and the real fix is preventing recurrence (the promote-task question above)._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Should the residual Gate-2 nit at do.ts:548 — a one-word `sliced` → `tasked` miss in a passthrough-contract doc comment, within task #2's blast radius — be fixed as a tiny follow-up, folded into task #3, or left alone?**

> Pre-existing OPEN item in the observation body. Cosmetic only (acceptance gate is green); task #2's rename was 'TickRungKind = build-task/task-brief; sliced → tasked' and this one doc-comment occurrence was missed. Task #3 is the intake {slice,prd} artifact-type cluster work, which is a different scope fence per the observation's note that #3 was deliberately left untouched.

_Suggested default: Fold into a trivial cleanup commit / sweep alongside the next touched file — too small to justify its own task, off-scope for task #3's artifact-type cluster._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
