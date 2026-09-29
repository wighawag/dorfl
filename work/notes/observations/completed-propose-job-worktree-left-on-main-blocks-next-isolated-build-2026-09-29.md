# A completed `--propose` job worktree was left checked out on `main`, and blocked the next isolated build's config read

Date: 2026-09-29
Observer: conductor of a drive-tasks run over wighawag/serpcast (dorfl 0.14.3).

A SUCCESSFUL `do task:scaffold-monorepo --isolated --allow-backlog` (PR opened, "switched to main") left its job worktree `~/.dorfl/work/github-com__wighawag__serpcast__scaffold-monorepo` in place, checked out on `main` of the hub mirror, with untracked `node_modules/` and `dist/`. The next `do --isolated` for another task then failed up front:

```
>> could not read the target repo's dorfl.json from git@github.com:wighawag/serpcast.git/main; resolving config from global + flags only. git fetch origin +refs/heads/main:refs/heads/main failed (exit 128): fatal: refusing to fetch into branch 'refs/heads/main' checked out at '/home/wighawag/.dorfl/work/github-com__wighawag__serpcast__scaffold-monorepo'
error: no harness configured and no agentCmd set.
```

This is a variant of the defect `work/tasks/done/isolated-config-read-main-only-fetch-and-reap-on-failure.md` fixed: that slice made the config read main-only, but here the blocker is a worktree on `main` itself, left by a successful run (not a failed one). Plain `dorfl gc` retained it as "dirty tree (uncommitted changes)" because of the untracked build output, so `gc --force --yes` was needed. It happened once in 10 builds (later builds reaped cleanly), so it may depend on the first build in a fresh mirror. Two separate problems: (1) a successful isolated run should reap its worktree, or at least not leave it on the mirror's `main`; (2) the resulting error blames a missing harness, which sends the reader the wrong way; the config read failure should be fatal or named as the cause. Also, gc could treat ignored/untracked build output (`node_modules`, `dist`) as not "unsaved work".
