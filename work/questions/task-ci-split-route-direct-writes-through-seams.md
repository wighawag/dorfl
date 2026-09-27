<!-- dorfl-sidecar: item=task:ci-split-route-direct-writes-through-seams type=task slug=ci-split-route-direct-writes-through-seams allAnswered=false -->

## Q1

**'task:ci-split-route-direct-writes-through-seams' was bounced — how should we proceed?**

> acceptance gate failed (exit 1) on the rebased tip — the failing step was: `pnpm format:check && pnpm build && pnpm test`; its last output was:
>
> packages/dorfl test:  ❯ run src/git.ts:201:9
> packages/dorfl test:     199|  });
> packages/dorfl test:     200|  if (result.error) {
> packages/dorfl test:     201|   throw new Error(spawnErrorMessage(command, exe, env, result.error));
> packages/dorfl test:        |         ^
> packages/dorfl test:     202|  }
> packages/dorfl test:     203|  return {
> packages/dorfl test:  ❯ gitRemoteGetUrl src/repo-config.ts:536:14
> packages/dorfl test:  ❯ resolveRepoConfig src/repo-config.ts:582:25
> packages/dorfl test:  ❯ test/tasker-maxreview-config.test.ts:101:21
> packages/dorfl test: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[69/70]⎯
> packages/dorfl test:  Test Files  12 failed | 239 passed (251)
> packages/dorfl test:       Tests  70 failed | 3446 passed (3516)
> packages/dorfl test:    Start at  10:01:07
> packages/dorfl test:    Duration  174.31s (transform 68.98s, setup 5.19s, import 130.82s, tests 515.70s, environment 35ms)
> packages/dorfl test: Failed
> /tmp/dorfl-fresh-gate-tqzPKL/tip/packages/dorfl:
>  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  dorfl@0.14.3 test: `vitest run`
> Exit status 1
>  ELIFECYCLE  Test failed. See above for more details.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
