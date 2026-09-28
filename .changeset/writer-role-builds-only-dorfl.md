---
'dorfl': patch
---

In workspace install mode, the generated writer-role setup action (`.github/actions/dorfl-setup-writer`) now installs and builds only the dorfl package and its workspace dependencies (`pnpm install --frozen-lockfile --ignore-scripts --filter 'dorfl...'` then `pnpm --filter 'dorfl...' build`) instead of every workspace package, so the lock and apply jobs that hold the write token no longer build the other packages (the website). Registry mode is unchanged. Re-run `dorfl install-ci` in the dorfl monorepo to pick it up.
