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

## Q2

**'task:ci-split-build-path' was bounced — how should we proceed?**

> acceptance gate failed (exit 1) on the rebased tip — the failing step was: `pnpm format:check && pnpm build && pnpm test`; its last output was:
>
> packages/dorfl test:  ❯ EventEmitter.<anonymous> ../../node_modules/.pnpm/vitest@4.1.8_@types+node@25.9.1_vite@8.0.16_@types+node@25.9.1_esbuild@0.28.0_jiti@2.7.0_tsx@4.22.4_yaml@2.9.1_/node_modules/vitest/dist/chunks/cli-api.BfdDOPPI.js:3446:22
> packages/dorfl test:  ❯ EventEmitter.emit node:events:509:28
> packages/dorfl test:  ❯ ChildProcess.emitUnexpectedExit ../../node_modules/.pnpm/vitest@4.1.8_@types+node@25.9.1_vite@8.0.16_@types+node@25.9.1_esbuild@0.28.0_jiti@2.7.0_tsx@4.22.4_yaml@2.9.1_/node_modules/vitest/dist/chunks/cli-api.BfdDOPPI.js:3013:22
> packages/dorfl test:  ❯ ChildProcess.emit node:events:509:28
> packages/dorfl test:  ❯ Process.ChildProcess._handle.onexit node:internal/child_process:295:12
> packages/dorfl test: Caused by: Error: Worker exited unexpectedly
> packages/dorfl test:  ❯ ChildProcess.emitUnexpectedExit ../../node_modules/.pnpm/vitest@4.1.8_@types+node@25.9.1_vite@8.0.16_@types+node@25.9.1_esbuild@0.28.0_jiti@2.7.0_tsx@4.22.4_yaml@2.9.1_/node_modules/vitest/dist/chunks/cli-api.BfdDOPPI.js:3012:33
> packages/dorfl test:  ❯ ChildProcess.emit node:events:509:28
> packages/dorfl test:  ❯ Process.ChildProcess._handle.onexit node:internal/child_process:295:12
> packages/dorfl test: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
> packages/dorfl test:  Test Files  263 passed (264)
> packages/dorfl test:       Tests  3837 passed (3843)
> packages/dorfl test:      Errors  1 error
> packages/dorfl test:    Start at  20:09:30
> packages/dorfl test:    Duration  367.74s (transform 24.25s, setup 3.49s, import 65.06s, tests 436.09s, environment 29ms)
> packages/dorfl test: Failed
> /tmp/dorfl-fresh-gate-TJGkBP/tip/packages/dorfl:
>  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  dorfl@0.14.3 test: `vitest run`
> Exit status 1
>  ELIFECYCLE  Test failed. See above for more details.

<!-- q2 fields: id=q2 kind=stuck -->

**Your answer** (write below this line):
