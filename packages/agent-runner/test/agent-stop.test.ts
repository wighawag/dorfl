import {describe, it, expect} from 'vitest';
import {
	parseStopSentinel,
	extractDecisionsBlock,
	emptyDiffStopReason,
	STOP_SENTINEL_OPEN,
	STOP_SENTINEL_CLOSE,
} from '../src/agent-stop.js';

/**
 * `agent-stop-signal` — the build-agent → runner reporting channel PARSERS (pure
 * logic, no git). The runner-wiring (sentinel STOP routes to needs-attention
 * before the gate; the empty-diff backstop; the success/agent-failed paths
 * unchanged) lives in `do.test.ts` / `run.test.ts` (real git). Here we pin the
 * two output-channel readers + the backstop reason.
 */

describe('parseStopSentinel — the HARD STOP verdict on agent.output', () => {
	it('reads the reason VERBATIM from inside a complete sentinel block', () => {
		const output = [
			'I checked the slice against current src/.',
			STOP_SENTINEL_OPEN,
			'The slice rests on three premises that are now false:',
			'1. the convergence it asks for already landed in run-daemon-reframe.',
			'Re-scope before re-claiming.',
			STOP_SENTINEL_CLOSE,
			'Done — stopping as instructed.',
		].join('\n');
		const stop = parseStopSentinel(output);
		expect(stop).toBeDefined();
		expect(stop?.reason).toBe(
			[
				'The slice rests on three premises that are now false:',
				'1. the convergence it asks for already landed in run-daemon-reframe.',
				'Re-scope before re-claiming.',
			].join('\n'),
		);
	});

	it('tolerates leading/trailing whitespace on the marker lines', () => {
		const output = [
			'  ' + STOP_SENTINEL_OPEN + '  ',
			'drifted: premise X is false',
			'\t' + STOP_SENTINEL_CLOSE,
		].join('\n');
		expect(parseStopSentinel(output)?.reason).toBe(
			'drifted: premise X is false',
		);
	});

	it('returns undefined for a normal build (no markers)', () => {
		expect(
			parseStopSentinel('Implemented the feature; tests green.'),
		).toBeUndefined();
		expect(parseStopSentinel('')).toBeUndefined();
		expect(parseStopSentinel(undefined)).toBeUndefined();
	});

	it('does NOT trip on the marker mentioned mid-prose (must be its own line)', () => {
		const output = `The protocol marker is ${STOP_SENTINEL_OPEN} but I am not stopping.`;
		expect(parseStopSentinel(output)).toBeUndefined();
	});

	it('an unterminated open marker is not a complete sentinel', () => {
		const output = [STOP_SENTINEL_OPEN, 'reason but no close'].join('\n');
		expect(parseStopSentinel(output)).toBeUndefined();
	});

	it('an empty-bodied sentinel still yields a stable default reason (honest routing)', () => {
		const output = [STOP_SENTINEL_OPEN, '', STOP_SENTINEL_CLOSE].join('\n');
		const stop = parseStopSentinel(output);
		expect(stop).toBeDefined();
		expect(stop?.reason).toMatch(/no reason/i);
	});
});

describe('extractDecisionsBlock — the SOFT decisions log on agent.output', () => {
	it('extracts the prose under a ## Decisions heading', () => {
		const output = [
			'Implemented the slice.',
			'',
			'## Decisions',
			'',
			'- Chose to ERROR on -n × --remote (touches the do command); ',
			'  alternative: silently auto-pick. Reversible.',
			'',
			'## Other',
			'',
			'unrelated',
		].join('\n');
		const block = extractDecisionsBlock(output);
		expect(block).toBeDefined();
		expect(block).toMatch(/ERROR on -n × --remote/);
		expect(block).toMatch(/alternative: silently auto-pick/);
		// Stops at the next ## heading.
		expect(block).not.toMatch(/unrelated/);
	});

	it('returns undefined when no decisions block was reported', () => {
		expect(extractDecisionsBlock('just a normal summary')).toBeUndefined();
		expect(extractDecisionsBlock('')).toBeUndefined();
		expect(extractDecisionsBlock(undefined)).toBeUndefined();
	});

	it('returns undefined for an empty decisions block', () => {
		expect(extractDecisionsBlock('## Decisions\n\n')).toBeUndefined();
	});
});

describe('emptyDiffStopReason — the deterministic backstop reason', () => {
	it('names the slug + the no-op/stop framing', () => {
		const reason = emptyDiffStopReason('my-slice');
		expect(reason).toMatch(/my-slice/);
		expect(reason).toMatch(/no source change|empty diff/i);
		expect(reason).toMatch(/re-scope or re-claim/i);
	});
});
