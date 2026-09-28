<!-- dorfl-sidecar: item=task:ci-split-docs-drift-and-rollout type=task slug=ci-split-docs-drift-and-rollout allAnswered=false -->

## Q1

**'task:ci-split-docs-drift-and-rollout' was bounced — how should we proceed?**

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
> packages/dorfl test:  Test Files  1 failed | 275 passed (276)
> packages/dorfl test:       Tests  1 failed | 4065 passed (4066)
> packages/dorfl test:    Start at  08:52:53
> packages/dorfl test:    Duration  176.69s (transform 21.24s, setup 2.81s, import 53.98s, tests 440.63s, environment 24ms)
> packages/dorfl test: Failed
> /tmp/dorfl-fresh-gate-JXNMlK/tip/packages/dorfl:
>  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  dorfl@0.14.3 test: `vitest run`
> Exit status 1
>  ELIFECYCLE  Test failed. See above for more details.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):

## Q2

**'task:ci-split-docs-drift-and-rollout' was bounced — how should we proceed?**

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
> packages/dorfl test:  Test Files  1 failed | 275 passed (276)
> packages/dorfl test:       Tests  1 failed | 4065 passed (4066)
> packages/dorfl test:    Start at  09:04:39
> packages/dorfl test:    Duration  180.56s (transform 22.36s, setup 2.83s, import 58.55s, tests 458.27s, environment 26ms)
> packages/dorfl test: Failed
> /tmp/dorfl-fresh-gate-PWzpOT/tip/packages/dorfl:
>  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  dorfl@0.14.3 test: `vitest run`
> Exit status 1
>  ELIFECYCLE  Test failed. See above for more details.

<!-- q2 fields: id=q2 kind=stuck -->

**Your answer** (write below this line):
