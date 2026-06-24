<!-- dorfl-sidecar: item=observation:vscode-flags-node-types-missing-but-tsc-passes-clean type=observation slug=vscode-flags-node-types-missing-but-tsc-passes-clean allAnswered=false -->

## Q1

**What is the terminal disposition for this observation — keep it as a permanent record so future 'types are broken!' panics are short-circuited by 'tsc is clean; restart the TS server', or promote a tiny slice to add an explicit `"types": ["node"]` to `packages/dorfl/tsconfig.json` (belt-and-braces editor parity), or drop it as cosmetic noise?**

> The observation documents that VSCode shows `Cannot find name 'node:crypto'/'NodeJS'/'process'` squiggles on files using Node globals, while the authoritative compiler is clean (`tsc --noEmit` exit 0, `pnpm -r build` green, 2242 tests pass, `@types/node` v25.x is installed in `packages/dorfl/node_modules`). The mismatch is identified as VSCode's TS server resolving a different context (stale server, wrong tsconfig, or unresolved pnpm `node_modules` view), not a code/build defect — the same squiggles appear on pre-existing files (`ledger-write.ts`, `advance-isolated.ts`, etc.), confirming it is workspace-wide. The observation already lists cheapest-first fixes (restart TS server, select Workspace TypeScript version, optionally add `"types": ["node"]`) and explicitly says the build does not need the tsconfig change. There is no `## Open questions` section and no pre-existing residue beyond the disposition itself.

_Suggested default: keep — the code is correct, the gate is green, and the value of the note is exactly as a future-panic-shortcircuit; promoting a slice to mutate tsconfig risks changing `tsc` behaviour for an editor-only cosmetic issue the observation itself warns against doing reflexively._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):
