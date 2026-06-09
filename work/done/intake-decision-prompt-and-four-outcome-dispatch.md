---
title: intake decision PROMPT asset + the full four-outcome dispatcher (ask / prd / bounce branches on top of the slice tracer)
slug: intake-decision-prompt-and-four-outcome-dispatch
prd: issue-intake
blockedBy: [intake-tracer-slice-outcome]
covers: [2, 3, 4, 5, 8]
---

## What to build

Complete the `intake` engine to the FULL four-outcome decision. The tracer slice (`intake-tracer-slice-outcome`) wired the `slice` branch; this slice authors the real **decision prompt** (an INLINE prompt builder — see below) and completes the dispatcher's other three branches (`ask`, `prd`, `bounce`) — still against STUBBED verdicts (the prompt's judgement is NOT unit-tested; only the dispatch is).

End-to-end behaviour after this slice (the canonical decision table — see the PRD):

- **ASK** (not clear enough to act on — the `to-slices`/`needsAnswers` bar: "would I build the wrong thing if I guessed?"): dispatcher calls `postIssueComment` with the next clarifying question, emits NOTHING, STOPS. (A later run resumes from the updated thread.)
- **SLICE** (clear AND fits ONE tracer-bullet slice): UNCHANGED from the tracer — write `work/backlog/<slug>.md` (`covers: []`, no `prd:`) + `Fixes #N`, integrate.
- **PRD** (clear AND coherent but needs >1 slice — INCLUDES a coupled-but-SMALL pair, which is NEVER bounced): write `work/prd/<slug>.md` with `issue: N`, integrate, and STOP (slicing is the separate `do prd:` step). The artifact carries its own gate axes (`humanOnly`/`needsAnswers`) as the prompt judged them.
- **BOUNCE** (genuinely multiple UNRELATED concerns — no single shared vision): `postIssueComment` "please file separate issues", emit NOTHING, leave the issue open.

The **decision prompt** is an INLINE prompt builder (a function returning the prompt string, like `buildSlicingBrief` in `slicing.ts` and the reviewer prompts in `review-gate.ts`) — NOT a standalone asset/`.md` file (no such convention exists in `packages/agent-runner/src`). It encodes the decision aids stated once in the PRD:

- "clear?" bar = the `to-slices`/`needsAnswers` bar (don't guess a spec from a vague issue → ASK);
- "one slice?" bar = `to-slices`' tracer-bullet test (fits → SLICE; needs splitting → PRD);
- PRD vs BOUNCE turns on a SHARED VISION: coupled (even if small) → PRD; unrelated → BOUNCE. Size never forces a bounce — only unrelatedness does (the over-bounce guard).

The agent only DRAFTS (verdict + drafted content / comment text); the runner owns all git/seam side-effects. PRD-emit carries `issue: N` — and this slice ALSO extends `frontmatter.ts` to PARSE `issue: number` (PRD-only) so the written number is MACHINE-READABLE, not dead text (today `frontmatter.ts` parses only `slug`/`prd`/`humanOnly`/`needsAnswers`/`blockedBy`/`sliceAfter`). The issue number lives ONLY on the PRD; slices reach it via `slice.prd: → work/prd/<prd>.md → PRD `issue:``(NO slice-level`issue:`field — the PRD decided this in Out of Scope: duplicating it would invite a premature`Fixes #N`close on the first of N fanned merges). A lone slice carries`Fixes #N`; PRD-fanned slices later carry `Refs #N`— the loop-closure linkage whose consuming close JOB is`runner-in-ci`'s.

## Acceptance criteria

- [ ] STUBBED `ask` verdict → dispatcher calls `postIssueComment` with the question text and emits NO artifact (assert: a comment posted, no `work/backlog` or `work/prd` file written, no integrate).
- [ ] STUBBED `prd` verdict → writes `work/prd/<slug>.md` (content-derived slug) with `issue: N`, integrates via `performIntegration`, and stops (no slicing). The PRD's gate axes (`humanOnly`/`needsAnswers`) are surfaced as the verdict carried them.
- [ ] `frontmatter.ts` is extended to PARSE `issue: number` (PRD-only) with a test, so the `issue: N` the PRD-emit writes is machine-readable (the close JOB — `runner-in-ci`'s — reaches it via `slice.prd: → PRD issue:`). NO slice-level `issue:` field is added (the PRD decided against it in Out of Scope).
- [ ] Gate axis note (deliberate): `humanOnly: false` (omitted) is intentional — the build-nature is an inline prompt builder + a stubbed-verdict dispatcher, and `intake` is gate-free. A deliberate per-slice decision, not an oversight, notwithstanding the PRD's lean toward `humanOnly` for the prompt.
- [ ] STUBBED `bounce` verdict → `postIssueComment` "file separate issues", emits NO artifact, leaves the issue open (no close — closing is CI's, out of scope).
- [ ] STUBBED `slice` verdict → unchanged from the tracer (regression guard).
- [ ] The decision PROMPT asset exists as a prose asset (alongside the build/slicer/ review prompts) and encodes the three decision aids; its JUDGEMENT is NOT unit-tested (only the dispatch is, like the review prompt).
- [ ] The agent does NO git/seam side-effects (returns verdict + drafted content); the runner/dispatcher performs every postComment / write / integrate.
- [ ] Tests STUB the seam + `gh` throughout (no network); mirror the repo's existing style.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `intake-tracer-slice-outcome` — provides the command, the issue seam, the prompt→verdict→dispatch shape, and the `performIntegration` wiring this slice extends (same dispatcher + command-grammar modules).

## Prompt

> Complete `intake`'s dispatcher to the FULL four-outcome decision and author the real decision PROMPT asset. The tracer slice (`intake-tracer-slice-outcome`, in `work/done/` when you run) wired the `slice` branch; add `ask`, `prd`, `bounce` against STUBBED verdicts (the prompt's JUDGEMENT is NOT unit-tested — only the dispatch is, exactly as the review prompt's judgement is not) (US #2, #3, #4, #5, #8).
>
> THE CANONICAL DECISION TABLE (from `work/prd-sliced/issue-intake.md` — the source of truth; the PROMPT encodes it):
>
> - ASK = not clear enough to act on (the `to-slices`/`needsAnswers` "would I build the wrong thing if I guessed?" bar) → `postIssueComment` the next clarifying question; emit nothing; STOP.
> - SLICE = clear AND fits ONE tracer-bullet slice → (unchanged) write `work/backlog/<slug>.md` + `Fixes #N`, integrate.
> - PRD = clear AND coherent but >1 slice — INCLUDING a coupled-but-SMALL pair (NEVER bounced) → write `work/prd/<slug>.md` with `issue: N`, integrate, STOP.
> - BOUNCE = genuinely multiple UNRELATED concerns (no shared vision) → `postIssueComment` "file separate issues", emit nothing, leave the issue open.
> - PRD vs BOUNCE turns on a SHARED VISION (coupled→PRD; unrelated→BOUNCE). Size NEVER forces a bounce — only unrelatedness (the over-bounce guard).
>
> WHAT TO BUILD:
>
> 1. The decision prompt as an INLINE prompt builder (a function returning the prompt string, like `buildSlicingBrief` in `src/slicing.ts` / the reviewer prompts in `src/review-gate.ts` — NOT an asset/`.md` file; no such convention exists) encoding the three decision aids above. Reference `to-slices`/`to-prd` for the "clear?"/"one slice?" criteria and the slice/PRD shapes it drafts. 1b. Extend `src/frontmatter.ts` to PARSE `issue: number` (PRD-only) so the `issue: N` written on a PRD-emit is machine-readable (the close JOB consumes it via `slice.prd: → PRD issue:`). Do NOT add a slice-level `issue:` field (the PRD's Out of Scope decided against it — it would invite a premature `Fixes #N` close on the first of N fanned merges).
> 2. The dispatcher branches: `ask`/`bounce` → `postIssueComment` + emit nothing; `prd` → write `work/prd/<slug>.md` (`issue: N`) + integrate + STOP, surfacing the PRD's gate axes as the verdict judged them.
> 3. Keep the agent DRAFT-only (verdict + drafted content / comment text); the runner owns every postComment / write / integrate (the in-band boundary).
>
> SEAM TO TEST AT: the DISPATCHER with STUBBED verdicts (one per outcome). Assert each verdict drives the right action: ask → comment + no emit; prd → `work/prd/` file + `issue: N` + integrate + stop; bounce → comment + no emit + issue stays open; slice → unchanged. STUB the seam + `gh` throughout.
>
> SCOPE FENCE: do NOT build the per-outcome mode KNOBS (`intake-per-outcome-integration-modes` — default propose is fine here), the processing LOCK, event-classification, or the "PRD complete?" query (separate slices). Do NOT close the issue on bounce or anywhere (closing is `runner-in-ci`'s close JOB). Do NOT slice the emitted PRD (that is the separate `do prd:` step). Do NOT add a label state-machine (ADR §12). Do NOT build any CI/policy.
>
> FIRST run the drift check: confirm `intake-tracer-slice-outcome` landed the command, the issue seam (`getIssue`/`listComments`/`postIssueComment`), and the slice-branch dispatcher as specified. If the dispatcher seam landed differently, reconcile against it (extend, don't fork) — and if a premise is genuinely broken, route to `needs-attention/` with the discrepancy rather than building on a stale premise.
>
> "Done" = all four outcomes dispatch correctly under stubbed verdicts, the decision PROMPT asset exists, the agent does no git/seam ops, the issue is never closed, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.
