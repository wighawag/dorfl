# `amendHeldEntry` in item-lock.ts has no caller

Date: 2026-09-27
Observer: builder of task `ci-split-route-direct-writes-through-seams`.

`amendHeldEntry` (`packages/dorfl/src/item-lock.ts`) is not called anywhere in `src/` since the `stuck` lock state was retired, and `requeueItemLock` has no production caller either (only `test/item-lock-state-machine.test.ts`). The task routed `amendHeldEntry`'s push through `refWrite.amendLockRef` anyway; whether both helpers should simply be deleted is a separate cleanup.
