<!-- dorfl-sidecar: item=task:ci-split-tasking type=task slug=ci-split-tasking allAnswered=false -->

## Q1

**'task:ci-split-tasking' was bounced — how should we proceed?**

> acceptance gate failed (exit 1) on the rebased tip — the failing step was: `pnpm format:check && pnpm build && pnpm test`; its last output was:
>
> packages/dorfl test:     "repos/github-com/wighawag/webevm.git/worktrees/github-com__wighawag__webevm__state-change-set-capture/ORIG_HEAD",
> packages/dorfl test:     "repos/github-com/wighawag/webevm.git/worktrees/github-com__wighawag__webevm__state-change-set-capture/commondir",
> packages/dorfl test:     "repos/github-com/wighawag/webevm.git/worktrees/github-com__wighawag__webevm__state-change-set-capture/dorfl-writer.json",
> packages/dorfl test:  ❯ test/do-remote.test.ts:514:35
> packages/dorfl test:     512|
> packages/dorfl test:     513|   // The real state dirs are byte-for-path identical (nothing leaked t…
> packages/dorfl test:     514|   expect(listAllFiles(realDorfl)).toEqual(before.dorfl);
> packages/dorfl test:        |                                   ^
> packages/dorfl test:     515|   expect(listAllFiles(realPiSessions)).toEqual(before.piSessions);
> packages/dorfl test:     516|
> packages/dorfl test: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
> packages/dorfl test:  Test Files  1 failed | 270 passed (271)
> packages/dorfl test:       Tests  1 failed | 3994 passed (3995)
> packages/dorfl test:    Start at  06:19:04
> packages/dorfl test:    Duration  184.10s (transform 21.28s, setup 2.80s, import 53.03s, tests 413.56s, environment 21ms)
> packages/dorfl test: Failed
> /tmp/dorfl-fresh-gate-6qN3cd/tip/packages/dorfl:
>  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  dorfl@0.14.3 test: `vitest run`
> Exit status 1
>  ELIFECYCLE  Test failed. See above for more details.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
