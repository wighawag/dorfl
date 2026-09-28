# `surface-treeless-moved-false` happy-path test times out under full-suite load

2026-09-28: `packages/dorfl/test/surface-treeless-moved-false.test.ts` > "a moved:true surface still reports a clean needs-attention (happy path unchanged)" hit the default 5000ms vitest timeout once during a full `pnpm -r test` run (while building `reconcile-locks-stays-within-the-current-arbiter`), then passed twice in isolation. Looks like a load-sensitive flake: the test probably needs an explicit longer timeout like its git-heavy siblings.
