---
title: agent prompt gains a CONTINUE-context block when re-claiming work-in-progress (prior diff + needs-attention reason + requeue handoff note); fresh path unchanged
slug: agent-prompt-continue-context
prd: command-surface-phase-2
blockedBy: [requeue-continue-and-reset]
covers: []
---

## What to build

Once `requeue` continues from the existing `work/<slug>` branch (the `requeue-continue-and-reset` slice), a re-claimed agent lands on a branch that ALREADY carries prior work — but today's canonical wrapper assumes a FRESH start ("read the slice, implement it"). The continuing agent needs to know it is continuing, and be given the handoff context, or it may redo/undo good work or be confused by half-built state.

**Adapt the prompt ONLY in continue-mode** (do NOT change the fresh-start prompt — keep the common case byte-identical). This is a **prompt-ASSEMBLY** change (`src/prompt.ts` / `buildAgentPrompt`), NOT a change to the canonical wrapper in `CLAIM-PROTOCOL.md` (which stays the unconditional fresh-start frame). The runner detects continue-mode and injects a CONTINUE block:

- **Detection (runner-side, cheap):** it is a continue iff the `work/<slug>` branch exists on the arbiter AHEAD of `main` (prior commits to build on) — the SAME detection the `requeue-continue-and-reset` claim/start path uses. Reuse it; do not re-derive.
- **The injected CONTINUE block carries the full handoff:**
  - _You are CONTINUING prior work on this slice, not starting fresh._ Review the existing diff of `work/<slug>` against `<arbiter>/main` (what the prior attempt already did) before implementing; build on what is good, do not blindly restart.
  - The **needs-attention reason** (runner-written: WHY it stalled) from the item body.
  - The **requeue handoff note(s)** (human-written via `requeue -m`: what to do about it) from the item body — the latest, or all accumulated entries.
- **Fresh-start path:** unchanged — no CONTINUE block, today's wrapper verbatim.

This composes the complete handoff: prior diff (what) + reason (why it stalled) + human note (what to do). It also keeps the "fresh = deterministic" ethos: continue is opt-in state inherited from a prior attempt; `--reset` (the other slice) is the "I want a clean slate" escape, which produces NO continue block (fresh branch).

## Acceptance criteria

- [ ] In continue-mode (arbiter `work/<slug>` ahead of main), the assembled prompt contains a CONTINUE block: a "you are continuing" framing + a pointer to review the prior diff vs main + the needs-attention reason + the requeue handoff note(s).
- [ ] In fresh-start mode, the assembled prompt is BYTE-IDENTICAL to today's (no CONTINUE block, canonical wrapper unchanged).
- [ ] The continue-detection reuses the SAME mechanism as `requeue-continue-and-reset`'s claim/start path (no parallel re-derivation).
- [ ] The handoff note + reason are read from the item BODY (the ledger file), so they survive the requeue→backlog→claim gap and cross machines.
- [ ] Tests: continue-mode assembles the block with diff-pointer + reason + note; fresh-mode asserts byte-identical-to-baseline output; `extractCanonicalWrapper` still parses (the wrapper file is untouched).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `requeue-continue-and-reset` — provides the continue-detection + the handoff note in the body that this block surfaces.

## Prompt

> When a re-claim CONTINUES prior work (the `requeue-continue-and-reset` model), the agent lands on a `work/<slug>` branch with prior commits — but the canonical wrapper assumes a fresh start. Inject a CONTINUE block into the prompt ASSEMBLY (`src/prompt.ts`/`buildAgentPrompt`) ONLY in continue-mode; leave the fresh-start prompt byte-identical and the `CLAIM-PROTOCOL.md` wrapper unchanged.
>
> Continue-mode = arbiter `work/<slug>` exists ahead of main (reuse the detection the `requeue-continue-and-reset` claim/start path added — do not re-derive). The block: "you are continuing, review the prior diff vs <arbiter>/main first, build on it" + the needs-attention reason + the requeue handoff note(s), both read from the item body.
>
> READ FIRST: `src/prompt.ts` (`buildAgentPrompt`, `extractCanonicalWrapperTemplate` — the assembly to extend; keep the wrapper-fence parsing intact); the `requeue-continue-and-reset` done code (continue-detection + where the handoff note is written in the body); `skills/to-slices/CLAIM-PROTOCOL.md` (the wrapper — NOT edited here). Drift check: confirm continue-detection + handoff-note-in-body exist as that slice built them.
>
> TDD with vitest: continue-mode block contents; fresh-mode byte-identical to baseline; wrapper still parses. "Done" = acceptance criteria met and gate green.

---

### Claiming this slice

```sh
agent-runner claim agent-prompt-continue-context --arbiter <remote>
git fetch <remote> && git switch -c work/agent-prompt-continue-context <remote>/main
git mv work/in-progress/agent-prompt-continue-context.md work/done/agent-prompt-continue-context.md
```
