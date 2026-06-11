---
title: review-gate non-blocking nits for 'claim-protocol-path-target-repo-and-vendored' (Gate 2 approve)
date: 2026-06-11
status: open
slug: claim-protocol-path-target-repo-and-vendored
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'claim-protocol-path-target-repo-and-vendored' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the parameter-order change to the exported `resolveClaimProtocolPath`: it went from `(override?)` to `(cwd?, override?)`. Is breaking the public signature of an exported function (rather than `(override?, cwd?)` or an options object) the intended choice?
  (`resolveClaimProtocolPath` is re-exported from `src/index.ts`, so it is part of the package's public API. The new order puts `cwd` first and pushes `override` to second. Any external caller that previously did `resolveClaimProtocolPath(myPath)` intending an override would now silently pass it as `cwd` and lose the short-circuit. In-repo this is safe — the only callers are `wrapper` (updated to `(options.cwd, options.protocolPath)`) and the tests (updated) — but it is an in-scope API-shape decision the slice did not pin down and there is no '## Decisions' block in the PR description recording it. Putting `cwd` first reads naturally given the new authority order; flagging for the human to ratify rather than reverse.)
- Ratify shipping the vendored copy via the existing `dist` entry in `files` instead of literally adding `dist/protocol` (or `protocol`) to `package.json` `files` as the slice's wording requested. Is relying on `dist` covering `dist/protocol/` acceptable?
  (The slice text says 'add the vendored location to package.json files so it ships.' The agent instead placed the vendored copy under `dist/protocol/`, which `files: ["dist","src"]` already includes recursively — so the doc ships and the acceptance criterion ('included in the package') is met without editing `files`. This is functionally correct and arguably cleaner (no redundant entry), but it is a deviation from the literal instruction and not recorded as a decision. Worth one ratification.)
- Should a build hook (e.g. `prepublishOnly`/`prepack` running `pnpm build`) be added so the vendored `dist/protocol/CLAIM-PROTOCOL.md` is guaranteed present in the published tarball — or is build-before-publish an accepted pre-existing convention for this package?
  (There is no `prepublishOnly`/`prepack`/`prepare` script. The vendored copy only lands in `dist/protocol/` when `pnpm build` runs, so a publish without a prior build would ship a `dist/` missing the protocol doc — re-introducing the ENOENT the slice fixes. However, the compiled JS in `dist/` already has this exact dependency on build-before-publish, so this is the package's existing convention and not a regression introduced by this slice; the slice did not ask for a publish hook. Noting it so the human can decide whether to harden the publish path separately (e.g. a follow-up observation), not as a blocker on this slice.)
