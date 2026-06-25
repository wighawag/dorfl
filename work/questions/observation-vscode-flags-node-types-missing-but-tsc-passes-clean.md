<!-- dorfl-sidecar: item=observation:vscode-flags-node-types-missing-but-tsc-passes-clean type=observation slug=vscode-flags-node-types-missing-but-tsc-passes-clean allAnswered=false -->

## Q1

**What should become of this signal: keep it on record as-is (a tsc-clean editor-only squiggle, short-circuiting future "the types are broken!" panic with "tsc is clean, restart the TS server"), mint a low-priority chore task to make the editor agree with tsc (e.g. add an explicit "types": ["node"] to packages/dorfl/tsconfig.json after verifying it doesn't change tsc behaviour, and/or a README/CONTRIBUTING note to use the workspace TypeScript version), or drop it as a one-off workspace hiccup not worth tracking?**

> Verified against current reality on 2026-06-25: `pnpm -C packages/dorfl exec tsc --noEmit` exits 0 (CLEAN); @types/node IS installed (packages/dorfl/node_modules/@types/node); packages/dorfl/tsconfig.json has NO `types` field, so @types/* are picked up AMBIENTLY (which is why tsc resolves node:crypto/NodeJS/process). The Node-globals usage is real: src/ledger-write.ts and src/item-lock.ts both import node:crypto. NOTE: the file the observation cites as having surfaced it, packages/dorfl/src/item-lock-ref.ts, no longer exists in the tree (likely renamed/removed to item-lock.ts) — so the refs are slightly stale though the workspace-wide claim still stands. The observation itself states this is cosmetic (red squiggles only; build + CI green, 2242 tests pass) and explicitly leaves the disposition NOT pre-decided.

_Suggested default: Keep on record as-is (status documented, no code change). The maintainer-confirmed remedy is operator-side (restart the VSCode TS server / select Workspace TypeScript version); the build does not need a fix, and adding "types": ["node"] reflexively is discouraged by the note itself. If acted on, prefer a low-priority chore task over an inline tsconfig edit so the "does not change tsc behaviour" verification is gated._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
