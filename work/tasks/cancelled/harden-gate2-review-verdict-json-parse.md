---
title: Harden the Gate-2 review verdict JSON parse
slug: harden-gate2-review-verdict-json-parse
reason: superseded-by-done — the landed task `harden-gate2-verdict-parse-against-malformed-json` (#246, commit 7083fe65, + the surface-share follow-up 7737b3a2) already delivers all three directions of this task's scope: (1) route-not-crash — `runGate2Review` catches `ReviewParseError` and routes to needs-attention via `applyNeedsAttentionTransition` with the distinct `review-unparseable` outcome (integration-core.ts) mapped to the `transient-infra` cause; (2) the lenient control-char repair pass in `parseReviewVerdict` (review-verdict.ts); (3) the strict-minified / eliminate-inner-quotes / length-cap prompt contract. Verified on main 2026-07-11: `review-unparseable` + the repair pass + the branch-preserving route are all present. No residual scope remains distinct from the done task.
---

> **CANCELLED 2026-07-11 (ready-pool analysis).** Premise already fixed by a landed sibling; see `reason:` above. Retained here (not deleted) per the work contract — a task leaves via the `cancelled/` terminal, with the reason in the body.

## Context

Gate-2's review verdict parser (`parseReviewVerdict` in `packages/dorfl/src/review-verdict.ts:106-119`) does a strict `JSON.parse` of the review agent's verdict with no salvage/repair, no per-finding length cap, and no retry. On large-diff builds the agent's verdict occasionally contains an unescaped control character, a raw newline inside a string, or an over-long field, and `parseReviewVerdict` throws `ReviewParseError`. That throw is NOT caught/routed inside `runGate2Review` in `integration-core.ts`, so it crashes the whole `do` run as an unhandled exception AFTER a fully green Gate-1 acceptance build.

The crash has recurred 8+ times, always after a green Gate-1 build, always on the largest diffs of a drive. Symptoms per occurrence:

- error like `review verdict was not valid JSON: Expected ',' or '}' after property value in JSON at position 8101 (line 7 column 4811)` (deep into a ~7.5k-8.1k byte payload).
- Orphaned `active` lock on origin + mirror.
- Work branch NOT pushed to origin; the green build survives only on the hub mirror branch.
- No PR opened.
- Manual recovery: push the kept mirror branch to origin, `requeue` (keep+continue), clear the mirror lock by hand, re-`do` (which takes the "recovered stranded already-complete branch" path and opens the PR WITHOUT re-running Gate-1/Gate-2), then a full manual Gate-3 + gate re-verify because Gate-2 never actually ran on the merged PR.

## Scope

Three fix directions, all in scope for this one task.

### 1. Make the verdict parse fault-tolerant (never an unhandled throw, never a silent approve)

- In `parseReviewVerdict` (or a wrapping call site), catch the strict `JSON.parse` failure instead of letting `ReviewParseError` propagate out of `runGate2Review`.
- At the `runGate2Review` call site in `integration-core.ts`, route a parse failure to **needs-attention** with a `transient-infra` / `config-error` cause (the work is fine; the gate misbehaved). Explicitly NOT an approve, NOT a review-blocked verdict authored by the model — it is a gate-infrastructure failure.
- Preserve the raw verdict text and the parse error (position, message) in the needs-attention payload so the conductor can diagnose without re-running.

### 2. Harden the review agent's output contract

- Update the review prompt to require STRICT minified JSON: no trailing commas, escaped control characters, no raw newlines inside strings.
- Cap per-finding length (e.g. truncate long `message`/`detail` fields with an explicit `…[truncated]` marker) so a single huge finding cannot blow past a size the model reliably escapes.
- Before the strict `JSON.parse`, do a fenced-block extraction (pull the JSON out of a ```json fence if present) followed by a lenient repair pass (strip/escape stray control chars, close an obviously unterminated string/object, etc.). Strict parse remains the source of truth; the repair pass is a best-effort salvage before we give up and route to needs-attention.

### 3. On a parse crash, do not strand the branch

Once (1) is in place and the throw is caught, the needs-attention routing MUST:

- PUSH the kept work branch to origin (so recovery does not require a manual mirror→origin push).
- Mark the lock stuck (not orphaned `active`) so `requeue`/recovery treats it as a known-bad gate run, not a crashed process.

This is a follow-on inside the same task, not a separate task: the whole point of catching the throw is to make recovery automatic.

## Acceptance

- Unit tests for `parseReviewVerdict` covering: valid strict JSON, JSON in a ```json fence, JSON with stray control chars / raw newlines inside strings (repair pass salvages), and unrecoverable garbage (returns a structured parse-failure, does NOT throw out of `runGate2Review`).
- Integration-level test (or a targeted test around `runGate2Review`) that simulates a malformed verdict and asserts: no unhandled throw, routed to needs-attention with `transient-infra`/`config-error` cause, work branch pushed to origin, lock marked stuck.
- Review-prompt change lands with the strict-minified-JSON + escape + per-finding-cap contract, and the prompt is exercised by at least one test/fixture showing the contract text is present.
- `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Out of scope

- Redesigning Gate-2 itself or the review agent's verdict schema beyond the output-contract hardening above.
- Broader gate-robustness sweep across Gate-1/Gate-3 (file a separate signal if similar unhandled throws exist there).

## Prompt

> Build the task 'harden-gate2-review-verdict-json-parse', described above.
