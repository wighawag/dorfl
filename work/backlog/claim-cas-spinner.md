---
title: Show a spinner animation while claim-cas runs
slug: claim-cas-spinner
issue: 138
origin: issue
originTrust: trusted
covers: []
blockedBy: []
---

## What to build

When the standalone `agent-runner claim <slug>` CLI command invokes the claim-cas flow (the git push that does the atomic CAS against the arbiter's `main`), the user currently sees nothing until it returns. The push can take a few seconds (network + arbiter round-trip), so the terminal looks frozen.

Add a lightweight terminal spinner animation that runs while the claim-cas operation is in flight on that command, and stops cleanly when the operation resolves (success, lost-race, contended, or error). The spinner is purely a UX affordance on the `claim` CLI surface — the underlying `claim-cas.ts` logic, exit codes, and seam contract do not change, and the AUTONOMOUS call sites of `performClaim` (`do`, `run`, `start`, `work-on`, `continue-branch`/resume) are OUT OF SCOPE for this slice and MUST NOT be wrapped.

## Acceptance criteria

- While `agent-runner claim <slug>` is running with `process.stdout.isTTY === true`, a single-line spinner animates on stderr next to a short label (e.g. `Claiming <slug>…`).
- On completion in TTY mode the spinner line is cleared (cursor restored, no leftover frames) and replaced with ONE terminal status line on stderr describing the outcome — claimed / not-claimable / contended / error — consistent with the existing exit-code semantics (0/2/3/1) and reusing `result.message` where available.
- The `note` callback the `claim` CLI passes into `performClaim` (today: `console.error('>> ' + message)`) keeps writing each note as its OWN clean stderr line. In TTY mode the spinner wrapper coordinates with `note` by clearing the current spinner frame before the note write and redrawing the frame after, so notes and frames never trample each other; in non-TTY mode `note` behaves exactly as today.
- When stdout is NOT a TTY (CI, piped, redirected), the spinner is fully suppressed AND the command's observable stdout/stderr stays byte-identical to today's behaviour: silent on success, `error: <result.message>` on failure, and any `>> <note>` lines unchanged. No new status line is introduced in non-TTY mode, so existing CLI tests and CI log scrapers do not break.
- The spinner is torn down on SIGINT and on thrown errors (cursor unhidden, animation interval cleared, no orphaned ANSI state) before the process exits.
- No other `performClaim` call site is modified: `do.ts`, `run.ts`, `start.ts`, `work-on.ts`, `continue-branch.ts` keep their current behaviour.
- Existing `claim-cas` unit tests still pass unchanged; a new test covers the TTY-vs-non-TTY branching of the spinner wrapper via injected seams (writable stream + `isTTY` flag + clock/`setInterval` fake), with no real timers and no real TTY in CI. The test also covers the note-interleaving contract: a `note` arriving mid-spin in TTY mode produces a clean `>> <msg>\n` line with no spinner-frame characters spliced into it.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Prompt

Wrap ONLY the `agent-runner claim <slug>` command's `performClaim` call (in `packages/agent-runner/src/cli.ts`) with a small spinner helper. Put the helper in a new isolated module (e.g. `packages/agent-runner/src/cli-spinner.ts`) that takes its `stream`, `isTTY`, and clock (`setInterval`/`clearInterval` or equivalent) as injected seams so it is unit-testable without real timers or a real TTY. The helper must expose a way for the caller to route the `note` callback through it (so in TTY mode the wrapper clears the current frame, writes the note line, then redraws; in non-TTY mode the helper is a no-op and `note` writes directly as today). Default the helper to the non-TTY path in tests so the suite stays deterministic. Do not touch `claim-cas.ts`'s return contract, exit codes, or any of the other `performClaim` call sites. In non-TTY mode the spinner is a no-op and the CLI's stdout/stderr must remain byte-identical to today (silent on success; `error: <message>` on failure; existing `>> <note>` lines unchanged) — the new TTY status line is a TTY-only affordance.
