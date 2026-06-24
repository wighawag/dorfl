---
title: intake-lock-failure-semantics-and-real-cause — surface the REAL gh cause on a lock-op failure, FAIL (don't silently degrade) when a meaningful lock is unacquirable, create the lock label on first use, and harden release-on-interruption
slug: intake-lock-failure-semantics-and-real-cause
covers: []
---

> Self-contained FIX slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. It FIXES a bug in the already-`done/` slice `intake-processing-lock` (PRD `issue-intake` US #10 is the durable spec it sits on). The source signal (an observation: the degrade misattributed every `gh` failure as "unauthenticated" and silently proceeded lock-less) was discharged by this fix and DELETED — git history is its archive.

## What to build

The `intake <N>` processing-lock (`src/issue-provider.ts` label ops + `src/intake.ts` acquire/release) collapsed every non-zero `gh` exit into a single hard-coded "`gh` is unavailable or unauthenticated" message + a silent best-effort degrade. On a fresh repo (the lock label `dorfl:processing` never created) this both MISATTRIBUTED the cause and proceeded lock-less. Fix the lock's failure semantics end-to-end:

1. **Surface the REAL cause.** The label-op result carries the actual `gh` stderr (e.g. `'dorfl:processing' not found`), never a hard-coded auth guess — so the cause is diagnosable.
2. **FAIL, don't silently degrade, when a MEANINGFUL lock is unacquirable.** The label ops gain a three-way outcome — `applied` / `unsupported` / `failed`:
   - **already held by another run** → back off (`locked`, exit 0). _(unchanged)_
   - **`unsupported`** (provider has NO label concept at all) → the ONLY legitimate degrade-to-best-effort (the spec's provider-pluggability; a non-GitHub provider without labels).
   - **`failed`** (a label-supporting provider's op failed for a real reason — `gh` missing/unauthenticated, a permissions error) → FAIL the run (`lock-failed`, exit 1) with the real cause, rather than proceed lock-less (which would let a concurrent run race it).
3. **Create the lock label on first use.** On a fresh repo `gh issue edit --add-label` fails with `'<label>' not found`; the adapter CREATES the label (`gh label create`) and RETRIES the add, so the lock works from the first run.
4. **Harden release-on-failure, including interruption.** The existing `finally` covers exceptions; a SIGINT/SIGTERM handler best-effort-releases the lock before exit, and any non-confirmed release surfaces the manual recovery command (`gh issue edit <N> --remove-label '<label>'`) so a leaked lock is both recoverable and discoverable.

The agent stays label-free; the RUNNER owns the label ops (the in-band boundary, unchanged). This is NOT a `work/` CAS and NOT a label state-machine (ADR §12) — still ONE transient lock label.

## Acceptance criteria

- [x] A failed label op surfaces the REAL `gh` stderr (a `reason` field on the result), never the hard-coded "unavailable or unauthenticated" string.
- [x] The lock READ / ACQUIRE distinguishes `unsupported` (degrade) from `failed` (fail): a `failed` outcome on a label-supporting provider returns `lock-failed` (exit 1) and does NOT run the decision / emit anything.
- [x] A genuinely-`unsupported` provider still DEGRADES to best-effort (proceeds without the lock, surfaced) — point-4 of the spec preserved.
- [x] The "lock already held" back-off (`locked`, exit 0) is unchanged.
- [x] On a fresh repo (`gh` reports the label `not found`), `addLabel` creates the label then retries the add (asserted via the stubbed `ghBin`).
- [x] The lock is RELEASED on success, on handled failure (`finally`), and a release failure surfaces the manual `gh issue edit <N> --remove-label` recovery; a SIGINT/SIGTERM handler best-effort-releases before exit.
- [x] Tests STUB `gh` via the injectable `ghBin` and the stubbed issue seam (no network, no real GitHub) — the same mechanism the existing intake tests use.
- [x] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None. (Fixes code already in `work/done/intake-processing-lock.md`.)

## Decisions

Settled at build time (no open questions — `needsAnswers` omitted):

- **Fail-vs-degrade is keyed on provider capability, not on the error.** The ONLY legitimate degrade is a provider with NO label concept (`unsupported`). Any failure on a provider that DOES support labels is `failed` → the run fails rather than proceeding lock-less. (Maintainer decision: a meaningful lock that cannot be taken must back off / fail, never silently proceed.)
- **Create the lock label on first use** (`gh label create` then retry the add) rather than treating a missing label as a hard failure. Settled by the maintainer: the natural fix that makes a fresh repo lockable from the first run, with no manual `gh label create`. A concurrent create loses harmlessly ("already exists" is treated as success).
- **Interruption-safety = signal handler + discoverable manual recovery.** The `finally` handles exceptions; SIGINT/SIGTERM installs a best-effort synchronous release before re-raising the signal's default disposition; and because a signal handler cannot confirm the async release, the run ALWAYS surfaces the manual `gh issue edit <N> --remove-label '<label>'` recovery on any non-confirmed release. This meets the floor "a leaked lock must be recoverable AND that recovery must be discoverable" without introducing a steal/expiry mechanism. (Candidate ADR if a future reader would wonder why we did not add a lock-expiry/steal protocol — the why is "the lock is a transient best-effort mutex, not a `work/` CAS; a heavyweight expiry protocol is out of proportion". Left as a slice decision pending a maintainer-supplied ADR why.)

## Prompt

> Fix `intake`'s processing-lock failure semantics (the lock in `src/intake.ts` `performIntake` + the label ops in `src/issue-provider.ts`). Source: `work/observations/intake-lock-degrade-misattributes-gh-failure-and-silently-proceeds.md`; spec: `work/prd-sliced/issue-intake.md` US #10; the slice it fixes: `work/done/intake-processing-lock.md`.
>
> DRIFT CHECK FIRST: confirm `mutateLabel`/`getLabels` still collapse every gh failure into "unavailable or unauthenticated" + a silent degrade. If already three-way (`applied`/`unsupported`/`failed`) with the real stderr surfaced, this slice is done.
>
> WHAT TO BUILD: (1) carry the REAL gh stderr in the label-op result (`reason`), never a hard-coded guess; (2) three-way outcome — `unsupported` degrades, `failed` makes `performIntake` return `lock-failed` (exit 1) WITHOUT deciding or emitting; keep the "already held" back-off (`locked`, exit 0); (3) `addLabel` creates the lock label (`gh label create`) on a `not found` then retries; (4) release on success/handled-failure (`finally`) AND on SIGINT/SIGTERM (a handler that best-effort-releases then re-raises), surfacing the manual `gh issue edit <N> --remove-label '<label>'` recovery on any non-confirmed release.
>
> SCOPE FENCE: ONE transient lock label only — no lifecycle state in labels, no state-machine (ADR §12). The RUNNER owns the label ops; the agent stays label-free. Do NOT build CI's per-issue concurrency group (`runner-in-ci`).
>
> SEAM TO TEST AT: the stubbed issue seam + the injectable `ghBin`. Assert: real stderr surfaced (e.g. a 403, NOT "unauthenticated"); a label-supporting failure → `lock-failed` (decision never ran); an unsupported provider still degrades; create-on-first-use (the `not found` → `gh label create` → retry path); a release failure surfaces the manual recovery hint.
>
> "Done" = the real cause is surfaced, a meaningful-but-unacquirable lock FAILS (not silent degrade), an unsupported provider still degrades, a fresh repo is lockable, release is robust on failure + interruption + discoverable, and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
