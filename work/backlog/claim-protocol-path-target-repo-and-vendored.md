---
title: resolveClaimProtocolPath must read the TARGET REPO's work/protocol/CLAIM-PROTOCOL.md (then a VENDORED in-package copy), not a monorepo-relative skills/ path that the published CLI never ships — fixing the packaged-CLI ENOENT
slug: claim-protocol-path-target-repo-and-vendored
blockedBy: []
covers: []
---

## What to build

Make `resolveClaimProtocolPath` resolve `CLAIM-PROTOCOL.md` from sources that actually exist when `agent-runner` is installed as a published npm CLI, so building a work-agent prompt no longer ENOENTs outside this dev monorepo.

Today `resolveClaimProtocolPath(override?)` walks **monorepo-relative** paths (`../../../skills/setup/protocol/CLAIM-PROTOCOL.md`, a deeper `../../../../` variant, + legacy `to-slices/` fallbacks). `package.json` ships only `["dist","src"]`, so the monorepo-root `skills/` tree is **NOT published** — installed, every walk resolves into the consumer's filesystem → ENOENT. `buildAgentPrompt`/`wrapper` then `readFileSync(protocolPath)` and every `do`/`run`/`render-prompt` invocation fails. This has NEVER worked outside the monorepo.

The correct sources under the `work/protocol/` propagation model (ADR `methodology-and-skills.md` §5): the protocol doc is COPIED into every target repo's `work/protocol/` by `setup` (verbatim, re-synced on re-run — it exists in THIS repo at `work/protocol/CLAIM-PROTOCOL.md`). So the prompt built against a target repo should read THAT repo's adopted copy; a bundled copy is the fallback for a not-yet-set-up repo / a layout with no `work/protocol/`.

### Precise scope

- **Thread the target repo `cwd` to the resolver.** `resolveClaimProtocolPath` gains a `cwd?` parameter. The resolution ORDER becomes:
  1. `override` (explicit, for tests / unusual layouts) — unchanged.
  2. **`<cwd>/work/protocol/CLAIM-PROTOCOL.md`** — the target repo's adopted copy (the correct source under the propagation model; authoritative when present).
  3. **a copy VENDORED INSIDE the package** (e.g. `dist/protocol/CLAIM-PROTOCOL.md`) so the published CLI is self-contained.
  4. the legacy monorepo-relative `skills/...` paths — kept LAST as a dev-only fallback.
- **Thread `cwd` through the call chain** so the resolver receives the target repo root: `renderPrompt` (has `options.cwd`), `do`'s + `run`'s `buildAgentPrompt` call sites (have the slice/repo `cwd`), `cli.ts`'s `render-prompt` (has `process.cwd()`) → `buildAgentPrompt(..., {cwd, ...})` → `wrapper(..., {cwd, ...})` → `resolveClaimProtocolPath(cwd, override)`. Keep `protocolPath` override working (it short-circuits, so existing prompt tests that inject a path are unaffected).
- **Vendor the runtime-read doc into the package.** Add a small build step that copies `skills/setup/protocol/CLAIM-PROTOCOL.md` into the package (e.g. `dist/protocol/` — or a `src/protocol/` source that `tsc`/the build carries to `dist`) BEFORE/as part of the package build, and add the vendored location to `package.json` `files` so it ships. The published CLI must contain its own fallback copy; it cannot reference files outside itself.
- **Authority rule:** when BOTH the target-repo copy and the bundled copy exist, the **target-repo `work/protocol/` copy wins** (it reflects the protocol version that repo adopted); the bundled copy is only the fallback for an un-set-up repo.

### Out of scope

- Do NOT change `extractCanonicalWrapperTemplate` / `wrapper`'s substitution logic — only WHERE the doc is read from.
- Do NOT touch `setup`'s copying behaviour (it already writes `work/protocol/CLAIM-PROTOCOL.md`); this slice makes the RUNTIME read it.

## Acceptance criteria

- [ ] `resolveClaimProtocolPath(cwd, override?)` resolves a target repo's `<cwd>/work/protocol/CLAIM-PROTOCOL.md` when present (preferred over the bundled copy) — proven by a test pointing `cwd` at a fixture repo that has the file.
- [ ] In a SIMULATED INSTALLED LAYOUT (no sibling monorepo `skills/` tree reachable, and the target repo has no `work/protocol/`), the resolver returns the **vendored in-package copy** and `buildAgentPrompt` succeeds (no ENOENT) — the regression test that proves the packaged case. (Simulate by resolving against a temp dir with no `skills/` and no `work/protocol/`, asserting the bundled path is chosen and readable.)
- [ ] The vendored `CLAIM-PROTOCOL.md` is included in the package (`package.json` `files`), and the build step that copies it from `skills/setup/protocol/` runs as part of `pnpm build` (so `dist/` contains it).
- [ ] The `protocolPath` override and the existing monorepo (dev) path still work — existing prompt/wrapper tests pass unchanged.
- [ ] `cwd` is threaded through `renderPrompt` / `do` / `run` / the `render-prompt` CLI to the resolver (no call site silently keeps the old no-cwd behaviour for a real target repo).
- [ ] Tests mirror the repo's existing prompt-test style; the installed-layout test uses a temp/scratch fixture (no shared/global location touched).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. Independent; it un-breaks the published CLI's prompt assembly.

## Prompt

> Fix the packaged-CLI ENOENT in `resolveClaimProtocolPath` (`src/prompt.ts`). It currently locates `CLAIM-PROTOCOL.md` via MONOREPO-RELATIVE walks (`../../../skills/setup/protocol/CLAIM-PROTOCOL.md` + a `../../../../` variant + legacy `to-slices/` fallbacks). `packages/agent-runner/package.json` ships only `["dist","src"]`, so the monorepo-root `skills/` tree is NOT published — installed as an npm CLI, every walk resolves into the consumer's filesystem → ENOENT, and `buildAgentPrompt`/`wrapper`'s `readFileSync(protocolPath)` fails for every `do`/`run`/`render-prompt`. It has never worked outside this dev monorepo.
>
> The right sources (ADR `docs/adr/methodology-and-skills.md` §5, the `work/protocol/` propagation model): `setup` copies `CLAIM-PROTOCOL.md` verbatim into every target repo's `work/protocol/` (it exists in THIS repo at `work/protocol/CLAIM-PROTOCOL.md`). So:
>
> 1. Add a `cwd?` param to `resolveClaimProtocolPath`; resolution order = `override` → `<cwd>/work/protocol/CLAIM-PROTOCOL.md` (the target repo's adopted copy, authoritative) → a copy VENDORED inside the package (e.g. `dist/protocol/CLAIM-PROTOCOL.md`, the published-CLI fallback) → the legacy monorepo `skills/...` paths (dev-only, LAST).
> 2. Thread `cwd` down the call chain so the resolver gets the target repo root: `renderPrompt` (`options.cwd`), `do.ts` + `run.ts`'s `buildAgentPrompt(slice.slug, slice.prd, slice.slicePrompt, {...})` call sites (they have the repo `cwd` — today they pass only `continueContext`), and `cli.ts`'s `render-prompt` action (`process.cwd()`) → `buildAgentPrompt(..., {cwd})` → `wrapper(..., {cwd})` → `resolveClaimProtocolPath(cwd, override)`. Keep the `protocolPath` override short-circuit so existing tests that inject a path are unaffected.
> 3. VENDOR the doc into the package: a build step (part of `pnpm build`) copies `skills/setup/protocol/CLAIM-PROTOCOL.md` into the package (e.g. `dist/protocol/`), and add that location to `package.json` `files` so the published CLI is self-contained. A published package cannot reference files outside itself — it needs its own fallback copy.
> 4. Authority: when both the target-repo copy and the bundled copy exist, the target-repo `work/protocol/` copy WINS (it reflects the adopted protocol version); the bundled copy is the un-set-up-repo fallback.
>
> READ FIRST: `src/prompt.ts` (`resolveClaimProtocolPath`, `wrapper`, `buildAgentPrompt`, `renderPrompt`, `PromptOptions`); the call sites `src/do.ts` (~the two `buildAgentPrompt` calls), `src/run.ts` (~the `buildAgentPrompt` call), `src/cli.ts` (the `render-prompt` action calling `renderPrompt({slug, cwd: process.cwd()})`); `packages/agent-runner/package.json` (`files`, the `build` script); `docs/adr/methodology-and-skills.md` §5 + `skills/setup/SKILL.md` (the `work/protocol/` propagation — setup OWNS + copies these docs).
>
> SEAM TO TEST AT: `resolveClaimProtocolPath` directly (order: target-repo `work/protocol/` > vendored > legacy) AND a SIMULATED INSTALLED LAYOUT test — resolve/build a prompt against a temp dir that has NO sibling `skills/` tree and (for the bundled-fallback case) NO `work/protocol/`, asserting the vendored copy is chosen and `buildAgentPrompt` returns a prompt rather than throwing ENOENT. Add a target-repo case (temp repo WITH `work/protocol/CLAIM-PROTOCOL.md`) asserting it is preferred.
>
> SCOPE FENCE: only change WHERE the doc is read from + thread `cwd`; do NOT change the wrapper template extraction/substitution, and do NOT change `setup`'s copying.
>
> FIRST run the drift check (launch snapshot): confirm `resolveClaimProtocolPath` still takes only `override?` and walks `skills/`, that `package.json` `files` is still `["dist","src"]` (no vendored protocol yet), and that `do`/`run` do NOT yet pass `cwd` to `buildAgentPrompt`. If any of this already changed (someone vendored the doc / threaded cwd), narrow this slice to what remains, or route to `needs-attention/` if it is already fixed.
>
> "Done" = the published-CLI layout resolves a readable `CLAIM-PROTOCOL.md` (vendored fallback) and a set-up target repo's `work/protocol/` copy is preferred, `cwd` is threaded end-to-end, the doc ships in the package, existing override/dev paths still work, tests cover the installed + target-repo cases, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

## Source

Promotes `work/observations/claim-protocol-path-unresolvable-when-packaged-as-cli.md` (severity: medium). Re-verified at authoring: `resolveClaimProtocolPath` still walks monorepo-relative `skills/` paths, `package.json` `files` is still `["dist","src"]`, and `do`/`run` do not thread `cwd` to `buildAgentPrompt` — so the packaged-CLI ENOENT is still live.

---

### Claiming this slice

```sh
agent-runner claim claim-protocol-path-target-repo-and-vendored --arbiter origin
git fetch origin && git switch -c work/claim-protocol-path-target-repo-and-vendored origin/main
git mv work/in-progress/claim-protocol-path-target-repo-and-vendored.md work/done/claim-protocol-path-target-repo-and-vendored.md
```
