---
'dorfl': patch
---

The CI agent harness install is now reproducible. `install-ci` pinned `@earendil-works/pi-coding-agent@0.80.6`, but that package declares its sibling pi packages (`pi-ai`, `pi-agent-core`, `pi-tui`) with caret ranges, and on a `0.x` version a caret floats within the minor. `pi-ai@0.80.10` removed the `getOAuthApiKey` export that `pi-coding-agent@0.80.6` imports, so a resolver that followed the range installed a harness that died on start (`SyntaxError: The requested module '@earendil-works/pi-ai/oauth' does not provide an export named 'getOAuthApiKey'`) and every CI agent launch failed. The `pnpm add -g` install of `--install-source workspace` was broken; the npm install of the default `registry` mode was only protected by the `npm-shrinkwrap.json` the harness happens to publish.

The generated `dorfl-setup` action now installs the harness in both modes with npm into a job-local directory, from a `package.json` whose `overrides` pin every pi package the harness loads to an exact version (0.80.6), and adds that directory's `node_modules/.bin` to `PATH`. A new `Check the agent harness loads (pi)` step runs `pi --version` right after the install, so a harness that cannot load fails the setup step with a clear message instead of failing inside a dorfl agent launch.

Re-run `dorfl install-ci` to regenerate `.github/actions/dorfl-setup` and pick up the fix.
