---
title: Harden the Gate-2 review-verdict parse against malformed JSON (route, repair, contract)
slug: harden-gate2-verdict-parse-against-malformed-json
blockedBy: [] # startable now
covers: [] # self-contained robustness fix; no prd
---

## What to build

Make the Gate-2 (PR/code review) gate ROBUST to a malformed JSON verdict from
the review agent, so a bad verdict on a large diff becomes a clean, recoverable
needs-attention item instead of an UNHANDLED crash that strands the lock and
branch. Three layered changes, in priority order:

1. **Route, never crash (the safety net).** Catch `ReviewParseError` at the
   Gate-2 call site so a parse failure is routed to needs-attention with a
   classified failure CAUSE (never an unhandled throw, never a silent approve).
2. **Repair before strict-parse (recovers the CONTROL-CHAR class).** In
   `parseReviewVerdict`, on a strict-parse failure, run ONE lenient repair pass
   (escape raw control chars inside JSON strings) and retry; only a STILL-failing
   parse throws. Routing reads only `verdict` + `findings`, so even a partial
   salvage that recovers those is enough. SCOPE HONESTY (see "Which malformation
   class" below): this repair fixes raw control chars; it does NOT fix an
   unescaped inner quote, which is the more likely cause of the OBSERVED crash.
   So direction 1 (route) and direction 3 (contract) are the load-bearing fixes
   for the observed shape; direction 2 is a bonus recovery for a different class.
3. **Harden the output contract (prevention, targets the OBSERVED class).**
   Tighten the review prompt so a weaker model is less likely to emit the
   observed malformation. The effective lever is HAZARD ELIMINATION, not
   restating JSON syntax rules: instruct the agent to AVOID literal double-quotes
   inside string fields (paraphrase, or use single quotes in prose) so there is
   no inner `\"` to drop-an-escape on; keep string fields SHORT (length cap) and
   SINGLE-LINE; escape control chars. Note: "remember to escape inner quotes" is
   LOW-leverage on its own (valid JSON already requires it; a weak model drops
   the escape under load), so prefer eliminating the inner quote over relying on
   correct escaping. Resolve the tension that `verdictContractPrompt`'s example
   is shown PRETTY-PRINTED while we ask for minified (say the example is expanded
   for readability but must be EMITTED minified, or minify the example).

This is the fix for the open, twice-reproduced observation
`work/notes/observations/gate2-review-verdict-json-parse-crash-on-large-diffs.md`.

### Which malformation class? (evidence check, do NOT skip)

The observation's literal error is `Expected ',' or '}' after property value in
JSON at position 8101`. That signature matters for scoping direction 2:

- A raw CONTROL CHAR inside a string yields a DIFFERENT error (`Bad control
  character in string literal`). The direction-2 repair fixes THIS class.
- An UNESCAPED INNER QUOTE (e.g. `"review":"he said "hi" there"`) yields EXACTLY
  the observed `Expected ',' or '}'` error, and the direction-2 repair does NOT
  fix it, because the shared `extractJsonObjectSpan` brace-matcher mis-bounds the
  object span at the stray `"`, so the extracted slice is already wrong BEFORE
  repair runs (verified with a prototype against the real extractor).

Conclusion: the OBSERVED crash is most consistent with an unescaped-quote /
structural malformation, which direction 2 will NOT repair. That is FINE:
direction 1 routes it cleanly to needs-attention and direction 3 attacks it at
the source (by ELIMINATING inner double-quotes in the contract, not merely
reminding the agent to escape them, which is the rule it is already dropping).
Do NOT expect the repair to
make the observed crash "often repaired"; set that expectation honestly. Widening
the repair to re-bound the span around unescaped inner quotes is a NON-GOAL here
(it is heuristic and risks laundering a reject); if you attempt it, treat it as
an explicit, separately-justified decision, not an assumed deliverable.

### Background: the exact crash path (verified against HEAD, 2026-06-25)

The review agent emits its verdict as ONE JSON object; the runner pulls it back
out and strict-`JSON.parse`s it. On the two LARGEST diffs of a recent drive the
verdict JSON was malformed (a raw newline / control char inside a long string
field, deep in the payload at position ~7.5k-8.1k) and the parse threw:

> error: review verdict was not valid JSON: Expected ',' or '}' after property value …

Traced end to end:

- `parseReviewVerdict` (review-verdict module) does
  `JSON.parse(output.slice(span.start, span.end))` and on failure
  `throw new ReviewParseError("review verdict was not valid JSON: …")`. No
  salvage, no repair, no length cap, no retry. (The JSON-LOCATING step,
  `extractJsonObjectSpan`, is already robust to prose/fences, so the fragility is
  purely the string CONTENT, not finding the object.)
- `runGate2Review` (integration-core module) calls `reviewGate(...)` (which runs
  the parse) inside its rounds loop with NO try/catch, so the throw propagates.
- `performIntegration` calls `runGate2Review` directly, also no try/catch, so the
  throw propagates out of the core.
- `performComplete`'s outer catch does not recognise `ReviewParseError` (not a
  strand class, not `CompleteRefusal` / `IntegrationNothingStaged` /
  `CompleteUsageError`), so it falls to the generic `outcome: 'usage-error'`.

Because the throw lands AFTER the green build but BEFORE the approve path's
push / done-move, the run STRANDS: orphaned `active` lock (origin + mirror), no
origin push, no PR. Recovery today is fully manual (push the kept mirror branch,
`requeue`, clear the mirror lock by hand, re-`do`).

### How routing + cause-classification ACTUALLY layer (verified HEAD, 2026-06-25)

Get the layering right or the fix will re-strand:

- The CORE (`integration-core.ts`) does NOT classify failure causes. It routes a
  needs-attention transition via `applyNeedsAttentionTransition` (which, on the
  autonomous path, PUSHES the work branch + surfaces the item) and returns a
  COARSE `outcome` (`review-blocked`, `gate-failed`, `prepare-failed`, …). The
  block path in `runGate2Review` is exactly this shape.
- `classifyFailureCause` (`failure-cause.ts`) runs ONLY in `do.ts`/`run.ts`, and
  there only on the `usage-error` branch, where it re-labels a thrown core wiring error
  to `config-error`. The `usage-error` branch returns a VERBATIM message and does
  NOT call `applyNeedsAttentionTransition`, so it does NOT push/surface. THAT is why
  the parse crash (which becomes `usage-error`) strands.
- So the fix is NOT "classify inside the core." It is: catch in `runGate2Review`,
  route through the work-preserving `applyNeedsAttentionTransition` seam (like the
  block path), return a distinct outcome that is NOT `review-blocked` (the
  reviewer did not block), and map that outcome to the `transient-infra` cause in
  `do.ts`/`run.ts` (all THREE sites: in-place `performDo`, `do --remote`
  `runRemotePipeline`, and `run.ts`).

### Prototype (direction 2 validated, 2026-06-25)

A throwaway prototype of the repair pass confirmed the layering works. The
decision-rich core (string-state walk; inside a string, escape any raw control
char that JSON forbids; outside a string, leave structure untouched):

```js
function repairJsonControlChars(text) {
	let out = '';
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const code = ch.charCodeAt(0);
		if (inString) {
			if (escaped) { out += ch; escaped = false; continue; }
			if (ch === '\\') { out += ch; escaped = true; continue; }
			if (ch === '"') { out += ch; inString = false; continue; }
			if (code < 0x20) {
				if (ch === '\n') out += '\\n';
				else if (ch === '\t') out += '\\t';
				else if (ch === '\r') out += '\\r';
				else out += '\\u' + code.toString(16).padStart(4, '0');
				continue;
			}
			out += ch; continue;
		}
		if (ch === '"') inString = true;
		out += ch;
	}
	return out;
}
```

Prototype results (strict-first, repair-on-failure):
- raw newline in `review`; raw newline/tab in finding `context`; tab+CR;
  escaped-quote-then-newline → all RECOVER via the repair pass.
- already-valid minified JSON → strict parse succeeds first; repair never runs.
- genuinely TRUNCATED payload (unterminated string) → repair CANNOT save it;
  still fails → falls through to the direction-1 needs-attention route, never a
  silent approve.

(The escape-tracking is load-bearing: `\"` inside a string must not be read as
the string's closing quote, or a following raw newline would be mis-handled.
The prototype's `escaped` flag covers this; keep it in the real impl.)

NOTE the repair's BOUNDARY (see "Which malformation class" above): it recovers
the control-char class, NOT an UNESCAPED inner quote (which mis-bounds the span
before repair even runs, and matches the OBSERVED error). Do not over-claim its
coverage of the observed crash.

## Acceptance criteria

- [ ] **Route, work-preserving (1):** a `ReviewParseError` raised by the review
      gate is CAUGHT inside `runGate2Review` (integration-core) and routed to
      needs-attention via the SAME work-preserving `applyNeedsAttentionTransition`
      seam the BLOCK path in that function already uses (surfaced on
      `surfaceArbiter` for the autonomous path), NOT an unhandled throw, and NEVER
      a silent approve. This is the load-bearing fix: today the throw escapes the
      core entirely and falls to `performComplete`'s generic `usage-error`, which
      returns a verbatim message and does NOT push/surface, so the branch+lock
      STRAND. Routing through `applyNeedsAttentionTransition` (as the block path
      does) is what pushes the work branch + surfaces the item, ending the strand.
- [ ] **Catch covers BOTH call paths (1):** the catch MUST live INSIDE
      `runGate2Review` (the single covering point), NOT at a call site. The
      function is invoked from TWO places: directly on the `!freshWorktreeGate`
      path, AND as the `review:` callback inside `runFreshWorktreeGate` (the
      DEFAULT autonomous `do`/`run` fleet path), whose `finally` only reaps the
      worktree and does NOT catch, so a throw there propagates out of
      `performIntegration` and strands the SAME way. Because `runGate2Review`
      receives `reviewCwd` (the review tree) and `cwd` (the work branch + ledger)
      SEPARATELY, catching inside it routes correctly (targets `cwd`) for BOTH
      paths. A catch at the `!freshWorktreeGate` call site alone would leave the
      fresh-worktree path crashing. A test (or explicit note) confirms the
      fresh-worktree path is covered, not just the direct path.
- [ ] **Parse failure is TERMINAL in the rounds loop (1):** the catch wraps the
      per-round `reviewGate(...)` call, and a `ReviewParseError` in ANY round
      routes IMMEDIATELY (does NOT re-roll the remaining rounds), mirroring the
      existing rule that a `block` is terminal and never re-rolled on the same
      stochastic gate. Re-rolling on a parse failure would just be the dice-reroll
      the corroboration loop deliberately forbids.
- [ ] **Branch is provably preserved (1):** a test asserts the parse-failure
      route PUSHES the work branch and SURFACES the item on `surfaceArbiter` (the
      autonomous path), identical to the block path, NOT merely "returns a
      non-throwing outcome." The strand (no push, orphaned active lock) is exactly
      the bug being fixed, so it must be asserted gone, not assumed.
- [ ] **Outcome / cause (1):** the parse-failure route surfaces a DISTINCT,
      legible signal: it is NOT a `review-blocked` (the reviewer did not block;
      the gate's output was unreadable). Pick ONE coherent design and state the
      choice in the done record. RECOMMENDED DEFAULT is (b) REUSE an existing
      cause-carrying needs-attention outcome, because `IntegrationCoreOutcome` is
      an EXHAUSTIVELY-matched union and reusing a value is already wired into
      every branch. Option (a), a NEW outcome (e.g. `review-unparseable`), is the
      heavier path: a new union value MUST be added to EVERY exhaustive outcome
      switch or a parse crash falls through to the SUCCESS branch and is
      misreported as a completed job (fail-SILENT, strictly worse than today's
      crash). If you take (a), enumerate and cover ALL of: `do.ts` in-place
      (~the `gate-failed`/`review-blocked` needs-attention branch in `performDo`),
      `do.ts` `do --remote` (`runRemotePipeline`), `run.ts` (the
      `prepare-failed | review-blocked | rebase-conflict | invariant-violation`
      branch, where NOT adding it means it hits `state: 'done'`/`claimed-done`),
      AND the `CompleteOutcome` 1:1 map, with a fail-LOUD default so an unmapped outcome
      NEVER reaches the success branch. EITHER WAY the recorded cause is
      `transient-infra` (work is fine; the stochastic gate output misbehaved;
      natural recovery is re-run), NOT `gate-failed` (code is fine), NOT
      `config-error` (wiring is fine), NOT `review-blocked`. Note: the CORE does
      not classify causes today (`classifyFailureCause` runs only in
      `do.ts`/`run.ts`); add the `transient-infra` classification at whichever
      layer matches the chosen design, consistently across the in-place
      `performDo`, the `do --remote` (`runRemotePipeline`), AND `run.ts` sites.
- [ ] **Classifier signature (1):** add a `TRANSIENT_INFRA_SIGNATURES` entry to
      `failure-cause.ts` matching the parse-failure phrase ("review verdict was
      not valid JSON" / "no parseable") so `classifyFailureCause` labels it
      `transient-infra`. A genuine `config-error` (review on, no gate wired) STILL
      classifies as `config-error` (do not regress the existing wiring-error
      signature); a red gate stays `gate-failed`.
- [ ] **Repair (2):** `parseReviewVerdict` attempts a strict `JSON.parse` FIRST;
      only on failure does it run ONE lenient repair pass (escape raw control
      chars inside strings, per the prototype) and retry. The repair runs on the
      EXTRACTED SLICE (`output.slice(span.start, span.end)`), not the whole
      prose output. A still-failing parse throws `ReviewParseError` unchanged.
      Already-valid JSON is unaffected (strict parse wins; repair never runs).
      The repair preserves escape-tracking (an escaped `\"` does not terminate
      the string).
- [ ] **Repair is NARROW, never launders a reject (2):** the repair escapes
      control chars inside strings ONLY. It must NOT change JSON STRUCTURE or
      TOKEN VALUES (no trailing-comma stripping, no quoting bare tokens, no
      coercion). Anything it cannot fix by the narrow control-char rule STILL
      throws. This is load-bearing for "never a silent approve": a broad
      "coerce anything to JSON" repair could turn a genuinely-malformed or
      meaningfully-WRONG verdict into a false `approve`/`block`. A repaired parse
      STILL flows through `validateVerdict`, so a repaired `{"verdict":"maybe"}`
      still throws on the invalid value (repair does not bypass validation). The
      existing throw-cases (`{"verdict": not json}`, `{"verdict":"maybe"}`) must
      remain throwing.
- [ ] **Contract (3):** the review prompt (`buildReviewPrompt` /
      `verdictContractPrompt`) instructs the agent to emit MINIFIED
      single-line JSON, to AVOID literal double-quotes inside string fields
      (paraphrase / use single quotes in prose so there is no inner `\"` to
      drop-an-escape on, the direct attack on the OBSERVED `Expected ',' or '}'`
      error; "remember to escape inner quotes" is low-leverage on its own), to
      escape control chars, and caps the length of the longest field
      (remove/replace the current "there is NO length limit" license on the
      `review` field with a sane cap). It also resolves the example-vs-minified
      tension (the `verdictContractPrompt` example is pretty-printed; either note
      it is expanded for readability but must be emitted minified, or minify it). Keep the change a prompt-prose tightening only (no new channels,
      no shape change): the fixture-matches-doc / `REVIEW-PROTOCOL.md` mirror must
      still hold).
- [ ] Tests cover all three: (a) a malformed-verdict gate run routes to
      needs-attention (via `applyNeedsAttentionTransition`, branch pushed +
      surfaced) with the `transient-infra` cause instead of throwing, asserted at
      the `runGate2Review`/integration seam so the ROUTING + branch-preservation
      are what is asserted (use a stub review gate that THROWS `ReviewParseError`,
      mirroring the existing review-gate `rejects.toBeInstanceOf(ReviewParseError)`
      tests but pushing the assertion to the routed OUTCOME), INCLUDING coverage
      that the FRESH-WORKTREE gate path routes the throw too (not only the direct
      `!freshWorktreeGate` path); (b)
      `parseReviewVerdict` unit cases for each repaired shape from the prototype
      PLUS the truncated case that still throws PLUS already-valid stays valid
      PLUS a repaired-but-invalid-VALUE case (`{"verdict":"maybe"}` with a raw
      control char) that repairs the JSON yet STILL throws via `validateVerdict`;
      (c) `classifyFailureCause` returns `transient-infra` for the parse-failure
      phrase and still `config-error` for the wiring phrase.
- [ ] `parseReviewVerdict` is the SINGLE shared parser (review gate, task
      acceptance gate, tasker improver loop, intake), so the repair benefits ALL
      four callers automatically; do NOT fork a second parser. (Coherence: the
      module doc already states it is the one home.)
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.
      (Tests use throwaway git repos + a local `--bare` arbiter where they touch
      the integrate seam; nothing writes outside its own temp fixtures.)

## Blocked by

- None. Can start immediately.

## Prompt

> Make the Gate-2 (PR/code review) verdict parse ROBUST so a malformed JSON
> verdict from the review agent (which happens on LARGE diffs and on
> less-intelligent models: a raw newline / control char inside a long string
> field, deep in the payload) becomes a clean, recoverable needs-attention item
> instead of an UNHANDLED crash that strands the lock + work branch and opens no
> PR. Read "What to build" and "Background" above; they are self-contained, with
> the verified crash path and a validated prototype of the repair pass.
>
> Do THREE layered changes, in priority order:
>
>   (1) ROUTE, never crash. Today `runGate2Review` (integration-core module)
>   calls the review gate inside its rounds loop with NO try/catch, and
>   `performIntegration` calls `runGate2Review` with no try/catch either, so a
>   `ReviewParseError` (review-verdict module) propagates all the way out and
>   `performComplete`'s catch maps it to the generic `usage-error` AFTER the green
>   build but BEFORE any push/done-move, stranding the run (the `usage-error`
>   branch returns verbatim and does NOT push/surface). Catch the
>   `ReviewParseError` INSIDE `runGate2Review` and route it through the SAME
>   work-preserving `applyNeedsAttentionTransition` seam the BLOCK path in that
>   function already uses (surfaced on `surfaceArbiter` for the autonomous path).
>   That seam is what PUSHES the branch + surfaces the item, ending the strand.
>   Surface a signal that is NOT `review-blocked` (the reviewer did not block; the
>   gate's output was unreadable), and map it to the `transient-infra` failure
>   cause in `do.ts`/`run.ts`. PREFER reusing an existing cause-carrying
>   needs-attention outcome (already wired into every branch): `IntegrationCoreOutcome`
>   is an EXHAUSTIVELY-matched union, so a NEW outcome value that you forget to add
>   to any one switch (notably the `run.ts`
>   `prepare-failed|review-blocked|rebase-conflict|invariant-violation` branch, and
>   the two `do.ts` sites) falls through to the SUCCESS branch and misreports the
>   crash as a completed job (fail-SILENT, strictly worse than today's crash). If
>   you DO add a new outcome, cover every exhaustive switch + the `CompleteOutcome`
>   map with a fail-LOUD default. Do NOT try to classify
>   inside the core: the core does not classify causes today (see Background
>   "How routing + cause-classification ACTUALLY layer"); `classifyFailureCause`
>   lives in `do.ts`/`run.ts`. Add a `TRANSIENT_INFRA_SIGNATURES` regex in
>   `failure-cause.ts` matching the parse-failure phrase, KEEP the existing
>   `config-error` wiring signature, and wire the new outcome→`transient-infra`
>   at ALL THREE classification sites (in-place `performDo`, `do --remote`
>   `runRemotePipeline`, `run.ts`). A test must ASSERT the parse-failure route
>   pushes the branch + surfaces the item (not merely "does not throw"). Never a
>   silent approve.
>
>   (2) REPAIR before the strict parse (the biggest quality win for weaker
>   models). In `parseReviewVerdict`, try a strict `JSON.parse` FIRST; only on
>   failure run ONE lenient repair pass that escapes raw control chars INSIDE
>   strings (the `repairJsonControlChars` walk in the prototype above; keep its
>   `inString`/`escaped` tracking; an escaped `\"` must not close the string),
>   run on the EXTRACTED SLICE (`output.slice(span.start, span.end)`, NOT the
>   whole prose), and retry. Keep the repair NARROW: control-char escaping ONLY,
>   never structural changes or token coercion (no trailing-comma stripping, no
>   quoting bare tokens): a broad "coerce anything to JSON" repair could LAUNDER
>   a genuine reject into a false approve/block, which breaks "never a silent
>   approve". A repaired parse STILL flows through `validateVerdict` (so a
>   repaired `{"verdict":"maybe"}` still throws). A still-failing parse throws
>   `ReviewParseError` UNCHANGED (so direction 1 catches it). Already-valid JSON
>   must be untouched (strict wins; repair never runs). This parser is SHARED by
>   all four review callers (review gate, task acceptance gate, tasker improver
>   loop, intake). Fix it in the one place; do NOT fork a second parser. SCOPE
>   HONESTY: this repair recovers the CONTROL-CHAR class only. It does NOT fix an
>   unescaped inner quote, which is the malformation most consistent with the
>   OBSERVED `Expected ',' or '}'` error (the brace-matcher mis-bounds the span
>   first). So do NOT bill direction 2 as fixing the observed crash; directions 1
>   and 3 do that. Widening the repair to re-bound around inner quotes is a
>   NON-GOAL (heuristic, laundering risk) unless separately justified.
>
>   (3) HARDEN the output contract. In `buildReviewPrompt` and/or
>   `verdictContractPrompt` (review-verdict / review-gate modules), reduce the
>   weak-model failure rate by HAZARD ELIMINATION, not by restating syntax:
>   instruct the agent to AVOID literal double-quotes inside string fields
>   (paraphrase / single quotes in prose, so there is no inner `\"` to drop an
>   escape on; this directly attacks the OBSERVED `Expected ',' or '}'` error),
>   keep string fields SHORT and SINGLE-LINE, escape control chars, and CAP the
>   length of the longest field (replace the current "there is NO length limit"
>   license on `review`). "Remember to escape inner quotes" is LOW-leverage alone
>   (valid JSON already requires it; the model drops it under load): prefer
>   removing the inner quote. The `verdictContractPrompt` JSON example is
>   pretty-printed but we ask for minified: resolve that (note it is expanded for
>   readability yet must be EMITTED minified, or minify the example). Prose-only tightening (no new channels, no shape change); the
>   fixture-matches-doc test and the `REVIEW-PROTOCOL.md` mirror must still pass
>   (update the doc/fixture if your wording touches the described shape).
>
> Domain vocabulary: "Gate 2" is the PR/code review gate (a JUDGEMENT gate layered
> on the deterministic `verify` floor). The review agent EMITS a single
> `ReviewVerdict` JSON object; the runner reads it back via the shared
> `extractJsonObjectSpan` (locating) + `parseReviewVerdict` (parsing). Routing
> reads ONLY `verdict` + `findings` (the other channels are advisory), so a
> partial salvage that recovers those is actionable. "Failure cause" is the CAUSE
> axis on a needs-attention route (`transient-infra` = retry same work;
> `config-error` = fix wiring; `agent-failed` = generic); `classifyFailureCause`
> is the shared best-effort lexical classifier used by BOTH `do` and `run`.
>
> Where to look (by module/concept, not brittle line numbers):
>   - review-verdict module (`packages/dorfl/src/review-verdict.ts`):
>     `parseReviewVerdict` (add the repair pass), `verdictContractPrompt` (the
>     shared contract prose).
>   - review-gate module (`packages/dorfl/src/review-gate.ts`):
>     `buildReviewPrompt` (the Gate-2 per-builder framing; the "no length limit"
>     line lives here).
>   - integration-core module (`packages/dorfl/src/integration-core.ts`):
>     `runGate2Review` (wrap the per-round `reviewGate(...)` call; route on
>     `ReviewParseError` via the existing `applyNeedsAttentionTransition` block in
>     the same function). Catch INSIDE `runGate2Review`, NOT at its call sites:
>     it is called BOTH directly (the `!freshWorktreeGate` path) AND as the
>     `review:` callback inside `runFreshWorktreeGate` (the default autonomous
>     fleet path, whose `finally` only reaps the worktree and does NOT catch). One
>     catch inside the function covers both, and routes to the work-branch `cwd`
>     (not the throwaway `reviewCwd`) because the function receives them
>     separately. A parse failure in any round is TERMINAL (route immediately, do
>     NOT re-roll remaining rounds), mirroring the block-is-terminal rule.
>   - failure-cause module (`packages/dorfl/src/failure-cause.ts`): add the
>     transient-infra signature for the parse-failure phrase.
>
> Seams to test at: `parseReviewVerdict` is directly unit-testable (see the
> existing `parseReviewVerdict` describe blocks in
> `packages/dorfl/test/review-gate.test.ts`): add the repaired-shape cases, the
> truncated-still-throws case, and the already-valid-unchanged case there.
> `classifyFailureCause` is a pure unit (add the parse-phrase → `transient-infra`
> case). For the ROUTING assertion, test at the `runGate2Review` / integrate seam
> with a stub review gate that THROWS `ReviewParseError`, and assert the outcome
> routes to needs-attention WITH the work branch PUSHED + the item SURFACED (not
> merely "does not throw") and the `transient-infra` cause (not a throw, not an
> approve), mirroring the existing review-gate / integration-core test fixtures
> (throwaway repos + local `--bare` arbiter; `makeScratch`/`seedRepoWithArbiter`
> style).
>
> "Done" means: a malformed verdict on a large diff is (a) repaired-and-parsed
> when it is the CONTROL-CHAR class, and (b) otherwise (incl. the observed
> unescaped-quote class) ROUTED to needs-attention as `transient-infra` with the
> branch preserved: never an unhandled crash, never a silent approve; the
> contract prose is tightened (inner double-quotes ELIMINATED from string fields,
> control chars escaped, strings short + single-line, length capped) to reduce
> the rate at the source for the observed class; and the shared
> parser/classifier remain single-homed. Verify with
> `pnpm -r build && pnpm -r test && pnpm format:check`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): does `runGate2Review` still lack a try/catch around the gate
> call, and does `parseReviewVerdict` still do a single strict `JSON.parse` with
> no repair? If a prior slice already added catching/repair, or the gate machinery
> moved, do NOT build on the stale premise: route the task to needs-attention
> with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a
> needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building (e.g. the exact
> length cap chosen for the contract, the precise transient-infra regex). Do NOT
> broaden the repair beyond control-char escaping (no trailing-comma stripping /
> token coercion): a broad repair risks laundering a real reject into a false
> approve, so any widening would be a load-bearing decision needing an explicit
> WHY. If a choice meets the ADR gate (hard to reverse + surprising without
> context + a real trade-off, see `docs/adr/` and `ADR-FORMAT.md`), write the
> durable WHY as an ADR; otherwise note it briefly in the done record / PR
> description. The "malformed verdict is transient-infra, not gate-failed/
> config-error/review-blocked" classification choice is worth recording
> explicitly, noting the slight semantic stretch (`transient-infra` means "retry
> the SAME work", and a naive retry of the SAME diff on the SAME model may
> reproduce the bad verdict; it is justified because the gate output is
> STOCHASTIC so a re-run CAN differ, and direction-2 repair makes a re-run far
> more likely to parse). The new-outcome-vs-reuse choice for (1) is also worth a
> line (and if you add a NEW `IntegrationCoreOutcome`, record that you covered
> every exhaustive switch with a fail-loud default, since a missed branch
> fail-silently misreports the crash as a completed job).

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim harden-gate2-verdict-parse-against-malformed-json --arbiter <remote>
# then start work on the updated main:
git fetch <remote> && git switch -c work/harden-gate2-verdict-parse-against-malformed-json <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/harden-gate2-verdict-parse-against-malformed-json.md work/tasks/done/harden-gate2-verdict-parse-against-malformed-json.md
```
