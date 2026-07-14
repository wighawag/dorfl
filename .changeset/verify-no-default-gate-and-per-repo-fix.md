---
'dorfl': minor
---

Remove the default acceptance gate: an unset `verify` now FAILS LOUD, and `dorfl verify` honours the per-repo `dorfl.json`.

Two related fixes to the acceptance gate (`verify`):

- **No more default gate (behaviour change).** Previously an unset or all-blank `verify` silently fell back to `pnpm -r build && pnpm -r test && pnpm -r format:check`. That was unsafe: in a non-pnpm repo (e.g. a Zig or Make project) it ran the WRONG check, and in a repo pnpm knows nothing about, `pnpm -r ...` prints "No projects found" and exits 0 — a VACUOUS GREEN that let unverified work cross the trust boundary. Dorfl now has NO default gate: `resolveVerifyCommands` throws `VerifyNotConfiguredError` on an unset/all-blank gate, `runVerify` turns that into a failing `notConfigured` result (never an uncaught crash), and the pre-claim `checkGatePreconditions` guard fails fast — MODE-INDEPENDENT, since a missing gate can never pass in any mode — before a wasted claim + build. A repo MUST now declare its own `verify` in `dorfl.json`.

- **`dorfl verify` now reads the per-repo config.** The standalone `dorfl verify` command resolved its gate from the GLOBAL config only, ignoring a repo's committed `dorfl.json` `verify` entirely and running the old built-in default. It now resolves through the same per-repo chain the runner uses (flag > env > per-repo `dorfl.json` > global), matching its own help text and the `do`/`run`/`complete` paths.

Migration: if you relied on the implicit default, add it explicitly, e.g. `"verify": "pnpm -r build && pnpm -r test && pnpm format:check"` (a single string or an ordered list of commands) to your `dorfl.json`.
