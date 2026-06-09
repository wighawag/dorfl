/**
 * The SHARED "first JSON object in agent prose" extractor — the single
 * implementation behind every prompt→verdict→dispatch seam in this package
 * (the Gate-2 PR/code review gate and the slice-SET acceptance gate in
 * `review-gate.ts`, the slicer IMPROVER loop in `slicer-review-loop.ts`, and the
 * issue-intake decision in `intake.ts`). Each of those launches an agent that
 * EMITS a single JSON object (possibly fenced / wrapped in prose) and the runner
 * pulls it back out to dispatch on it — the SAME need, so it is ONE extractor, not
 * a forked copy per caller (coherence; slice `intake-production-verdict-parse`).
 *
 * The only thing that varies between callers is the DISCRIMINATOR KEY they brace-
 * match outward from: the review gates emit `{"verdict": …}`, intake emits
 * `{"outcome": …}`. {@link extractJsonObjectSpan} takes that key as a parameter
 * (defaulting to `"verdict"` so the review-gate callers read identically).
 */

/**
 * Locate the first JSON object that carries a `"<key>"` field in arbitrary agent
 * output (it may be fenced, prefixed with prose, or bare), returning its `[start,
 * end)` span (`output.slice(start, end)` is the JSON). Brace-matched from the
 * `"<key>"` occurrence OUTWARD (walk back to the enclosing `{`, then brace-match
 * forward, respecting strings) so a surrounding fence / prose does not defeat
 * parsing. Returns `undefined` when none is found.
 *
 * @param output the agent's raw textual output.
 * @param key the discriminator field name to anchor on, WITHOUT quotes
 *   (defaults to `verdict`, the review gates' key; intake passes `outcome`).
 */
export function extractJsonObjectSpan(
	output: string,
	key = 'verdict',
): {start: number; end: number} | undefined {
	const anchor = output.indexOf(`"${key}"`);
	if (anchor === -1) {
		return undefined;
	}
	// Walk back to the opening brace of the object containing the key.
	let start = anchor;
	while (start >= 0 && output[start] !== '{') {
		start--;
	}
	if (start < 0) {
		return undefined;
	}
	// Brace-match forward from that opening brace, respecting strings.
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < output.length; i++) {
		const ch = output[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === '\\') {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) {
				return {start, end: i + 1};
			}
		}
	}
	return undefined;
}
