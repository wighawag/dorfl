import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, appendFileSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {formatWatchEvent, SessionTailer} from '../src/watch-session.js';
import {makeScratch, type Scratch} from './helpers/gitRepo.js';

/**
 * `do --watch` observer tests (slices `do-watch` + `do-watch-session-log-format`).
 *
 * The watcher tails the pi `--session <path>` SESSION-PERSISTENCE log, whose records
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
					{type: 'text', text: 'Reading the brief, '},
					{type: 'text', text: 'then the PRD.'},
					{type: 'toolCall', name: 'read', arguments: {path: 'x'}},
				],
			},
		});
		expect(formatWatchEvent(record, false)).toEqual([
			'Reading the brief, then the PRD.',
			'▶ read',
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
		expect(formatWatchEvent(record, false)).toEqual(['▶ edit']);
	});

	it('a toolCall with no name falls back to "tool"', () => {
		const record = JSON.stringify({
			type: 'message',
			message: {role: 'assistant', content: [{type: 'toolCall'}]},
		});
		expect(formatWatchEvent(record, false)).toEqual(['▶ tool']);
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
			"I'll start by reading the slice brief, then its source PRD.",
			'▶ read',
			'Now editing the file.',
			'▶ edit',
			'All done — the build is green.',
		]);
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

describe('SessionTailer — concurrent tail of a GROWING session .jsonl at a KNOWN path', () => {
	it('tails the EXACT known path, NOT a pre-existing stale sibling (race gone)', async () => {
		const dir = join(scratch.root, 'session');
		mkdirSync(dir, {recursive: true});
		// A STALE prior-run sibling sits in the same dir, NEWER on disk. The old
		// newest-by-mtime selection would have latched onto it; the known-path
		// tailer must ignore it and tail only the path it was given.
		const stale = join(dir, 'stale-old-run.jsonl');
		writeFileSync(
			stale,
			JSON.stringify({
				type: 'message',
				message: {role: 'assistant', content: 'STALE — must not surface'},
			}) + '\n',
		);
		const known = join(dir, 'this-run.jsonl');
		writeFileSync(known, '');

		const surfaced: string[] = [];
		const tailer = new SessionTailer({
			sessionFile: known,
			color: false,
			sink: (line) => surfaced.push(line),
			pollIntervalMs: 10,
		});
		tailer.start();
		appendFileSync(
			known,
			JSON.stringify({
				type: 'message',
				message: {role: 'assistant', content: 'fresh run'},
			}) + '\n',
		);
		await waitFor(() => surfaced.length >= 1);
		await tailer.stop();
		expect(surfaced).toEqual(['fresh run', '✓ agent finished']);
		expect(surfaced).not.toContain('STALE — must not surface');
	});

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
