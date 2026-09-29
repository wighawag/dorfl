---
title: 'The merge-question surfacer is never called, so no kind: merge question is ever surfaced'
slug: merge-question-surfacer-has-no-production-caller
date: 2026-09-29
status: spotted
---

Found while exercising the CI sandbox `wighawag/dorfl-ci-sandbox`, trying to reach the answered `kind: merge` path (`ci-split-answered-merge-action`). `surfaceMergeQuestions` (`packages/dorfl/src/merge-question-surfacer.ts`) is imported by nothing in `src/`; only `test/merge-question-surfacer.test.ts` calls it. The `advance --merge-questions <off|ask|auto>` flag is declared in `cli.ts` (`DoFlags.mergeQuestions`) and never read, and the `mergeQuestions` config key (default `ask`, documented as "a silently-dropped merge-question means finished, pushed work never lands") has no effect. So in practice no merge question is ever surfaced for an unmerged `work/*` branch, and the answered-merge action (laptop and CI phase split) is only reachable through a hand-written sidecar. Either wire the surfacer into the advance tick (the enumerate/dispatch path in CI) behind the gate, or retire the gate, the flag and the docs that promise it.
