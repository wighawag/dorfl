import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, appendFileSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
	formatWatchEvent,
	lastAssistantText,
	lastAssistantTurn,
	isOutputCappedTurn,
	cutOffTurnOf,
	SessionTailer,
} from '../src/watch-session.js';
import {makeScratch, type Scratch} from './helpers/gitRepo.js';

/**
 * `do --watch` observer tests (tasks `do-watch` + `do-watch-session-log-format`).
 *
 * The watcher tails the pi `--session-dir` SESSION-PERSISTENCE log, whose records
 * are `{"type":"message", "message":{role, content[]}}` — NOT pi's `--mode json`
 * STREAM events (`tool_start`/`message_end`/`agent_end`). The earlier classifier
 * matched the stream vocabulary, so every session-log line fell through to skip
 * and `do --watch` was silently a no-op. These tests pin the CORRECT shape using
 * a REAL session-log-shaped fixture (`test/fixtures/pi-session-log.jsonl`):
 *
 *   1. `formatWatchEvent` — the pure classifier over the SESSION-LOG shape: an
 *      assistant `message` emits its `content[]` `text` and `▶ <name>` for each
 *      `toolCall`; everything else (`session`/`model_change`/user/toolResult/…) is
 *      skipped. "Finished" is NOT a log event — it is emitted on PROCESS EXIT.
 *   2. `SessionTailer` — tails a GROWING `.jsonl`, surfaces those events live, and
 *      emits `✓ agent finished` once on `stop()` (the process-exit hook).
 */

// The raw ANSI marker coloured output must contain (and plain must not).
const ESC = '\u001b[';

const FIXTURE = fileURLToPath(
	new URL('./fixtures/pi-session-log.jsonl', import.meta.url),
);

/** Parse the real fixture into lines (drop the trailing blank). */
function fixtureLines(): string[] {
	return readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);
}

describe('formatWatchEvent — the pi SESSION-LOG classifier (not --mode json stream)', () => {
	it('an assistant message emits its text parts then a ▶ marker per toolCall', () => {
		// A real-shaped record: a thinking block (skipped), two text parts
		// (concatenated), then a toolCall named "read".
		const record = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [
					{type: 'thinking', thinking: 'IGNORED'},
					{type: 'text', text: 'Reading the prd, '},
					{type: 'text', text: 'then the PRD.'},
					{type: 'toolCall', name: 'read', arguments: {path: 'x'}},
				],
			},
		});
		expect(formatWatchEvent(record, false)).toEqual([
			'Reading the prd, then the PRD.',
			'▶ read x',
		]);
	});

	it('handles the toolName/args toolCall variant (tc.name||tc.toolName)', () => {
		const record = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [{type: 'toolCall', toolName: 'edit', args: {path: 'y'}}],
			},
		});
		expect(formatWatchEvent(record, false)).toEqual(['▶ edit y']);
	});

	it('a toolCall with no name falls back to "tool"', () => {
		const record = JSON.stringify({
			type: 'message',
			message: {role: 'assistant', content: [{type: 'toolCall'}]},
		});
		expect(formatWatchEvent(record, false)).toEqual(['▶ tool']);
	});

	it("shows a bash toolCall's command after the name", () => {
		const record = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [
					{
						type: 'toolCall',
						name: 'bash',
						arguments: {command: 'pnpm -r build'},
					},
				],
			},
		});
		expect(formatWatchEvent(record, false)).toEqual(['▶ bash pnpm -r build']);
	});

	it("shows a grep toolCall's pattern (its high-signal arg, not path)", () => {
		const record = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [
					{
						type: 'toolCall',
						name: 'grep',
						arguments: {pattern: 'toolName', path: 'src'},
					},
				],
			},
		});
		expect(formatWatchEvent(record, false)).toEqual(['▶ grep toolName']);
	});

	it('truncates a long detail to 64 chars + an ellipsis, collapsing whitespace', () => {
		const command = 'echo ' + 'a'.repeat(200);
		const record = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [{type: 'toolCall', name: 'bash', arguments: {command}}],
			},
		});
		const [line] = formatWatchEvent(record, false);
		// `▶ bash ` prefix (7 chars) + 64 detail chars + the ellipsis.
		expect(line).toBe(`▶ bash ${'echo ' + 'a'.repeat(59)}…`);
		expect(line.endsWith('…')).toBe(true);
	});

	it('collapses embedded newlines in a multi-line command to one line', () => {
		const record = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [
					{type: 'toolCall', name: 'bash', arguments: {command: 'a\nb\n c'}},
				],
			},
		});
		expect(formatWatchEvent(record, false)).toEqual(['▶ bash a b c']);
	});

	it('an unmapped tool probes generic keys (path/command/pattern/query)', () => {
		const record = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [
					{type: 'toolCall', name: 'websearch', arguments: {query: 'pi 0.73'}},
				],
			},
		});
		expect(formatWatchEvent(record, false)).toEqual(['▶ websearch pi 0.73']);
	});

	it('shows just the name when the toolCall carries no informative arg', () => {
		const record = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [{type: 'toolCall', name: 'read', arguments: {}}],
			},
		});
		expect(formatWatchEvent(record, false)).toEqual(['▶ read']);
	});

	it('tolerates an assistant message whose content is a plain string', () => {
		const record = JSON.stringify({
			type: 'message',
			message: {role: 'assistant', content: 'All done.'},
		});
		expect(formatWatchEvent(record, false)).toEqual(['All done.']);
	});

	it('SKIPS a user message', () => {
		const record = JSON.stringify({
			type: 'message',
			message: {role: 'user', content: [{type: 'text', text: 'the prompt'}]},
		});
		expect(formatWatchEvent(record, false)).toEqual([]);
	});

	it('SKIPS a toolResult message (tool results are not surfaced)', () => {
		const record = JSON.stringify({
			type: 'message',
			message: {
				role: 'toolResult',
				toolCallId: 'x',
				toolName: 'read',
				content: [{type: 'text', text: 'file body'}],
			},
		});
		expect(formatWatchEvent(record, false)).toEqual([]);
	});

	it('SKIPS the non-message record types (session/model_change/thinking_level_change)', () => {
		expect(
			formatWatchEvent(JSON.stringify({type: 'session', id: 'a'}), false),
		).toEqual([]);
		expect(
			formatWatchEvent(
				JSON.stringify({type: 'model_change', modelId: 'm'}),
				false,
			),
		).toEqual([]);
		expect(
			formatWatchEvent(
				JSON.stringify({type: 'thinking_level_change', thinkingLevel: 'off'}),
				false,
			),
		).toEqual([]);
	});

	it('does NOT treat the absent --mode json stream events as anything (tool_start/message_end/agent_end skipped)', () => {
		// These are the WRONG vocabulary the old classifier matched — in the
		// session log they never occur, and must classify as skip.
		expect(
			formatWatchEvent(
				JSON.stringify({type: 'tool_start', tool: 'edit'}),
				false,
			),
		).toEqual([]);
		expect(
			formatWatchEvent(JSON.stringify({type: 'agent_end'}), false),
		).toEqual([]);
	});

	it('skips blank lines and malformed JSON (a half-written trailing line) — never throws', () => {
		expect(formatWatchEvent('', false)).toEqual([]);
		expect(formatWatchEvent('   ', false)).toEqual([]);
		expect(() =>
			formatWatchEvent('{"type":"message","message":{"role":"assi', false),
		).not.toThrow();
		expect(
			formatWatchEvent('{"type":"message","message":{"role":"assi', false),
		).toEqual([]);
	});

	it('emits ANSI colour for the ▶ tool marker when color=true, plain otherwise', () => {
		const record = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [{type: 'toolCall', name: 'edit'}],
			},
		});
		const [coloured] = formatWatchEvent(record, true);
		expect(coloured).toContain(ESC);
		const [plain] = formatWatchEvent(record, false);
		expect(plain).not.toContain(ESC);
	});

	it('surfaces a REAL session-log fixture: tool starts + assistant text, other records skipped', () => {
		const surfaced = fixtureLines().flatMap((line) =>
			formatWatchEvent(line, false),
		);
		// The fixture has: session, model_change, thinking_level_change, a user
		// message, an assistant (text+text+read toolCall), a toolResult, an
		// assistant (text + edit toolCall), and a content-as-string assistant.
		expect(surfaced).toEqual([
			"I'll start by reading the task prd, then its source PRD.",
			'▶ read work/in-progress/do-watch-session-log-format.md',
			'Now editing the file.',
			'▶ edit src/watch-session.ts',
			'All done — the build is green.',
		]);
	});
});

describe('lastAssistantText — the shared last-assistant-text reader (one parser)', () => {
	/** Join records into a `.jsonl` body (one JSON object per line). */
	function jsonl(records: unknown[]): string {
		return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
	}

	it('returns the LAST assistant turn, concatenating its multi-part text', () => {
		const log = jsonl([
			{type: 'session', id: 'a'},
			{
				type: 'message',
				message: {role: 'user', content: [{type: 'text', text: 'the prompt'}]},
			},
			{
				type: 'message',
				message: {
					role: 'assistant',
					content: [{type: 'text', text: 'an EARLIER turn'}],
				},
			},
			{
				type: 'message',
				message: {
					role: 'assistant',
					content: [
						{type: 'thinking', thinking: 'IGNORED'},
						{type: 'text', text: 'My final '},
						{type: 'text', text: 'answer.'},
					],
				},
			},
		]);
		expect(lastAssistantText(log)).toBe('My final answer.');
	});

	it('takes a plain-string assistant content as the text', () => {
		const log = jsonl([
			{type: 'message', message: {role: 'assistant', content: 'All done.'}},
		]);
		expect(lastAssistantText(log)).toBe('All done.');
	});

	it('skips a tool-call-only assistant turn (no text), using the last TEXT turn', () => {
		const log = jsonl([
			{
				type: 'message',
				message: {
					role: 'assistant',
					content: [{type: 'text', text: 'verdict'}],
				},
			},
			{
				type: 'message',
				message: {
					role: 'assistant',
					content: [{type: 'toolCall', name: 'read'}],
				},
			},
		]);
		// The tool-only turn is not an answer; the earlier text turn is the answer.
		expect(lastAssistantText(log)).toBe('verdict');
	});

	it('returns undefined when the only assistant turn is tool-calls (no text)', () => {
		const log = jsonl([
			{
				type: 'message',
				message: {
					role: 'assistant',
					content: [{type: 'toolCall', name: 'bash'}],
				},
			},
		]);
		expect(lastAssistantText(log)).toBeUndefined();
	});

	it('returns undefined for an empty / assistant-text-less log', () => {
		expect(lastAssistantText('')).toBeUndefined();
		expect(
			lastAssistantText(
				jsonl([
					{type: 'session', id: 'a'},
					{type: 'message', message: {role: 'user', content: 'hi'}},
				]),
			),
		).toBeUndefined();
	});

	it('skips malformed / half-written trailing lines without throwing', () => {
		const log =
			JSON.stringify({
				type: 'message',
				message: {role: 'assistant', content: 'kept'},
			}) + '\n{"type":"message","message":{"role":"assi';
		expect(() => lastAssistantText(log)).not.toThrow();
		expect(lastAssistantText(log)).toBe('kept');
	});
});

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-watch-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Wait until `predicate()` holds (polling), or fail after `timeoutMs`. */
async function waitFor(
	predicate: () => boolean,
	timeoutMs = 2000,
): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error('waitFor timed out');
		}
		await new Promise((r) => setTimeout(r, 10));
	}
}

describe('SessionTailer — tails the KNOWN session-file path (no stale-sibling race)', () => {
	it('tails the EXACT given file, ignoring a pre-existing newer sibling in the same dir', async () => {
		// The stale-sibling race the fix eliminates: a PRIOR run's log sits in the
		// same dir (newer mtime). The tailer must read the KNOWN path, NOT the
		// newest sibling.
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const stale = join(dir, 'prior-run.jsonl');
		writeFileSync(
			stale,
			JSON.stringify({
				type: 'message',
				message: {role: 'assistant', content: 'STALE prior run'},
			}) + '\n',
		);
		const known = join(dir, 'this-run.jsonl');

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionFile: known,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 10,
		});
		tailer.start();
		// pi writes the KNOWN file a moment after launch.
		await new Promise((r) => setTimeout(r, 30));
		writeFileSync(
			known,
			JSON.stringify({
				type: 'message',
				message: {role: 'assistant', content: 'THIS run'},
			}) + '\n',
		);
		await waitFor(() => surfaced.length >= 1);
		await tailer.stop();
		// Only the KNOWN file's content is surfaced; the stale sibling is never read.
		expect(surfaced).toEqual(['THIS run', '✓ agent finished']);
	});
});

describe('SessionTailer — concurrent tail of a GROWING session .jsonl', () => {
	it('surfaces assistant text + tool starts as the file grows; skips the rest', async () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const log = join(dir, 'session.jsonl');
		writeFileSync(log, ''); // log exists before the agent writes events.

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionFile: log,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 10,
		});
		tailer.start();

		// Append real-shaped records one-by-one (the live, growing log).
		appendFileSync(log, JSON.stringify({type: 'session', id: 'a'}) + '\n'); // skip
		appendFileSync(
			log,
			JSON.stringify({
				type: 'message',
				message: {role: 'user', content: [{type: 'text', text: 'prompt'}]},
			}) + '\n', // skip
		);
		appendFileSync(
			log,
			JSON.stringify({
				type: 'message',
				message: {
					role: 'assistant',
					content: [
						{type: 'text', text: 'on it'},
						{type: 'toolCall', name: 'read'},
					],
				},
			}) + '\n',
		);
		appendFileSync(
			log,
			JSON.stringify({
				type: 'message',
				message: {role: 'toolResult', toolName: 'read', content: 'body'},
			}) + '\n', // skip
		);

		await waitFor(() => surfaced.length >= 2);
		await tailer.stop();

		// The final drain plus stop() append the process-exit finished line.
		expect(surfaced).toEqual(['on it', '▶ read', '✓ agent finished']);
	});

	it('emits "✓ agent finished" once on stop() — PROCESS EXIT, not a log event', async () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const log = join(dir, 'session.jsonl');
		writeFileSync(log, '');

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionFile: log,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 10,
		});
		tailer.start();
		// No log events at all — finished is still emitted on exit.
		await tailer.stop();
		expect(surfaced).toEqual(['✓ agent finished']);
		// stop() is idempotent and does NOT re-emit finished.
		await tailer.stop();
		expect(surfaced).toEqual(['✓ agent finished']);
	});

	it('buffers a partial trailing line until its newline arrives (split write)', async () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const log = join(dir, 'session.jsonl');
		writeFileSync(log, '');

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionFile: log,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 10,
		});
		tailer.start();

		// Write an assistant toolCall record in two halves; newline in the second.
		appendFileSync(
			log,
			'{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall",',
		);
		await new Promise((r) => setTimeout(r, 30));
		expect(surfaced).toEqual([]); // nothing surfaced from the partial line yet.
		appendFileSync(log, '"name":"bash"}]}}\n');

		await waitFor(() => surfaced.length >= 1);
		await tailer.stop();
		expect(surfaced).toEqual(['▶ bash', '✓ agent finished']);
	});

	it('waits for the log to APPEAR, then tails it (pi creates it once it starts)', async () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const log = join(dir, 'session.jsonl');
		// NB: the log does NOT exist yet when the tailer starts.

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionFile: log,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 10,
		});
		tailer.start();

		await new Promise((r) => setTimeout(r, 30));
		writeFileSync(
			log,
			JSON.stringify({
				type: 'message',
				message: {role: 'assistant', content: 'hello'},
			}) + '\n',
		);

		await waitFor(() => surfaced.length >= 1);
		await tailer.stop();
		expect(surfaced).toEqual(['hello', '✓ agent finished']);
	});

	it('a final drain on stop() catches events written just before exit', async () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const log = join(dir, 'session.jsonl');
		writeFileSync(log, '');

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionFile: log,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 1000, // long poll → only the stop() drain will catch it.
		});
		tailer.start();
		appendFileSync(
			log,
			JSON.stringify({
				type: 'message',
				message: {role: 'assistant', content: 'late'},
			}) + '\n',
		);
		await tailer.stop(); // the final drain must surface it.
		expect(surfaced).toEqual(['late', '✓ agent finished']);
	});
});

describe('lastAssistantTurn: stop reason + usage (the output-cap signal)', () => {
	/** One assistant record carrying a stop reason (either key) + usage. */
	function turn(
		text: string,
		extra: {stopReason?: unknown; stop_reason?: unknown; usage?: unknown} = {},
	): string {
		return (
			JSON.stringify({
				type: 'message',
				message: {
					role: 'assistant',
					content: [{type: 'text', text}],
					...extra,
				},
			}) + '\n'
		);
	}

	/**
	 * A synthetic pi-shaped assistant record, modelled on a real pi session-log
	 * line: pi's camelCase `stopReason`, `usage.output` alongside the other usage
	 * counters, and NO snake_case `stop_reason` key at all.
	 */
	function piTurn(text: string, stopReason: string, output: number): string {
		return (
			JSON.stringify({
				type: 'message',
				id: '20ec350b',
				parentId: 'e07b924d',
				timestamp: '2026-09-28T20:41:33.578Z',
				message: {
					role: 'assistant',
					content: [{type: 'text', text}],
					api: 'anthropic-messages',
					provider: 'anthropic',
					model: 'claude-sonnet-4',
					usage: {
						input: 2,
						output,
						cacheRead: 45926,
						cacheWrite: 559,
						totalTokens: 46487 + output,
						cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
					},
					stopReason,
					timestamp: 1790628090477,
					responseId: 'msg_011CfWV8RFTLP2VrwjevaCNA',
				},
			}) + '\n'
		);
	}

	it("returns the text + the last turn's stop reason + usage.output_tokens", () => {
		const log =
			turn('first', {stop_reason: 'end_turn', usage: {output: 10}}) +
			turn('final', {stop_reason: 'max_tokens', usage: {output_tokens: 16384}});
		const t = lastAssistantTurn(log);
		expect(t.text).toBe('final');
		expect(t.stopReason).toBe('max_tokens');
		expect(t.outputTokens).toBe(16384);
		// lastAssistantText still returns just the text (backward compat).
		expect(lastAssistantText(log)).toBe('final');
	});

	it('reads `usage.output` (the pi-session shape) OR `usage.output_tokens`', () => {
		const a = turn('a', {usage: {output: 4096}});
		expect(lastAssistantTurn(a).outputTokens).toBe(4096);
		const b = turn('b', {usage: {output_tokens: 8192}});
		expect(lastAssistantTurn(b).outputTokens).toBe(8192);
	});

	it("a pi-shaped turn that ended normally (stopReason 'stop') with output tokens is NOT output-capped", () => {
		const t = lastAssistantTurn(piTurn('Here is my verdict: ...', 'stop', 285));
		expect(t.stopReason).toBe('stop');
		expect(t.outputTokens).toBe(285);
		expect(isOutputCappedTurn(t)).toBe(false);
	});

	it("a pi-shaped turn with stopReason 'toolUse' / 'error' / 'aborted' is NOT output-capped", () => {
		for (const reason of ['toolUse', 'error', 'aborted']) {
			expect(
				isOutputCappedTurn(lastAssistantTurn(piTurn('x', reason, 900))),
			).toBe(false);
		}
	});

	it("a pi-shaped turn that hit the cap (stopReason 'length') IS output-capped", () => {
		const t = lastAssistantTurn(
			piTurn('{"verdict": "block", "findings": [', 'length', 16384),
		);
		expect(t.stopReason).toBe('length');
		expect(isOutputCappedTurn(t)).toBe(true);
		expect(t.outputTokens).toBe(16384);
		// And the text itself is the truncated (unparseable) body.
		expect(t.text).not.toMatch(/\}/);
	});

	it('the raw API `max_tokens` (snake_case `stop_reason` fallback) is also the cap signal', () => {
		const t = lastAssistantTurn(
			turn('partial', {stop_reason: 'max_tokens', usage: {output: 16384}}),
		);
		expect(isOutputCappedTurn(t)).toBe(true);
	});

	it('the camelCase `stopReason` wins over a snake_case `stop_reason` on the same record', () => {
		const t = lastAssistantTurn(
			turn('x', {
				stopReason: 'stop',
				stop_reason: 'max_tokens',
				usage: {output: 5},
			}),
		);
		expect(t.stopReason).toBe('stop');
		expect(isOutputCappedTurn(t)).toBe(false);
	});

	it('a natural turn-end (end_turn / tool_use) is NOT a cap signal', () => {
		expect(
			isOutputCappedTurn({stopReason: 'end_turn', outputTokens: 100}),
		).toBe(false);
		expect(
			isOutputCappedTurn({stopReason: 'tool_use', outputTokens: 100}),
		).toBe(false);
	});

	it('NO recorded stop reason (absent / null) is NOT a cap, however many tokens were produced', () => {
		expect(
			isOutputCappedTurn({stopReason: undefined, outputTokens: 16384}),
		).toBe(false);
		const t = lastAssistantTurn(
			turn('answer', {stop_reason: null, usage: {output: 16384}}),
		);
		expect(t.stopReason).toBeUndefined();
		expect(isOutputCappedTurn(t)).toBe(false);
	});

	it('a cap signal with NO produced tokens is NOT a cap (nothing was emitted)', () => {
		expect(isOutputCappedTurn({stopReason: 'length', outputTokens: 0})).toBe(
			false,
		);
		expect(
			isOutputCappedTurn({stopReason: 'length', outputTokens: undefined}),
		).toBe(false);
	});

	it('the cap signal and finalStopReason read the SAME stop reason off the final text turn', () => {
		for (const reason of ['stop', 'length']) {
			const t = lastAssistantTurn(piTurn('x', reason, 10));
			expect(t.stopReason).toBe(reason);
			expect(t.finalStopReason).toBe(reason);
		}
	});

	it('a turn with no stop reason/usage yields undefined signals (not a cap)', () => {
		const log = turn('answer'); // no stop reason/usage
		const t = lastAssistantTurn(log);
		expect(t.text).toBe('answer');
		expect(t.stopReason).toBeUndefined();
		expect(t.outputTokens).toBeUndefined();
		expect(isOutputCappedTurn(t)).toBe(false);
	});
});

describe("cutOffTurnOf: how the run's FINAL assistant turn ended (task a-truncated-agent-turn-routes-as-agent-failed)", () => {
	/** One pi-shaped assistant record (pi's own camelCase `stopReason` key). */
	function record(message: Record<string, unknown>): string {
		return (
			JSON.stringify({
				type: 'message',
				message: {role: 'assistant', ...message},
			}) + '\n'
		);
	}

	it('a final THINKING-ONLY turn stopped on `length` is a cut-off, even though an earlier turn had text', () => {
		// The observed shape: the whole output budget went into a thinking block,
		// no text, no tool call. The text-turn reader alone cannot see it.
		const log =
			record({
				content: [{type: 'text', text: 'Let me look at do.ts.'}],
				stopReason: 'toolUse',
			}) +
			record({
				content: [{type: 'thinking', thinking: '...'}],
				stopReason: 'length',
				usage: {output: 16384},
			});
		const t = lastAssistantTurn(log);
		expect(t.text).toBe('Let me look at do.ts.');
		expect(t.finalStopReason).toBe('length');
		expect(cutOffTurnOf(t)).toEqual({cause: 'length'});
	});

	it('an `error` stop carries the provider errorMessage', () => {
		const log = record({
			content: [],
			stopReason: 'error',
			errorMessage: 'provider said no',
		});
		expect(cutOffTurnOf(lastAssistantTurn(log))).toEqual({
			cause: 'error',
			errorMessage: 'provider said no',
		});
	});

	it('a later normal turn supersedes an earlier cut-off (pi retried and finished)', () => {
		const log =
			record({content: [], stopReason: 'error', errorMessage: 'x'}) +
			record({content: [{type: 'text', text: 'done'}], stopReason: 'stop'});
		expect(cutOffTurnOf(lastAssistantTurn(log))).toBeUndefined();
	});

	it('`stop`, `toolUse`, `aborted` and a missing stop reason are NOT cut-offs', () => {
		for (const stopReason of ['stop', 'toolUse', 'aborted', undefined]) {
			const log = record({
				content: [{type: 'text', text: 'hi'}],
				...(stopReason === undefined ? {} : {stopReason}),
			});
			expect(cutOffTurnOf(lastAssistantTurn(log))).toBeUndefined();
		}
		expect(cutOffTurnOf(lastAssistantTurn(''))).toBeUndefined();
	});

	it('falls back to the snake_case `stop_reason` key', () => {
		const log = record({content: [], stop_reason: 'length'});
		expect(cutOffTurnOf(lastAssistantTurn(log))).toEqual({cause: 'length'});
	});
});
