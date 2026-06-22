<!-- agent-runner-sidecar: item=task:prompt-guidance-testfirst-config-and-prompt-seam type=task slug=prompt-guidance-testfirst-config-and-prompt-seam allAnswered=false -->

## Q1

**Which seam should carry the strengthened test-first text in CLAIM-PROTOCOL.md: (A) single wrapper with a conditional fragment delimited by markers (e.g. `<!-- if promptGuidance.testFirst -->…<!-- /if -->`) that the extractor in `prompt.ts` strips/keeps; (B) two named wrapper variants under sub-headings (e.g. `… — default` / `… — test-first`) selected by the resolved flag; or (C) an append-only line appended iff the flag is on?**

> The PRD explicitly defers this slicing-time choice and the task is `needsAnswers: true` because of it. Both A and B keep the canonical text in the protocol doc (the hard constraint). The slice's bias is whichever change is smaller to the existing CLAIM-PROTOCOL extraction code in `packages/agent-runner/src/prompt.ts` (the 'prompt handed to the work agent' heading scan) AND keeps a single source of truth. Affects both the wrapper-extractor implementation shape and the markdown structure in `skills/setup/protocol/CLAIM-PROTOCOL.md` (+ its `work/protocol/` mirror). If non-trivial, the chosen option is ADR-worthy.

_Suggested default: Option C — append-only line appended when the flag is on: smallest delta to the existing heading-scan extractor (no new templating, no variant selection), and keeps the markdown as a single source with the strengthened line clearly demarcated._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

**Option A — single wrapper, conditional fragment delimited by HTML-comment markers** (`<!-- if promptGuidance.testFirst -->` … `<!-- /if -->`) that the extractor strips/keeps based on the resolved flag.

Rejecting the suggested default (C) on the evidence in `prompt.ts`. The relevant facts:

- `extractCanonicalWrapperTemplate()` takes the **single first fenced block** after the heading VERBATIM (it `.slice(open+1, close).join('\n').trim()`s the whole block, then only `.replace(/<slug>/g, …)`s). The strengthened test-first text sits MID-BLOCK (it replaces/joins the existing `"Implement it to satisfy every Acceptance criterion. TDD where the task asks for it; match the repo's house style."` line at line 96-97 of CLAIM-PROTOCOL.md), surrounded above and below by load-bearing wrapper prose (the read-your-brief preamble above, the out-of-scope-note/STOP/decision-bar prose below).

- That mid-block position is exactly why **C (append-only line) is wrong here**: "append" only reads cleanly at the END of the block, but the line to strengthen is NOT at the end — appending the strengthened nudge after the STOP/decision-bar machinery would orphan it from the TDD sentence it is meant to strengthen, and would read as a stray trailing instruction. C's "smallest delta" claim assumes an append point that the actual block shape does not provide.

- **B (two named wrapper variants) duplicates the entire ~70-line wrapper** to vary one line. That violates single-source-of-truth (every future wrapper edit must be made twice and kept in sync — the same byte-identical-mirror burden that already bites this repo's `skills/setup/protocol` ↔ `work/protocol` pair, now squared), and the extractor would need a second heading scan + selector. Bigger markdown delta, bigger TS delta, ongoing drift risk.

- **A is the smallest TRUE delta and keeps one source.** The canonical text (both the soft default fragment and the strengthened fragment) lives ONCE, inline, at its natural mid-block position. The extractor change is one post-extraction pass over the block text: given the resolved boolean, either strip the `if` markers + keep the enclosed strengthened fragment (flag on) OR strip the whole `<!-- if -->…<!-- /if -->` span (flag off). A `<!-- else -->` (or two adjacent marker pairs) carries the soft default for the off case so the off-path stays byte-identical.

Implementation guardrails (so A does not regress the off-path byte-identity acceptance criterion):

1. The marker-stripping pass must run AFTER the block is extracted and BEFORE the `<slug>`/`<prd>` substitution, as a pure string transform keyed on the resolved boolean. Keep it a small named helper (e.g. `applyPromptGuidance(blockText, {testFirst})`) so it is unit-testable in isolation and the existing `extractCanonicalWrapperTemplate` stays a pure verbatim extractor.
2. With the flag OFF the transform MUST reproduce today's bytes exactly — the markers + the strengthened fragment vanish and ONLY the existing soft line remains, no stray blank lines. The existing byte-identity prompt test is the guard; add an explicit off-path case asserting equality with the pre-change snapshot.
3. The HTML-comment markers are invisible in rendered markdown, so the protocol doc still reads cleanly to a human (an advantage A has over B's visible duplicate sub-headings).
4. Mirror byte-identically into `work/protocol/CLAIM-PROTOCOL.md`; keep `diff -r skills/setup/protocol work/protocol` clean.

**This is ADR-worthy** (it introduces a new templating convention — conditional fragments — into the protocol-doc extraction contract, which any future nudge will reuse). Record an ADR (working name e.g. `prompt-wrapper-conditional-fragments`) so the marker convention is a named, discoverable contract rather than an unexplained pair of HTML comments. Bump the protocol `VERSION` per the dual-write rule.

## Q2

**When the nudge is on, does the strengthened test-first line REPLACE the existing soft 'TDD where the task asks for it; match the repo's house style.' line, or APPEND to / follow it?**

> A secondary question called out in the task's Open question section. The PRD wording 'strengthened' reads as REPLACE, but the task asks a reviewer to confirm. The acceptance criterion is written as 'the original soft phrasing is gone (or supplemented, per the decision above)', so the answer directly determines which half of that 'or' the prompt-assembly test asserts. Note: this question is partly entangled with the seam choice above — Option C (append-only) naturally implies APPEND, while A/B can go either way.

_Suggested default: REPLACE — matches the PRD's 'strengthened' wording and avoids two co-existing TDD lines with subtly different strengths in the same prompt._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

**REPLACE.** When the nudge is ON, the strengthened test-first line REPLACES the soft `"TDD where the task asks for it; match the repo's house style."` sentence — it does not co-exist with it.

Reasons:

- Matches the PRD's verb ("the existing soft line is STRENGTHENED"), and the brief frames it as upgrading the SAME line, not adding a second one.
- Two co-existing TDD lines with different strengths in one prompt is incoherent: the worker reads "TDD where the task asks for it" (optional, conditional) immediately followed by "write the failing test BEFORE the production code" (unconditional) and cannot tell which governs. A nudge whose whole job is to send a CLEARER signal must not also send the weaker one.
- This makes the prompt-assembly test crisp and asserts BOTH halves: with the flag ON, the strengthened string is PRESENT and the original soft phrasing (`"TDD where the task asks for it"`) is ABSENT — closing the acceptance criterion's "gone (or supplemented)" as **gone**.
- Note the `match the repo's house style` clause: fold its intent into the strengthened text (the test-first wording should not drop the house-style cue entirely — e.g. "…at the agreed seam, write the failing test BEFORE the production code, matching the repo's house style; this is guidance, not a gate — the `verify` step still decides pass/fail."). Replacing the SENTENCE is right; silently losing the house-style instruction is not.

This composes cleanly with the Option A seam from Q1: the `<!-- if -->…<!-- else -->…<!-- /if -->` span carries the strengthened fragment in the ON branch and the verbatim existing soft sentence in the OFF branch, so REPLACE is expressed structurally (one branch or the other, never both) and the OFF path stays byte-identical.
