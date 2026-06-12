---
title: the full `pnpm -r test` suite occasionally fails ONE test under heavy parallel load, then passes clean on re-run
date: 2026-06-12
status: open
---

## The signal

While building `requeue-treeless-transition`, a `pnpm -r test` run (1574 tests, ~108 files, vitest in parallel) failed with a SINGLE test failure once, then passed fully green (1574/1574) on the next three consecutive runs with NO code change in between. The flake was not in a file this slice touched (my changed files passed 3/3 in isolation). The suite is heavy (~95–230s tests, lots of throwaway-git-repo + `--bare` arbiter I/O under `|parallel|`), so the most likely cause is a timing/contention flake (a git op racing the filesystem or a shared temp resource) rather than a real defect.

## Where

Whole `packages/agent-runner` vitest suite under `pnpm -r test`. Not reproduced deterministically; surfaced once, vanished on re-run. Worth a future pass to harden whichever test is timing-sensitive (capture the failing test name when it recurs — this run did not preserve it).
