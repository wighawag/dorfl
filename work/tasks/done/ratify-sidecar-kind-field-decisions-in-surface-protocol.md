## Context

Gate 2 APPROVED the `sidecar-kind-field` task but flagged three in-scope decisions that were never recorded in a `## Decisions` block on the PR (the commit body shows only the conventional-commit title). Rather than amend history, ratify them durably in the sidecar shape spec so future readers (and the next author touching `packages/dorfl/src/sidecar.ts`) find the mechanism at the doc, not by archaeology.

Implementation reference: `packages/dorfl/src/sidecar.ts` (parse + serialise) and its `sidecar.test.ts` — the code and tests already encode these three decisions; this task is a docs-only ratification.

## The three decisions to ratify

(a) **Token spelling** is `kind=<value>` inside the per-entry HTML comment (as suggested by the original task prompt — no alternative spelling was adopted).

(b) **Field order** within the comment: `kind=` is appended AFTER any `answered=` token. (Emit order matters because the comment is the on-disk surface; downstream diff tools see it.)

(c) **Unknown `kind=` values are silently DROPPED on re-serialise** — they are not echoed back. This matches the project's silent-on-malformed convention but has the consequence that a round-trip is NOT byte-preserving for unknown tokens. This is BY DESIGN, not a bug; document it explicitly so nobody 'fixes' it later.

## What to do

1. Edit `skills/setup/protocol/SURFACE-PROTOCOL.md` — the SOURCE OF TRUTH per repo `AGENTS.md` — in its 'emitted question shape' / per-entry HTML comment section, adding a short subsection that states (a), (b), (c) above with one-line rationales. Keep it self-contained (carry the mechanism, not just a pointer to code).
2. Mirror the same change byte-identically into `work/protocol/SURFACE-PROTOCOL.md` (the propagated copy for this repo's own use). Per `AGENTS.md`: `diff -r skills/setup/protocol work/protocol` should remain clean for this file.
3. OPTIONAL — only if the WHY needs a durable home beyond the one-line rationales in the spec — add a short ADR under `docs/adr/` capturing why unknown-token drop was chosen over echo-through (silent-on-malformed convention; keeps parse/serialise symmetric on the KNOWN grammar; avoids tempting downstream code to rely on opaque passthrough). If the spec subsection is already load-bearing enough, skip the ADR.
4. In the SAME commit that lands the doc edit, delete `work/observations/observation-review-nits-sidecar-kind-field-2026-06-26.md` (this observation's durable home is now the spec; the observation is retired).

## Acceptance

- `SURFACE-PROTOCOL.md` (both copies) states the token spelling, the order-after-`answered=` rule, and the silent-drop-on-unknown behaviour + its round-trip consequence.
- `diff -r skills/setup/protocol work/protocol` shows no drift on this file.
- The observation file is gone in the same commit.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green (this is a docs-only change; no code should need touching — if a test disagrees with the ratified behaviour, that is a signal to STOP and re-open the question, not to silently edit the test).

## Non-goals

- Do NOT change `sidecar.ts` behaviour. This task ratifies what shipped; it does not renegotiate it.
- Do NOT add echo-through for unknown `kind=` values; that would reverse decision (c).

## Prompt

> Build the task 'ratify-sidecar-kind-field-decisions-in-surface-protocol', described above.
