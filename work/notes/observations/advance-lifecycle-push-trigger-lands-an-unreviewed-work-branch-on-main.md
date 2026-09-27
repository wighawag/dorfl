---
title: 'The advance-lifecycle push trigger runs on work branches, and a tree-less publish from that checkout lands the unreviewed branch on main'
slug: advance-lifecycle-push-trigger-lands-an-unreviewed-work-branch-on-main
date: 2026-09-27
status: spotted
---

2026-09-27, measured on this repo while driving the `ci-split-*` tasks in propose mode (`dorfl do task:ci-split-route-direct-writes-through-seams --isolated --allow-backlog --propose --no-review`).

## What happened

1. The first build of `ci-split-route-direct-writes-through-seams` failed its gate for an environmental reason and was surfaced stuck: commit `8b8442c1` on `main` added `work/questions/task-ci-split-route-direct-writes-through-seams.md`. The build commit `16e54a24` stayed on `work/task-ci-split-route-direct-writes-through-seams`, based on `9f588c83`.
2. The re-dispatched `do` continued from the kept branch: it rebased it onto `main` (so the branch now carried the new sidecar relative to its old tip) and pushed it as `1b39b996` at 15:43:33 UTC. That is correct and expected.
3. That branch push matched `advance-lifecycle.yml`'s `on: push: paths: ['work/questions/**']`, which has NO `branches:` filter. Run 36330612788 started with `GITHUB_REF` = the work branch, and `actions/checkout` checked out `work/task-ci-split-route-direct-writes-through-seams`.
4. Its `advance-propose` legs scanned the WORK BRANCH's tree, found the two new observation notes the build agent had written there, surfaced them, and the tree-less publish pushed `HEAD:main`. `main` went `8b8442c1 -> 1b39b996 -> 3a79b43f -> 6d850d46`: the unreviewed build commit landed on `main` with no PR, no Gate-2 and no Gate-3, while the run was nominally in propose mode.

The code that landed happened to be the code the conductor was reviewing (and approved), so this instance did no damage. The mechanism is the problem: any push to any branch that touches `work/questions/**` lets CI publish that branch's history to `main`.

## Two defects, either one sufficient to prevent it

- **The trigger.** The generated workflow (`packages/dorfl/src/advance-lifecycle-template.ts`, the `push:` block) filters only on `paths`. The on-answer-committed trigger is only meaningful for `main`; it needs `branches: [main]` (or the default-branch equivalent). Every repo `install-ci` set up carries the same trigger.
- **The publish.** `pushTreelessResult` (`advance-treeless-publish.ts`) pushes `HEAD:main` from whatever is checked out. It does not check that the checkout's base is the arbiter's `main`, so a tick running on a non-main checkout publishes every commit between `main` and `HEAD`, not only the tree-less rung's own commit. A guard that refuses (or rebases only the rung's commit) when `HEAD^` is not `<arbiter>/main` would make the trigger bug harmless.

## Relevance to the CI split

Spec `ci-agent-job-without-write-token` assumes the lock job classifies the item "at the arbiter's current `main`". A run whose checkout is a work branch breaks that assumption. `ci-split-generate-workflows` regenerates this workflow, so it is a natural place to pin the trigger to `main`, but the publish guard belongs in `advance-treeless-publish.ts` and should not wait for it.
