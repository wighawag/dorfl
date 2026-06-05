import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, appendFileSync} from 'node:fs';
import {
	formatWatchEvent,
	findSessionLog,
	SessionTailer,
} from '../src/watch-session.js';
import {makeScratch, type Scratch} from './helpers/gitRepo.js';

/**
 * `do --watch` observer tests (slice `do-watch`). Two layers, both house-style
 * (a throwaway scratch dir + a stubbed/growing session `.jsonl`, no real pi):
 *
 *   1. `formatWatchEvent` — the pure PARITY core with `ar-run.sh --watch`'s `jq`
 *      filter: `tool_start` → `▶ tool` (cyan), assistant `message_end` → text,
 *      `agent_end` → `✓ agent finished` (green), everything else skipped.
 *   2. `SessionTailer` — tails a GROWING `.jsonl`, surfaces the same high-signal
 *      events as they are appended (concurrency), and never throws on a
 *      half-written line.
 */

// The raw ANSI marker coloured output must contain (and plain must not).
const ESC = '\u001b[';

describe('formatWatchEvent — parity with ar-run.sh --watch (jq filter)', () => {
	it('tool_start → "▶ <tool>"', () => {
		const out = formatWatchEvent(
			JSON.stringify({type: 'tool_start', tool: 'edit'}),
			false,
		);
		expect(out).toBe('▶ edit');
	});

	it('tool_start with no tool name falls back to "tool" (.tool // "tool")', () => {
		const out = formatWatchEvent(JSON.stringify({type: 'tool_start'}), false);
		expect(out).toBe('▶ tool');
	});

	it('assistant message_end → the concatenated text parts', () => {
		const out = formatWatchEvent(
			JSON.stringify({
				type: 'message_end',
				message: {
					role: 'assistant',
					content: [
						{type: 'text', text: 'Hello '},
						{type: 'thinking', text: 'IGNORED'},
						{type: 'text', text: 'world'},
					],
				},
			}),
			false,
		);
		expect(out).toBe('Hello world');
	});

	it('agent_end → "✓ agent finished"', () => {
		const out = formatWatchEvent(JSON.stringify({type: 'agent_end'}), false);
		expect(out).toBe('✓ agent finished');
	});

	it('skips a NON-assistant message_end (e.g. the user turn)', () => {
		const out = formatWatchEvent(
			JSON.stringify({
				type: 'message_end',
				message: {role: 'user', content: [{type: 'text', text: 'prompt'}]},
			}),
			false,
		);
		expect(out).toBeUndefined();
	});

	it('skips every other event type (tool_end, message_start, …)', () => {
		expect(
			formatWatchEvent(JSON.stringify({type: 'tool_end'}), false),
		).toBeUndefined();
		expect(
			formatWatchEvent(JSON.stringify({type: 'message_start'}), false),
		).toBeUndefined();
		expect(
			formatWatchEvent(JSON.stringify({type: 'agent_start'}), false),
		).toBeUndefined();
	});

	it('skips blank lines and malformed JSON (a half-written trailing line) — never throws', () => {
		expect(formatWatchEvent('', false)).toBeUndefined();
		expect(formatWatchEvent('   ', false)).toBeUndefined();
		expect(() =>
			formatWatchEvent('{"type":"tool_start","tool":"ed', false),
		).not.toThrow();
		expect(
			formatWatchEvent('{"type":"tool_start","tool":"ed', false),
		).toBeUndefined();
	});

	it('emits ANSI colour for tool_start/agent_end when color=true, plain otherwise', () => {
		const toolColor = formatWatchEvent(
			JSON.stringify({type: 'tool_start', tool: 'edit'}),
			true,
		)!;
		const endColor = formatWatchEvent(
			JSON.stringify({type: 'agent_end'}),
			true,
		)!;
		expect(toolColor).toContain(ESC);
		expect(endColor).toContain(ESC);

		const toolPlain = formatWatchEvent(
			JSON.stringify({type: 'tool_start', tool: 'edit'}),
			false,
		)!;
		expect(toolPlain).not.toContain(ESC);
	});
});

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-watch-');
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

describe('findSessionLog — locate the .jsonl in a pi session dir', () => {
	it('returns undefined for a missing dir / a dir with no .jsonl', () => {
		expect(findSessionLog(join(scratch.root, 'nope'))).toBeUndefined();
		const empty = join(scratch.root, 'empty');
		mkdirSync(empty, {recursive: true});
		writeFileSync(join(empty, 'notes.txt'), 'x');
		expect(findSessionLog(empty)).toBeUndefined();
	});

	it('finds the .jsonl log when present', () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const log = join(dir, 'session-abc.jsonl');
		writeFileSync(log, '');
		expect(findSessionLog(dir)).toBe(log);
	});
});

describe('SessionTailer — concurrent tail of a GROWING .jsonl', () => {
	it('surfaces tool_start / assistant message_end / agent_end and skips the rest, as the file grows', async () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const log = join(dir, 'session.jsonl');
		writeFileSync(log, ''); // log exists before the agent writes events.

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionDir: dir,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 10,
		});
		tailer.start();

		// Append events one-by-one (simulating the live, growing log).
		appendFileSync(
			log,
			JSON.stringify({type: 'agent_start'}) + '\n', // skipped
		);
		appendFileSync(
			log,
			JSON.stringify({type: 'tool_start', tool: 'edit'}) + '\n',
		);
		appendFileSync(
			log,
			JSON.stringify({type: 'tool_end', tool: 'edit'}) + '\n', // skipped
		);
		appendFileSync(
			log,
			JSON.stringify({
				type: 'message_end',
				message: {role: 'assistant', content: [{type: 'text', text: 'hi'}]},
			}) + '\n',
		);
		appendFileSync(log, JSON.stringify({type: 'agent_end'}) + '\n');

		await waitFor(() => surfaced.length >= 3);
		await tailer.stop();

		expect(surfaced).toEqual(['▶ edit', 'hi', '✓ agent finished']);
	});

	it('buffers a partial trailing line until its newline arrives (split write)', async () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const log = join(dir, 'session.jsonl');
		writeFileSync(log, '');

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionDir: dir,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 10,
		});
		tailer.start();

		// Write a tool_start event in two halves, the newline only in the second.
		appendFileSync(log, '{"type":"tool_start",');
		await new Promise((r) => setTimeout(r, 30));
		expect(surfaced).toEqual([]); // nothing surfaced from the partial line yet.
		appendFileSync(log, '"tool":"bash"}\n');

		await waitFor(() => surfaced.length >= 1);
		await tailer.stop();
		expect(surfaced).toEqual(['▶ bash']);
	});

	it('waits for the log to APPEAR, then tails it (pi creates it once it starts)', async () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const log = join(dir, 'session.jsonl');
		// NB: the log does NOT exist yet when the tailer starts.

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionDir: dir,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 10,
		});
		tailer.start();

		await new Promise((r) => setTimeout(r, 30));
		writeFileSync(log, JSON.stringify({type: 'agent_end'}) + '\n');

		await waitFor(() => surfaced.length >= 1);
		await tailer.stop();
		expect(surfaced).toEqual(['✓ agent finished']);
	});

	it('a final drain on stop() catches events written just before exit', async () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		const log = join(dir, 'session.jsonl');
		writeFileSync(log, '');

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionDir: dir,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 1000, // long poll → only the stop() drain will catch it.
		});
		tailer.start();
		appendFileSync(log, JSON.stringify({type: 'agent_end'}) + '\n');
		await tailer.stop(); // the final drain must surface it.
		expect(surfaced).toEqual(['✓ agent finished']);
	});
});
