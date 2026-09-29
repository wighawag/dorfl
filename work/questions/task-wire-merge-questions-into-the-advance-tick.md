<!-- dorfl-sidecar: item=task:wire-merge-questions-into-the-advance-tick type=task slug=wire-merge-questions-into-the-advance-tick allAnswered=false -->

## Q1

**'task:wire-merge-questions-into-the-advance-tick' was bounced — how should we proceed?**

> The three decisions recorded on 2026-09-29 cover the policy but leave three load-bearing design questions open. I checked each against the code at `a0d5f6bd`.
>
> 1. **Nothing identifies "a stale lock of the same item's own propose build" (decision 2), so a takeover could steal a live build's lock.** The lock entry (`item-lock.ts` `LockEntry`) carries only `action` (`implement`), `state: active`, `holder` and `since`. Every CI run uses the same bot as holder. So a finished propose build that keeps its lock (`complete.ts`, `propose-keep-lock-until-pr-merge`) looks exactly like a LIVE build. A live build can also have an unmerged branch on the arbiter: a bounced task keeps its `work/task-<slug>` branch there (`needs-attention.ts`, "kept branch"), and the next claim rebuilds from it while holding an `implement` lock. The surfacer takes no lock and checks none, so it would ask "Land this?" about a branch being rebuilt right now. An answered `merge` would then take over that live build's lock, leaving two writers on one item. Please decide the takeover rule. Options:
>    - (a) Take over only when the branch tip carries the item's done-move, meaning the build finished.
>    - (b) Stamp propose-kept locks with a new marker.
>    - (c) Have the surfacer skip branches whose lock is held.
>
>    Option (c) contradicts decision 2's no-PR case, so it needs your call.
>
> 2. **Where the CI tick writes the merge question is undecided.** The acceptance criterion asks the CI "enumerate / dispatch path" to surface questions. But `enumerate` in `.github/workflows/advance-lifecycle.yml` and its seed `docs/ci/advance-loop.yml.template` is `contents: read` and documented "writes nothing". `dispatch` has only `actions: write`. Surfacing means a commit to `main`, so one of two things has to happen, and both change the workflow `install-ci` generates:
>    - (a) Add a new writer job with no agent, like `reap-merged-branches`. It needs a new CLI entry point, since the flag is being removed.
>    - (b) Enumerate merge candidates as matrix items and add a new "surface merge question" rung. That rung would go through `classifyTick` and the lock, agent and apply phases in `ci-phase-treeless.ts`. For a propose-held task sitting in `tasks/ready/`, today's classifier would pick the build rung.
>
>    Please pick one.
>
> 3. **An answered merge question is never picked up.**
>    - **Held locks:** both selection paths (`gatherLifecycleInPlace` for `advance`, and `scan --here` for CI `enumerate`) drop task slugs whose lock is held from the apply pool. So an answered `merge` on an item whose `implement` lock is held is never selected, and a takeover rule alone does nothing without a selection exemption.
>    - **Folders:** the surfacer puts `needsAnswers` on bodies in `tasks/ready`, `tasks/backlog`, `done` and `cancelled`. The apply pool reads only `tasks/ready` (plus backlog under `surfaceStaging`), and the advance classifier's folder list (`FOLDERS_FOR_TYPE`) leaves out `cancelled`. So answers on backlog, done or cancelled bodies are stranded.
>    - **Squash merges:** a PR that was squash-merged but whose branch was not deleted looks like "PR closed unmerged" to the open-PR skip. Its tip is not an ancestor of `main`, so the surfacer would ask to land already-landed work on a `done` body. `isProvablyMergedForReap` covers only a clean diff or matching patch-ids, so it does not reliably catch a multi-commit squash.
>
> Suggested re-scope: record answers to 1 (the takeover criterion), 2 (the CI writer shape) and 3 (the selection exemption and folder set, plus how to treat merged or squash-merged branches) in the task body, then re-promote it. Alternatively, split it: first a task that removes `auto` and the flag and adds the open-PR skip (safe, and fully decided today), then the wiring and takeover work once 1 to 3 are answered.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
