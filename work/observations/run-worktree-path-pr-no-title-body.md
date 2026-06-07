# run.ts (fleet worktree path) opens PRs with no title/body

2026-06-07 — While building `propose-pr-body`, I wired the synthesised PR
`title` + `body` through the `do`/`complete` chain (the slice's verified chain).
The SEPARATE fleet runner `src/run.ts` (`runOnce`/`runOneItem`) builds its own
`Integrator` and calls `integrateWithRebase({cwd, arbiter, branch, mode, env})`
WITHOUT `title`/`body`, so PRs opened by the multi-machine `run` fleet still get
`gh pr create --fill` (run-on title, empty body). The provider seam now accepts
both fields (optional, no regression), but `run.ts` doesn't synthesise/thread
them — a small follow-on if fleet PRs should match `do`'s.
