---
title: the vendored dist/protocol/CLAIM-PROTOCOL.md only lands on `pnpm build`, with no prepublishOnly/prepack hook — a publish-without-build would ship a dist/ missing the protocol doc, re-introducing the packaged-CLI ENOENT
date: 2026-06-11
slug: no-prepublish-hook-vendored-protocol-could-miss-from-tarball
---

## What was spotted

Gate-3 review of PR #69 (`claim-protocol-path-target-repo-and-vendored`) — the slice that fixed the packaged-CLI ENOENT by VENDORING `CLAIM-PROTOCOL.md` into `dist/protocol/` via a build step (`build: "tsc && node scripts/vendor-protocol.mjs"`).

The vendored copy `packages/agent-runner/dist/protocol/CLAIM-PROTOCOL.md` only lands when `pnpm build` runs. There is **no `prepublishOnly` / `prepack` / `prepare` script** in `packages/agent-runner/package.json`. So `npm publish` WITHOUT a prior `pnpm build` would ship a `dist/` missing the protocol doc — re-introducing exactly the ENOENT the slice just fixed (the resolver's `dist/protocol/` fallback would not exist in the published tarball).

## Why it is NOT a regression from PR #69 (and why it was non-blocking)

The compiled JS in `dist/` ALREADY has this exact dependency: `dist/cli.js` and the rest only exist after `tsc`, so publishing without building already ships a broken package. The vendored doc inherits the SAME build-before-publish convention; it does not introduce a NEW failure mode, it joins the existing one. PR #69 did not ask for a publish hook, so this was correctly left as a follow-up rather than scope-creep on that slice.

## Scope / candidate fix

Add a `prepublishOnly` (or `prepack`) script to `packages/agent-runner/package.json` that runs `pnpm build`, so BOTH the compiled JS AND the vendored protocol doc are guaranteed present in any published tarball. This hardens the publish path once for the whole package (not just the protocol doc). Small, mechanical. Decide whether a monorepo-level publish flow already guarantees a build (e.g. a release script / CI) — if so, this may be redundant; if publishing is ever done by hand from the package dir, the hook is the safety net.

## References

- `packages/agent-runner/package.json` — `build: "tsc && node scripts/vendor-protocol.mjs"`, `files: ["dist","src"]`, NO `prepublishOnly`/`prepack`/`prepare`.
- `packages/agent-runner/scripts/vendor-protocol.mjs` — copies `skills/setup/protocol/CLAIM-PROTOCOL.md` → `dist/protocol/`.
- `work/done/claim-protocol-path-target-repo-and-vendored.md` — the slice that introduced the vendoring (the `dist/protocol/` fallback the resolver depends on).
- Surfaced by: Gate-3 review of PR #69 (nit 3).
