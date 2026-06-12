---
title: converge-issue-provider-onto-gh-failure-module — make `src/gh-failure.ts` the GENUINE single source of truth by replacing issue-provider.ts's ~7 inline copies of the binary-missing literal + the two-arm `undefined ? '…' : ghFailureReason` guard with the shared `GH_BINARY_MISSING` / `ghFailureDetail` exports (github.ts already fully adopted them)
slug: converge-issue-provider-onto-gh-failure-module
blockedBy: []
covers: []
---

> Self-contained COHERENCE/DEDUP slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal (discharged into this slice on authoring): `work/observations/review-nits-github-provider-surface-real-gh-cause-2026-06-11.md` (nit #2 — the residual-duplication follow-up the gate flagged on an approved PR).

## The drift (verify against current code)

`src/gh-failure.ts` was created to be "the single source of truth so the two providers can NEVER drift apart" for the `gh`-failure reason text. It exports:

- `GH_BINARY_MISSING = '`gh` is not available (binary missing).'` (the fixed missing-binary string), and
- `ghFailureDetail(result: RunResult | undefined): string` = `result === undefined ? GH_BINARY_MISSING : ghFailureReason(result)` (the two-arm pair), and
- `ghFailureReason(result: RunResult): string` (the genuine-stderr arm).

`src/github.ts` FULLY adopted the pair. But `src/issue-provider.ts` adopted only HALF — it imports `ghFailureReason` ALONE and keeps **~7 inline copies** of the literal `'`gh` is not available (binary missing).'` plus the two-arm `result === undefined ? <literal> : ghFailureReason(result)` shape, rather than calling `ghFailureDetail` / referencing `GH_BINARY_MISSING`. So the binary-missing string lives in BOTH `gh-failure.ts` (the constant) AND inline ~7× in `issue-provider.ts`; the literals happen to match today, but that is EXACTLY the drift surface the module was created to eliminate (the next fix to the wording updates the constant + github.ts but silently leaves issue-provider's 7 copies stale).

The inline LITERAL occurrences (verify — lines may have drifted): **7 occurrences across 5 functions** in `src/issue-provider.ts`:
- `postIssueComment` (~L378) — the two-arm `undefined ? <literal> : ghFailureReason` (a clean `ghFailureDetail` collapse);
- `closeIssue` (~L410) — a standalone `undefined`-branch `const reason = <literal>` (branch stays, swap the literal);
- `getLabels` (~L449 AND ~L452) — the literal TWICE in one return (`reason:` + interpolated in `instruction:`);
- `mutateLabel` (~L554 AND ~L557) — the literal TWICE (`reason:` + interpolated `#${issueNumber}: <literal>`);
- `parseJson` (~L652) — interpolated inside a `throw new Error(\`failed to ${action}: <literal>\`)`.

NOTE: the `result === undefined` branch in `createLabel` (~L615) returns `{ok:false}` with NO binary-missing literal — it is NOT a site to change. Match on the LITERAL string, not on `result === undefined` (several `undefined` branches carry no literal).

## What to build

Replace the inline duplications in `src/issue-provider.ts` with the shared exports, so `gh-failure.ts` is the genuine single source of truth — WITHOUT changing any user-visible message text or behaviour (the literals are byte-identical to `GH_BINARY_MISSING` today, so this is a pure dedup).

1. **Import `ghFailureDetail` and `GH_BINARY_MISSING`** from `./gh-failure.js` alongside the existing `ghFailureReason`.
2. **Collapse the two-arm guards** of the shape `result === undefined ? '`gh` is not available (binary missing).' : ghFailureReason(result)` to `ghFailureDetail(result)` (e.g. the `postIssueComment` ~L377-378 site). Where the surrounding code branches on `result === undefined` for OTHER reasons (different return shapes per arm, not just the string), keep the branch but replace the inline literal with `GH_BINARY_MISSING` so there is ONE definition of the string.
3. **For sites that INTERPOLATE the literal into a larger message** (the `getLabels` `instruction` ~L452, the `mutateLabel` `#${input.issueNumber}: <literal>` ~L557, and the `parseJson` `throw` ~L652 `failed to ${action}: <literal>`), reference `GH_BINARY_MISSING` as the sub-part (e.g. `` `#${input.issueNumber}: ${GH_BINARY_MISSING}` ``) so the message SHAPE is preserved byte-for-byte. The `parseJson` one is inside a `throw new Error(...)` — swap ONLY the literal sub-part; do NOT try to `ghFailureDetail`-collapse it (its `status !== 0` branch is a different message shape). For the DOUBLE-occurrence sites (`getLabels`, `mutateLabel`), replace BOTH the `reason:` literal and the interpolated `instruction:` literal.
4. **Leave behaviour + message text identical.** This is dedup only: no message wording changes, no control-flow changes beyond swapping the literal/two-arm for the shared symbol. Confirm by inspection that every replaced site produces the SAME output string as before.

## Scope

- IN: replace issue-provider.ts's ~7 inline binary-missing literals + the two-arm `undefined ? literal : ghFailureReason` guards with `GH_BINARY_MISSING` / `ghFailureDetail`; import them; preserve every message shape byte-for-byte.
- OUT: changing any user-visible message text or wording; changing the `mutateLabel` create-retry symptom-vs-cause behaviour (a SEPARATE nit, not this dedup); touching github.ts (already converged); changing `gh-failure.ts`'s exports; the `issue-provider` ratify-nits (those were spent and discharged separately).

## Acceptance criteria

- [ ] `src/issue-provider.ts` no longer contains any inline `'`gh` is not available (binary missing).'` LITERAL — every occurrence references `GH_BINARY_MISSING` (directly or via `ghFailureDetail`). Grep for the literal in `issue-provider.ts` returns ZERO hits.
- [ ] The two-arm `result === undefined ? <binary-missing> : ghFailureReason(result)` shape is replaced by `ghFailureDetail(result)` wherever the two arms differ ONLY in that string; where the branch carries other per-arm logic, the literal is replaced by `GH_BINARY_MISSING` (the branch may stay).
- [ ] Interpolated sites (`#${n}: …`, `failed to ${action}: …`) reference `GH_BINARY_MISSING` as the sub-part, preserving the exact message shape.
- [ ] NO user-visible message text changes (every replaced site emits the identical string as before — verified by the existing issue-provider/intake tests staying green, plus inspection). The shared module is now the sole definition of the binary-missing string.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — tiny, mechanical, self-contained dedup in one file using already-shipped shared exports.

## Prompt

> Make `src/gh-failure.ts` the GENUINE single source of truth for the `gh` binary-missing string. The module exports `GH_BINARY_MISSING` (the literal `'`gh` is not available (binary missing).'`) and `ghFailureDetail(result)` (`undefined ? GH_BINARY_MISSING : ghFailureReason(result)`). `src/github.ts` fully adopted them, but `src/issue-provider.ts` imports only `ghFailureReason` and keeps ~7 INLINE copies of the literal + the two-arm guard \u2014 the exact drift the module was built to kill. Converge issue-provider onto the shared exports WITHOUT changing any message text or behaviour (the literals are byte-identical today \u2014 pure dedup).
>
> BUILD: import `ghFailureDetail` + `GH_BINARY_MISSING` from `./gh-failure.js`. Replace each `result === undefined ? '`gh` is not available (binary missing).' : ghFailureReason(result)` with `ghFailureDetail(result)`; where the `undefined` branch carries OTHER per-arm logic, keep the branch but swap the inline literal for `GH_BINARY_MISSING`; for sites that INTERPOLATE the literal into a bigger message (`#${n}: …`, `failed to ${action}: …`), reference `${GH_BINARY_MISSING}` as the sub-part so the shape is byte-identical. NO wording/behaviour changes.
>
> READ FIRST: `src/gh-failure.ts` (`GH_BINARY_MISSING`, `ghFailureDetail`, `ghFailureReason` \u2014 the exports to adopt); `src/issue-provider.ts` (the 7 literal occurrences across 5 fns: `postIssueComment` ~L378 [two-arm to ghFailureDetail], `closeIssue` ~L410, `getLabels` ~L449+L452 [TWICE], `mutateLabel` ~L554+L557 [TWICE, one interpolated], `parseJson` ~L652 [interpolated in a throw]; NOTE `createLabel` ~L615's undefined branch has NO literal, skip it \u2014 verify line numbers); `src/github.ts` (the FULLY-converged reference for how to use the pair). Source signal: `work/observations/review-nits-github-provider-surface-real-gh-cause-2026-06-11.md` (nit #2).
>
> SCOPE FENCE: dedup ONLY \u2014 no message text changes, no control-flow changes beyond swapping the literal/two-arm for the shared symbol; do NOT touch the `mutateLabel` create-retry symptom-vs-cause behaviour (a separate nit); do NOT touch github.ts or gh-failure.ts's exports. "Done" = grep for the binary-missing LITERAL in issue-provider.ts returns zero hits (all via `GH_BINARY_MISSING`/`ghFailureDetail`), every message is byte-identical, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

### Claiming this slice

```sh
agent-runner claim converge-issue-provider-onto-gh-failure-module --arbiter origin
git fetch origin && git switch -c work/converge-issue-provider-onto-gh-failure-module origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/converge-issue-provider-onto-gh-failure-module.md work/done/converge-issue-provider-onto-gh-failure-module.md
```
