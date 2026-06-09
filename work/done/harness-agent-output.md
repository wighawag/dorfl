---
title: harness-agent-output — capture an agent invocation's final assistant message at launch and return it in LaunchResult (Option C), per-adapter from its native channel
slug: harness-agent-output
prd: review
blockedBy: []
covers: []
---

## What to build

Give the harness seam a way to surface **an agent invocation's final output** (the agent's last assistant message), so callers that need the agent's _answer_ — not just its side effects — can read it. Today the seam (`LaunchResult = {ok, record, detail?}`) carries only success + the liveness record + `stderr`-on-failure; there is **no channel for the agent's output on success**. The `review` Gate-2 wiring (`review-gate.ts` `harnessReviewGate`) already needs this: it reads `readOutput(launched.detail)`, which is **empty on success**, so a live `review: on` run would parse an empty string → `ReviewParseError` → needs- attention on every run. This slice closes that gap.

### The decision (made 2026-06-06 — Option C; do not relitigate)

A research pass compared how harnesses expose an agent's final output:

- **pi** (`--print --session <file.jsonl>`): the canonical output is the **session `.jsonl`** (assistant `message` records); stdout is drained. The repo already parses this exact shape in `watch-session.ts`.
- **opencode** (`opencode run`, `--format json`): output is a **live stdout stream** (nd-JSON events / plain text), **gone after the process exits** unless captured (or re-read via the separate `export`/`serve` HTTP path). Real issues show `run` stdout is buffering-prone and has had silent-empty regressions — so "read stdout later" is fragile, and there is no plain on-disk file like pi's.

Because opencode's output is a stream that does not persist as a readable record, the cross-harness shape is **Option C: each adapter EXTRACTS the final assistant message DURING / at the end of its own launch and returns it in `LaunchResult`** — NOT a populate-from-stdout field (Option A, rejected: pi doesn't use stdout, opencode's is fragile), and NOT a read-later-from-record method (Option B, rejected: opencode has no persisted record to re-read). The seam stays uniform (`LaunchResult.output`); the _extraction_ is per-adapter from its native channel.

### Concretely

- **Extend `LaunchResult`** (`src/harness.ts`) with an optional **`output?: string`** = the agent's final assistant message (the concatenated `text` of the LAST assistant turn), or `undefined` when none/none-parseable. Document it as the agent's ANSWER channel (distinct from `detail`, which stays the failure/`stderr` channel).
- **pi adapter** (`src/pi-harness.ts`, BOTH `launch` and `launchAsync`): after the pi process exits, read the session `.jsonl` it just wrote (the path is already in `record.session` / `resolveSessionFile`) and extract the **last assistant message's `text` parts**. REUSE the existing `.jsonl` decoding in `watch-session.ts` (the `{type:"message", message:{role:"assistant", content:[{type:"text"|...}]}}` walk) — do NOT write a second parser; factor a small shared "last assistant text" reader from that module's `assistantLines` logic (or call a new exported helper there) so the watch view and the output reader stay one source of truth. `launchAsync` already runs pi async for `--watch`; read the `.jsonl` at `close` the same way `launch` does at return.
- **null/shell adapter** (`src/harness.ts` `NullHarness`): it `spawnSync`s a shell command and already CAPTURES `result.stdout` (currently unused) — return that (trimmed) as `output`. For the null/shell adapter the command's stdout IS its output (trivially correct; no stream-fragility caveat applies to a synchronous captured spawn).
- **opencode adapter:** NOT built here (no opencode adapter exists yet). The research is recorded so that whenever an opencode adapter lands, it implements `output` by capturing its `--format json` stream and taking the last assistant `text` part — the SAME `LaunchResult.output` contract. State this as the forward-contract; do not stub a fake adapter.
- **Wire it through to the review gate:** change `harnessReviewGate` (`src/review-gate.ts`) to read `launched.output` (falling back to its injected `readOutput` for tests) instead of `launched.detail`. With this, a live `review: on` run gets the real verdict text. (Keep the `readOutput` injection point so tests still stub a canned verdict string.)

### Scope fence

- IN: the `LaunchResult.output` field; pi `launch`/`launchAsync` populating it from the `.jsonl` (reusing `watch-session.ts`); null/shell populating it from captured stdout; the review-gate read-site switched to `launched.output`.
- OUT: an opencode adapter (forward-contract only); changing pi's liveness or `--watch` parsing (untouched — this only ADDS a last-message read); any reshaping of how `detail` works on failure (unchanged).

## Acceptance criteria

- [ ] `LaunchResult` carries `output?: string` documented as the agent's final assistant message (the answer channel), distinct from `detail` (failure channel).
- [ ] The pi adapter's `launch` AND `launchAsync` populate `output` with the LAST assistant message's concatenated `text` from the session `.jsonl` it wrote; `undefined` when the log has no assistant text / is absent. The `.jsonl` decoding is SHARED with `watch-session.ts` (one parser, not two).
- [ ] The null/shell adapter populates `output` from the captured command stdout (trimmed); `undefined` when empty.
- [ ] `harnessReviewGate` reads `launched.output` (test-injectable `readOutput` retained); a stubbed launch returning a verdict in `output` parses correctly, and an empty `output` is the `ReviewParseError`→needs-attention path (no silent approve).
- [ ] Existing callers of `launch`/`launchAsync` (`do.ts`, `run.ts`) are unaffected (they read `ok`/`detail`); `output` is additive (optional).
- [ ] Tests cover: pi `.jsonl` → last-assistant-text extraction (incl. multi-part text, a tool-call-only turn → no text, an absent/short log → undefined); null/shell stdout capture; the review-gate read-site against `launched.output`. Stub the pi binary / shell (no real model, no network).
- [ ] **Test isolation (shared-write-location rule, WORK-CONTRACT):** any test that writes a `.jsonl` does so under a temp/scratch dir and asserts the real pi sessions dir (`~/.pi/agent/sessions`) is UNTOUCHED (reuse the existing `isolatePiAgentDir` helper).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — startable now. (`review-gate-pr` is independent; it FUNCTIONS live only once this lands, but it does not block this slice — this slice fixes its read-site.)

## Prompt

> Give the harness seam an OUTPUT channel: capture an agent invocation's FINAL assistant message at launch and return it in `LaunchResult.output` (Option C — decided 2026-06-06; see this slice's "The decision"). This unblocks the live `review` Gate 2: `harnessReviewGate` currently reads `launched.detail`, which is EMPTY on success, so a real `review: on` run never sees the verdict.
>
> FIRST run the drift check (launch snapshot — verify against what landed):
>
> - Confirm `src/harness.ts` `LaunchResult` is still `{ok, record, detail?}` and `NullHarness.launch` captures `result.stdout` (presently unused) — you return it (trimmed) as `output`.
> - Confirm `src/pi-harness.ts` `launch` (spawnSync) and `launchAsync` (spawn, for `--watch`) both write the session `.jsonl` whose path is `resolveSessionFile` / `record.session`. You read that file AFTER the process exits and extract the last assistant message's text.
> - Confirm `src/watch-session.ts` decodes the pi `.jsonl` shape (`formatWatchEvent` / `assistantLines`: `{type:"message", message:{role:"assistant", content:[{type:"text"|"toolCall"|"thinking"}]}}`). REUSE it — factor/export a "last assistant text" helper there; do NOT write a second `.jsonl` parser (one source of truth).
> - Confirm `src/review-gate.ts` `harnessReviewGate` reads `readOutput(launched.detail)` — switch it to `launched.output` (keep the `readOutput` injection for tests). Route to needs-attention on any real discrepancy (WORK-CONTRACT "Drift is a needs-attention signal").
>
> Then implement: add `output?: string` to `LaunchResult` (document it as the agent ANSWER channel, distinct from `detail`); pi `launch`+`launchAsync` populate it from the `.jsonl` via the shared `watch-session.ts` reader (last assistant text, undefined when none); null/shell populates it from captured stdout; switch the review-gate read-site to `launched.output`. Leave `do.ts`/`run.ts` callers untouched (they use `ok`/`detail`; `output` is additive).
>
> NOTE (recorded debt — do NOT fix here): pi relies on `.jsonl` scraping in several places (liveness, `--watch`, and now output). That reliance is flagged for a future pi-harness-polish pass (`work/observations/pi-harness-jsonl-reliance.md`); this slice just REUSES the existing parser, it does not revisit the approach.
>
> READ FIRST: `src/harness.ts` (`LaunchResult`, `NullHarness.launch`); `src/pi-harness.ts` (`launch`, `launchAsync`, `resolveSessionFile`, `PiHarnessRecord.session`); `src/watch-session.ts` (the `.jsonl` decoder to reuse); `src/review-gate.ts` (`harnessReviewGate` read-site); ADR §5 (the harness seam) + §13 (model routing — unrelated here, but the same seam). For opencode (NOT built here) the forward-contract is: an opencode adapter populates `output` from its `--format json` stream's last assistant `text` part.
>
> TDD with vitest, house style (stub pi binary / shell, temp `.jsonl` under a scratch dir, `isolatePiAgentDir`): pi last-assistant-text extraction (multi-part text; tool-only turn → no text; absent/short log → undefined); null/shell stdout capture; the review gate reads `launched.output`; the real `~/.pi/agent/sessions` is untouched. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim harness-agent-output --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/harness-agent-output <remote>/main
git mv work/in-progress/harness-agent-output.md work/done/harness-agent-output.md
```
