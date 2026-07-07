## Context

On 2026-06-23, while drive-tasks was working through the 4 post-rename cleanup tasks under brief `code-identifier-slice-prd-to-task-brief-rename`, task #2 `rename-advance-rung-and-sliced-outcome-tokens` hit a compounding infra failure that defeated the `integration: propose` guarantee: its correct, Gate-1-green (2585 tests), Gate-2-approved work landed on `origin/main` as THREE raw linear commits on the first-parent line — `e30a622` (requeue handoff, authored by the human), `9edf582` (`chore: save aborted work (wip)`, agent), `90a25bd` (`feat …; done`, agent) — with NO `(#NNN)` PR reference. Contrast task #1 in the same brief, which landed as one squashed `… ; done (#217)` via a proper PR.

The combined failure that produced this:

1. First `do` run hit `transient-infra` (model `overloaded_error`) mid-build; recovered via `requeue` (keep+continue) per the runbook.
2. Re-`do`: Gate-1 green, Gate-2 approved, but the final integrate push failed with a `--force-with-lease` `[rejected] (stale info)` race — origin's `work/task-…` branch had a stale aborted-wip tip `0e133a3` from run 1, on an OLDER main, that had diverged from the new green tip.
3. Manual recovery force-with-lease-pushed the green tip over the stale one (a WORK branch, not main), requeued, cleared the mirror lock, re-`do`.
4. That re-`do`: Gate-1 green again, then the KNOWN `review verdict was not valid JSON` Gate-2 parser crash.

At that point the `--isolated` recovery path replayed the green work onto `main` DIRECTLY instead of re-opening a PR, bypassing `integration: propose`, Gate-2-as-PR-review, and the conductor's Gate-3 PR review — exactly the runbook's stated risk for the recovery path.

Content trust was restored by the runbook's compensating rule (recovery skips gates ⇒ MUST Gate-3 + manual re-verify): the conductor Gate-3-reviewed the landed diff against task #2's acceptance criteria (rename complete — `TickRungKind` = `build-task`/`task-brief`, `'sliced'` → `'tasked'`; scope fence held — the intake `{slice,prd}` artifact-type cluster left UNTOUCHED for task #3; `intake.ts:1398` == `outcome: kind === 'prd' ? 'prd' : 'tasked'` exactly) and ran the full acceptance gate manually on the real main tree: build + 2585 tests + format:check all GREEN. So the CONTENT on main is trustworthy — this task is about the PROCESS gap, not that landed range.

## Decisions carried in from the observation's answers

- **Retroactive history rewrite of the leaked range is REJECTED.** The three un-squashed commits on main's first-parent history stay. Force-rewriting already-pushed public main is destructive and coordination-sensitive; the cosmetic cost of three commits is less risk than the rewrite. The forward-looking fix (squash requeue/wip chores out of the FUTURE integrated result) belongs to THIS task, not a retroactive rewrite of `e30a622..90a25bd`.
- **Scope fence — what this task does NOT own:**
  - The Gate-2 `review verdict was not valid JSON` parser crash itself — tracked by its existing observation (`gate2-review-verdict-json-parse…`). This task assumes that fault CAN occur and must be survived.
  - The `--force-with-lease` `[rejected] (stale info)` integrate-push race itself — tracked by its existing done stale-lease tasks. This task assumes that fault CAN occur and must be survived.
  - The residual do.ts:548 `sliced` → `tasked` doc-comment nit — separately surfaced, out of scope here.
- **What this task uniquely owns:** the COMBINED-failure outcome where those two component faults together cause the `--isolated` recovery path to defeat the `propose` guarantee by replaying green work directly onto main.

## Acceptance criteria

1. **Recovery path ALWAYS re-opens the PR.** When the `--isolated` recovery path is entered because (a) the integrate push lost a `--force-with-lease` race, and/or (b) the Gate-2 verdict parser crashed, and/or (c) any analogous mid-integrate fault after Gate-1 green, the recovery path MUST NOT replay the green work directly onto `main`'s first-parent line. It MUST re-open (or re-use) the task's PR and route the green result through `integration: propose` so Gate-2-as-PR-review and the conductor's Gate-3 PR review both run. There must be no code path from a Gate-1-green recovery to a direct-to-main push.
2. **Requeue/WIP chore commits are squashed out of the integrated result.** The PR that lands from a recovered run must not carry `chore: save aborted work (wip)` commits, requeue-handoff commits, or intermediate aborted-tip commits on the merged first-parent line. The final integrated shape must match a clean non-recovered run: one squashed `… ; done (#NNN)` commit (or whatever the normal `propose` shape is), regardless of how many recovery cycles preceded it.
3. **Combined-failure regression coverage.** Add a test (or scripted scenario) that simulates the combined failure — an initial run that leaves a stale aborted-wip tip on the work branch on an older main, a requeue, a re-`do` whose Gate-2 verdict parser crashes — and asserts BOTH (a) no commit reaches `main` outside a PR, and (b) the merged PR contains no `chore: save aborted work (wip)` / requeue-handoff commits on its first-parent line. If a full end-to-end simulation is impractical, at minimum unit-test the recovery-path branch that decides between "replay onto main" and "re-open PR" and prove it can never choose the former after a Gate-1-green recovery.
4. **Runbook updated.** The `--isolated` recovery runbook section that currently states the risk ("recovery path skips the gates ⇒ you MUST Gate-3 + manual re-verify") is updated to reflect the new invariant: recovery re-opens the PR, so Gate-2-as-PR-review and Gate-3 PR review run automatically; the manual Gate-3 + re-verify compensating step is no longer the primary safety net for this scenario (it can remain as a belt-and-braces fallback if that's the maintainer's preference, but the recovery path is no longer expected to bypass the gates).
5. **No retroactive rewrite of `origin/main`.** Do not touch commits `e30a622`, `9edf582`, `90a25bd` on main's history. Their presence is accepted per the observation's answer; this task is forward-looking only.

## Out of scope

- Fixing the Gate-2 JSON parser crash (its own observation).
- Fixing the stale-lease integrate-push race (its own done tasks).
- The do.ts:548 `sliced` doc-comment nit.
- Any rewrite of the already-landed `e30a622..90a25bd` range on main.

## Root-cause hypothesis to validate while implementing

The `--isolated` recovery path, when the integrate push loses a `--force-with-lease` race AND/OR the Gate-2 verdict parser crashes, can leave the green work reachable such that a subsequent sync replays it onto `main` directly rather than re-opening the PR. Verify this is indeed the mechanism (vs. some other bypass), and fix at whichever layer makes the "never land on main outside a PR" invariant structural rather than conditional.

## Prompt

> Build the task 'isolated-recovery-path-must-reopen-pr-not-land-on-main', described above.
