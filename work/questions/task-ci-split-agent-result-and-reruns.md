<!-- dorfl-sidecar: item=task:ci-split-agent-result-and-reruns type=task slug=ci-split-agent-result-and-reruns allAnswered=false -->

## Q1

**'task:ci-split-agent-result-and-reruns' was bounced — how should we proceed?**

> acceptance gate failed (exit 1) on the rebased tip — the failing step was: `pnpm format:check && pnpm build && pnpm test`; its last output was:
>
> packages/dorfl test:      82|    const full = join(d, entry);
> packages/dorfl test:      83|    const rel = prefix ? `${prefix}/${entry}` : entry;
> packages/dorfl test:  ❯ walk test/do-remote.test.ts:91:5
> packages/dorfl test:  ❯ walk test/do-remote.test.ts:91:5
> packages/dorfl test:  ❯ walk test/do-remote.test.ts:91:5
> packages/dorfl test:  ❯ walk test/do-remote.test.ts:91:5
> packages/dorfl test:  ❯ walk test/do-remote.test.ts:91:5
> packages/dorfl test:  ❯ walk test/do-remote.test.ts:91:5
> packages/dorfl test:  ❯ walk test/do-remote.test.ts:91:5
> packages/dorfl test:  ❯ walk test/do-remote.test.ts:91:5
> packages/dorfl test: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
> packages/dorfl test:  Test Files  1 failed | 264 passed (265)
> packages/dorfl test:       Tests  1 failed | 3883 passed (3884)
> packages/dorfl test:    Start at  21:25:36
> packages/dorfl test:    Duration  176.20s (transform 23.38s, setup 2.94s, import 56.93s, tests 410.55s, environment 28ms)
> packages/dorfl test: Failed
> /tmp/dorfl-fresh-gate-W7AfmD/tip/packages/dorfl:
>  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  dorfl@0.14.3 test: `vitest run`
> Exit status 1
>  ELIFECYCLE  Test failed. See above for more details.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
