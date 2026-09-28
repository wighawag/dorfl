<!-- dorfl-sidecar: item=task:generated-models-json-references-the-key-env-var type=task slug=generated-models-json-references-the-key-env-var allAnswered=false -->

## Q1

**'task:generated-models-json-references-the-key-env-var' was bounced — how should we proceed?**

> acceptance gate failed (exit 1) on the rebased tip — the failing step was: `pnpm format:check && pnpm build && pnpm test`; its last output was:
>
> packages/dorfl test:  FAIL  |sequential| test/do-remote.test.ts > do --remote — NEVER touches the human area or the real state dirs > the real ~/.dorfl/ and ~/.pi/agent/sessions/ are UNTOUCHED
> packages/dorfl test: Error: Test timed out in 5000ms.
> packages/dorfl test: If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
> packages/dorfl test:  ❯ test/do-remote.test.ts:489:2
> packages/dorfl test:     487|  });
> packages/dorfl test:     488|
> packages/dorfl test:     489|  it('the real ~/.dorfl/ and ~/.pi/agent/sessions/ are UNTOUCHED', asyn…
> packages/dorfl test:        |  ^
> packages/dorfl test:     490|   const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
> packages/dorfl test:     491|   const ws = workspacesDir();
> packages/dorfl test: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
> packages/dorfl test:  Test Files  1 failed | 276 passed (277)
> packages/dorfl test:       Tests  1 failed | 4076 passed (4077)
> packages/dorfl test:    Start at  11:09:07
> packages/dorfl test:    Duration  174.27s (transform 21.11s, setup 2.93s, import 54.76s, tests 446.53s, environment 22ms)
> packages/dorfl test: Failed
> /tmp/dorfl-fresh-gate-frRq0w/tip/packages/dorfl:
>  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  dorfl@0.14.3 test: `vitest run`
> Exit status 1
>  ELIFECYCLE  Test failed. See above for more details.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
