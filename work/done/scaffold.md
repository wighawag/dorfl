---
title: scaffold — monorepo from template-typescript-lib + vendored claim.sh
slug: scaffold
prd: agent-runner
blocked_by: []
covers: []
created: 2026-06-03
claimed_by: wighawag
claimed_at: 2026-06-03T11:36:55Z
---

## What to build

The runnable skeleton of this repo, so every later slice has a place to land:
scaffold the pnpm monorepo from `template-typescript-lib`, add the
`agent-runner` CLI package shell, and vendor the `claim.sh` script into this repo
so the work-contract is self-contained here.

This is the smallest possible tracer bullet: no behaviour, just a building,
formatting, testing skeleton + the claim tooling.

End-to-end, this slice delivers:

- **Monorepo root** copied/adapted from
  `~/dev/github/wighawag/template-typescript-lib`: `pnpm-workspace.yaml`,
  root `package.json` (workspace scripts: build/format/test/dev/release),
  `.changeset/`, `.gitignore`, `zellij.kdl`. `type: module`, pnpm-only.
- **CLI package** at `packages/agent-runner/` adapted from the template's inner
  package: `tsconfig.json` (NodeNext), `.prettierrc` (tabs + single quotes +
  no bracket spacing), `.prettierignore`, `.gitignore`, and a `package.json`
  that is a CLI — `bin: { "agent-runner": "dist/cli.js" }`, `engines.node >=18`,
  `commander` as the one runtime dep, devDeps `typescript`/`vitest`/`tsx`/
  `as-soon`/`prettier`/`@types/node`. Scripts: `build` (tsc), `dev`
  (`as-soon -w src pnpm build`), `cli` (`tsx src/cli.ts`), `test` (`vitest run`),
  `format`/`format:check`.
- **A trivial entry** so the package builds and one test passes (e.g. a `hello()`
  in `src/index.ts` + a vitest in `test/`), proving the toolchain end-to-end. The
  real `cli.ts` / commands come in later slices.
- **Vendored claim tooling:** copy `claim.sh` from the `wighawag-work-slices`
  skill (`~/dev/github/wighawag/skills/wighawag-work-slices/scripts/claim.sh`)
  to `scripts/claim.sh` in THIS repo, executable. This is a stopgap: later the
  agent-runner itself will drive claims, but for now the script lets a human (or
  an agent) claim items in this very repo. Optionally also copy
  `WORK-CONTRACT.md` / `CLAIM-PROTOCOL.md` for reference, but the script is the
  must-have.

## Acceptance criteria

- [ ] `pnpm install` succeeds at the repo root (pnpm workspace resolves).
- [ ] `pnpm -r build` succeeds (the `agent-runner` package compiles with tsc).
- [ ] `pnpm -r test` runs and the placeholder test passes.
- [ ] `pnpm -r format:check` passes (house style: tabs, single quotes).
- [ ] `packages/agent-runner/package.json` has the `agent-runner` bin entry,
      `commander` dep, and node>=18 engine.
- [ ] `scripts/claim.sh` exists in this repo and is executable.
- [ ] No application behaviour yet beyond the placeholder — `scan`/`run`/`watch`
      are NOT implemented here (they are their own slices).

## Blocked by

- None — this is the first slice; everything else builds on it.

## Prompt

> Scaffold this repo (`agent-runner`) as a pnpm monorepo by adapting the template
> at `~/dev/github/wighawag/template-typescript-lib` (a monorepo with changesets,
> prettier [tabs + single quotes + no bracket spacing], vitest, tsx, `as-soon`,
> `type: module`, NodeNext). The repo currently contains only `work/` — leave
> `work/` untouched and add the scaffold around it.
>
> Produce: a workspace root (`pnpm-workspace.yaml`, root `package.json` with
> recursive build/format/test/dev/release scripts, `.changeset/`, `.gitignore`,
> `zellij.kdl`) and a CLI package at `packages/agent-runner/`. The package is a
> CLI, not a lib: `bin: { "agent-runner": "dist/cli.js" }`, `engines.node >=18`,
> one runtime dep `commander`, devDeps typescript/vitest/tsx/as-soon/prettier/
> @types/node, scripts build(tsc)/dev(as-soon)/cli(tsx)/test(vitest)/format.
> Add a placeholder `src/index.ts` + a passing vitest so the whole toolchain is
> proven, but DO NOT implement any commands — `scan`/`run`/`watch` are separate
> slices that depend on this one.
>
> Also vendor the claim tooling into this repo: copy
> `~/dev/github/wighawag/skills/wighawag-work-slices/scripts/claim.sh` to
> `scripts/claim.sh` (keep it executable). This makes the work-contract
> self-contained here so items in this repo can be claimed via the documented
> protocol (the runner will automate this later). See that skill's
> `WORK-CONTRACT.md` and `CLAIM-PROTOCOL.md` for the contract you are enabling.
>
> "Done" = the acceptance criteria above: install + build + test + format all
> green, the bin/dep/engine wiring present, and `scripts/claim.sh` executable.
> Per repo convention: do NOT auto-commit/push; leave changes for review.
