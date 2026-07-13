---
title: skills-add-vendor-incur-agents-map — in-scope decisions
created: 2026-07-13
---

# Decisions recorded while implementing `skills-add-vendor-incur-agents-map`

Linked from the task's done record so a reviewer can find them. All three are in-scope choices the task asked to record; none met the ADR bar.

1. **Sibling `vendor-skills.mjs` over an appended block on `vendor-protocol.mjs`.** The two scripts copy DIFFERENT concept sets (contract docs vs. hand-authored skills) into different dest subtrees. Each has its own set that evolves independently. Alternative: append to `vendor-protocol.mjs`. Rejected because a skill added upstream would then require touching a script whose top-of-file comment is about protocol docs. Touches: `packages/dorfl/scripts/`, `packages/dorfl/package.json`'s `build` script (now `tsc && node scripts/vendor-protocol.mjs && node scripts/vendor-skills.mjs`).

2. **Vendored file location: `packages/dorfl/src/vendor/incur/agents.ts`** (co-located with its MIT `LICENSE` + a `README.md` provenance note). Under `src/` so `tsc` compiles it (\u2192 `dist/vendor/incur/agents.js`) and it ships in the published package; under `vendor/incur/` so upstream origin is explicit from the path. `.prettierignore` excludes `packages/dorfl/src/vendor/` so future re-copies from upstream stay a drop-in overwrite (byte-close to upstream), not a merge dance with prettier.

3. **Resolver home: `packages/dorfl/src/install-skills.ts`** (NOT co-located with `resolveProtocolDoc` in `prompt.ts`). The packaged-skills source is owned by skill-install; the protocol-doc resolver is owned by the runner's prompt-assembly. Same shape, different concept — duplicating the small resolver body keeps the ownership boundary clean. Alternative: extract a shared prefer-`dist/`-then-dev-walk primitive. Rejected as premature (two call sites, different candidate lists, different fallback shapes).

Not decisions but noted for completeness: tests use `global: false` + a scratch `cwd` so no test writes to the real `~/.agents/skills/`. Every test file asserts (at teardown) that the real dir's entries are unchanged from a snapshot taken at module load — the shared-write isolation guard the acceptance criterion asks for.
