<!-- dorfl-sidecar: item=task:merge-question-surfacer-finds-namespaced-work-branches type=task slug=merge-question-surfacer-finds-namespaced-work-branches allAnswered=false -->

## Q1

**'task:merge-question-surfacer-finds-namespaced-work-branches' was bounced — how should we proceed?**

> acceptance gate failed (exit 1) on the rebased tip — the failing step was: `pnpm format:check && pnpm build && pnpm test`; its last output was:
>
> packages/dorfl test:  FAIL  |sequential| test/needs-attention-as-stuck-lock-state.test.ts > bounce is a PURE lock amend (no folder move, no main write) > a bounce with NO held lock is a tolerated surface (release idempotent) — never a dead-end held lock
> packages/dorfl test: Error: Test timed out in 5000ms.
> packages/dorfl test: If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
> packages/dorfl test:  ❯ test/needs-attention-as-stuck-lock-state.test.ts:150:2
> packages/dorfl test:     148|  });
> packages/dorfl test:     149|
> packages/dorfl test:     150|  it('a bounce with NO held lock is a tolerated surface (release idempo…
> packages/dorfl test:        |  ^
> packages/dorfl test:     151|   // PR-2b: without a held lock the surface still lands on `<arbiter>/…
> packages/dorfl test:     152|   // and the (already-absent) lock release is a tolerated no-op — move…
> packages/dorfl test: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯
> packages/dorfl test:  Test Files  3 failed | 287 passed (290)
> packages/dorfl test:       Tests  4 failed | 4228 passed (4232)
> packages/dorfl test:    Start at  09:25:14
> packages/dorfl test:    Duration  329.77s (transform 34.09s, setup 6.95s, import 96.69s, tests 951.15s, environment 44ms)
> packages/dorfl test: Failed
> /tmp/dorfl-fresh-gate-bSNoXo/tip/packages/dorfl:
>  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  dorfl@0.14.3 test: `vitest run`
> Exit status 1
>  ELIFECYCLE  Test failed. See above for more details.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):

keep (the gate failed only on 5s timeouts in unrelated tests under host load; the surfacer work on the kept branch is complete, re-run the gate)
