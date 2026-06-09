---
title: resolveClaimProtocolPath reads the contract doc via a monorepo-relative path that does NOT ship in the published CLI — broken for the packaged `agent-runner`, works only in this dev monorepo
date: 2026-06-09
kind: observation
area: packages/agent-runner/src/prompt.ts (resolveClaimProtocolPath) + packaging
severity: medium
status: open
---

## The signal

`resolveClaimProtocolPath()` (in `src/prompt.ts`) locates `CLAIM-PROTOCOL.md` by
walking **relative to the module's own location** up to the monorepo root
(`../../../skills/setup/protocol/CLAIM-PROTOCOL.md`, with a deeper `../../../../`
variant + legacy `to-slices/` fallbacks). `buildAgentPrompt` then
`readFileSync(protocolPath)` to assemble the work-agent prompt.

This works **only in this dev monorepo**, where `skills/` is a sibling of
`packages/agent-runner/`. It is **broken when `agent-runner` is installed as a
published npm CLI**, because:

- `packages/agent-runner/package.json` ships **`"files": ["dist", "src"]`** only.
  `skills/` lives at the monorepo root, OUTSIDE the package, so it is NOT published.
- Installed, `node_modules/agent-runner/dist/prompt.js` walks
  `../../../skills/setup/protocol/CLAIM-PROTOCOL.md` → resolves into the consumer's
  `node_modules`/filesystem → **ENOENT**.

So the prompt-building path has a latent production failure: it has never worked
outside the monorepo. (The recent `git mv` of the protocol docs `to-slices/ →
setup/protocol/` only changed *which* nonexistent path it points at; it did not
introduce the packaging gap. That move's monorepo breakage was already fixed in
commit `42e64ad` — this observation is about the separate, pre-existing **packaged**
case.)

## Why this matters / how it was found

Found while running the verify gate after consolidating prettier + moving the
protocol docs: a stale path caused an ENOENT in `prompt.ts` that cascaded into ~110
test failures (prompt.ts is imported widely; a load-time read failure fails every
suite that imports it). The monorepo path was fixed, but inspecting `package.json`'s
`files` revealed the packaged CLI never had the file at all.

This also intersects the `work/protocol/` propagation design (ADR
`methodology-and-skills.md` §5 + `setup` writing `work/protocol/`): under that model
the *correct* source for a prompt built against a target repo is **that repo's**
`work/protocol/CLAIM-PROTOCOL.md` (the version it was set up against), not a copy
bundled in the runner. The callers already have the target repo dir available
(`do.ts`/`run.ts` pass `slice.path`; `renderPrompt` has `cwd`), but it is not
threaded into `resolveClaimProtocolPath`.

## Proposed solution set (for a human to decide; NOT yet implemented)

1. **Thread the target repo `cwd` into `resolveClaimProtocolPath(cwd?, override?)`**
   and make the resolution order:
   `override` → **`<cwd>/work/protocol/CLAIM-PROTOCOL.md`** (the target repo — the
   correct source under the new model) → **a copy bundled inside the package** →
   legacy monorepo-relative paths (dev-only fallback).
2. **Vendor the runtime-read protocol doc(s) into the package** so the CLI is
   self-contained: a small build step copies `skills/setup/protocol/CLAIM-PROTOCOL.md`
   (and any other doc the runtime reads) into `packages/agent-runner/` (e.g.
   `dist/protocol/` or `src/protocol/`) before `tsc`, and add it to `files`. This is
   the "vendoring/build-step" approach (the earlier "Solution 1") — set aside for the
   docs layer in favour of `work/protocol/` propagation, but genuinely required HERE
   for the CLI's *fallback* copy, since a published package cannot reference files
   outside itself.
3. Decide whether the bundled copy or the target-repo copy is authoritative when both
   exist (proposal: target-repo `work/protocol/` wins — it reflects the protocol
   version that repo adopted; the bundled copy is only a fallback for an un-set-up
   repo).

## Scope note

This is **agent-runner implementation + packaging** work (TypeScript + a build step),
distinct from the skills/protocol-docs work. Worth its own focused slice/session;
add a test that exercises the resolver from a *simulated installed layout* (no
sibling `skills/`) so the packaged case is regression-covered.

## Provenance

Spotted 2026-06-09 while running `pnpm format:check && pnpm build && pnpm test`
after the protocol-doc move + prettier consolidation; confirmed by reading
`packages/agent-runner/package.json` `files` and `src/prompt.ts`
`resolveClaimProtocolPath`.
