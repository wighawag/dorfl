# 2026-06-23: `do`/`advance` auto-pick pool keyword still spelled `slice`

`cli.ts` (~L1857, ~L2387) describes the `do`/`advance` auto-pick POOL list as
`build/slice/surface/triage` (e.g. `build,slice,surface,triage`). The advance
rung TOKEN was renamed `build-slice`->`build-task` by
`rename-advance-rung-and-sliced-outcome-tokens`, but this user-facing POOL
keyword spelling still says `slice`. Out of scope for the intake cutover; flag
for whoever owns the advance/pool-keyword surface (possible doc-vs-code drift).
