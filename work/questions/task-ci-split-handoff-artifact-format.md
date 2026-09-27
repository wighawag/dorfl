<!-- dorfl-sidecar: item=task:ci-split-handoff-artifact-format type=task slug=ci-split-handoff-artifact-format allAnswered=false -->

## Q1

**'task:ci-split-handoff-artifact-format' was bounced — how should we proceed?**

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
> packages/dorfl test:       Tests  70 failed | 3512 passed (3582)
> packages/dorfl test:    Start at  09:58:13
> packages/dorfl test:    Duration  238.31s (transform 58.08s, setup 5.98s, import 127.98s, tests 656.01s, environment 41ms)
> packages/dorfl test: Failed
> /tmp/dorfl-fresh-gate-wrbwNB/tip/packages/dorfl:
>  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  dorfl@0.14.3 test: `vitest run`
> Exit status 1
>  ELIFECYCLE  Test failed. See above for more details.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
