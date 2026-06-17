---
title: VSCode reports "Cannot find name 'node:crypto'/'NodeJS'/'process', install @types/node" on src files that use Node globals, even though `tsc --noEmit` passes CLEAN and @types/node IS installed, an editor TS-server resolution mismatch, NOT a code/build defect
type: observation
status: spotted
spotted: 2026-06-17
slug: vscode-flags-node-types-missing-but-tsc-passes-clean
---

## What was seen

While reviewing a new src file (`packages/agent-runner/src/item-lock-ref.ts`), the
VSCode editor showed type errors:

```
Cannot find name 'node:crypto'. Do you need to install type definitions for node?
  Try `npm i --save-dev @types/node` ... (and add 'node' to the tsconfig types field)
Cannot find namespace 'NodeJS'. ts(2503)
Cannot find name 'process'. ... @types/node ... ts(2591)
```

## Why this is an EDITOR issue, not a code/build defect (VERIFIED)

- **The authoritative compiler is CLEAN.** `cd packages/agent-runner && npx tsc
  --noEmit` exits 0; `pnpm -r build` (which runs `tsc`) is green; the full gate
  (`pnpm -r build && pnpm -r test && pnpm format:check`) passes (2242 tests).
- **`@types/node` IS installed** (`packages/agent-runner/node_modules/@types/node`,
  v25.x).
- **The flagged file uses Node globals EXACTLY as existing src files do.**
  `node:crypto` is imported by `src/ledger-write.ts` too; `NodeJS.ProcessEnv` is
  used across `advance-isolated.ts`/`advance-loop-driver.ts`/many; `process.env`
  across `advancing-lock.ts`/`apply-persist.ts`/`cli.ts`/many.
- **The SAME VSCode errors appear on those EXISTING files**, not just the new one
 , confirmed by the maintainer. So the signal is workspace-wide, not file-specific.

The tsconfig (`packages/agent-runner/tsconfig.json`) has NO `types` field, so it
picks up `@types/*` AMBIENTLY (including `@types/node`), which is why `tsc`
resolves them. VSCode's TypeScript server is resolving a DIFFERENT context (a
stale TS server, the wrong/workspace-root tsconfig, or a not-yet-resolved pnpm
`node_modules` view), so it does not see `@types/node`.

## Disposition / fix shape (NOT pre-decided, left as a signal)

This is cosmetic (red squiggles in the editor only; build + CI are green), so it is
low priority. Likely fixes, cheapest first:

- **Restart the VSCode TS server** (Command Palette → "TypeScript: Restart TS
  Server") and/or "Developer: Reload Window", most pnpm-monorepo "missing
  @types/node" squiggles are a stale server picking up a transient
  `node_modules` state.
- **Ensure VSCode uses the WORKSPACE TypeScript** ("TypeScript: Select TypeScript
  Version" → Use Workspace Version) so the editor and `tsc` agree.
- **If it persists**, consider an explicit `"types": ["node"]` in the package
  tsconfig (it currently relies on ambient `@types/*` pickup), but verify this
  does not change `tsc`'s behaviour (it currently resolves them fine), so this is a
  belt-and-braces for editors, not a build fix. Do NOT add it reflexively; the
  build does not need it.

No code change was made for this (the code is correct); captured so the
editor-vs-tsc mismatch is on record and a future "the types are broken!" panic is
short-circuited with "tsc is clean; restart the TS server."

## Refs

- New file that surfaced it: `packages/agent-runner/src/item-lock-ref.ts` (the
  per-item-lock-ref tracer; uses `node:crypto` + `NodeJS.ProcessEnv` + `process.env`
  like `src/ledger-write.ts`).
- `packages/agent-runner/tsconfig.json` (no `types` field; ambient `@types/*`).
- Authoritative check: `npx tsc --noEmit` (exit 0).
