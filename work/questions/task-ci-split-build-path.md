<!-- dorfl-sidecar: item=task:ci-split-build-path type=task slug=ci-split-build-path allAnswered=false -->

## Q1

**'task:ci-split-build-path' was bounced — how should we proceed?**

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
> packages/dorfl test:  Test Files  1 failed | 263 passed (264)
> packages/dorfl test:       Tests  1 failed | 3842 passed (3843)
> packages/dorfl test:    Start at  19:57:08
> packages/dorfl test:    Duration  200.62s (transform 21.47s, setup 2.82s, import 54.77s, tests 402.39s, environment 23ms)
> packages/dorfl test: Failed
> /tmp/dorfl-fresh-gate-Bn7Q3C/tip/packages/dorfl:
>  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  dorfl@0.14.3 test: `vitest run`
> Exit status 1
>  ELIFECYCLE  Test failed. See above for more details.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
