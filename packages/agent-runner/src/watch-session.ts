import {existsSync, readdirSync, statSync} from 'node:fs';
import {open, type FileHandle} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * The **`do --watch` observer** (slice `do-watch`, option (a)) — a READ-ONLY
 * concurrent tail of the pi session `.jsonl` event log, restoring for `do` the
 * live agent-conversation view `ar-run.sh --watch` gave.
 *
 * `ar-run.sh --watch` piped `pi -p --mode json | jq` to surface the high-signal
 * events; `do` runs the agent CAPTURED through the harness seam, so that live
 * view was lost. The pi adapter already writes a session `.jsonl` event log to
 * its `--session-dir` (`piSessionDir(dir)`). This module tails THAT growing log
 * and pretty-prints the same events the `jq` filter surfaced — parity:
 *
 *   - `tool_start`                                  → `▶ <tool>`        (cyan)
 *   - `message_end` where `message.role=="assistant"` → the assistant text
 *   - `agent_end`                                   → `✓ agent finished` (green)
 *   - everything else                               → skipped.
 *
 * The JSONL is parsed in TS (NO `jq` — that bash dependency is part of what `do`
 * replaces). It is a PURE OBSERVER: it only READS the log; it never changes the
 * run's outcome, gate, integration, git, or exit code. Colour is honoured ONLY
 * on a TTY / when `NO_COLOR` is unset (the same rule as `output.ts`), threaded
 * in by the caller as a boolean.
 */

// The same conventional ANSI codes `ar-run.sh`'s jq filter emitted (cyan tool
// marker, green finished marker, reset). Colour is applied ONLY when the caller
// passes `color: true` (its TTY/NO_COLOR decision); plain otherwise.
const CYAN = '\u001b[36m';
const GREEN = '\u001b[32m';
const RESET = '\u001b[0m';

/** Wrap `text` in `code` + reset when `color`, else return it unchanged. */
function paint(text: string, color: boolean, code: string): string {
	return color ? `${code}${text}${RESET}` : text;
}

/**
 * Parse ONE pi session `.jsonl` line and format it into the high-signal line to
 * surface — or `undefined` to SKIP it (the `else empty` arm of the `jq`
 * filter). This is the pure, unit-testable core of the parity:
 *
 *   - `tool_start`                       → `▶ <tool>` (cyan; `tool` defaults to
 *                                          `tool` when absent, like `.tool // "tool"`)
 *   - `message_end` + assistant role     → the assistant text (concatenated text
 *                                          parts, like the `jq` `.content[]` select)
 *   - `agent_end`                        → `✓ agent finished` (green)
 *   - anything else / blank / malformed  → `undefined` (skipped — never throws).
 *
 * Malformed JSON is skipped (not thrown): a partially-written trailing line in a
 * growing log must not crash the observer.
 */
export function formatWatchEvent(
	line: string,
	color: boolean,
): string | undefined {
	const trimmed = line.trim();
	if (trimmed === '') {
		return undefined;
	}
	let event: unknown;
	try {
		event = JSON.parse(trimmed);
	} catch {
		// A half-written trailing line in a growing log — skip, never throw.
		return undefined;
	}
	if (typeof event !== 'object' || event === null) {
		return undefined;
	}
	const e = event as Record<string, unknown>;
	switch (e.type) {
		case 'tool_start': {
			const tool =
				typeof e.tool === 'string' && e.tool !== '' ? e.tool : 'tool';
			return paint(`▶ ${tool}`, color, CYAN);
		}
		case 'message_end': {
			const message = e.message as Record<string, unknown> | undefined;
			if (!message || message.role !== 'assistant') {
				return undefined;
			}
			const text = assistantText(message.content);
			return text === '' ? undefined : text;
		}
		case 'agent_end':
			return paint('✓ agent finished', color, GREEN);
		default:
			return undefined;
	}
}

/**
 * Extract the assistant text from a `message_end` `message.content`, mirroring
 * the `jq` `(.message.content[]? | select(.type=="text") | .text)` projection:
 * concatenate the `text` of every `{type:"text"}` part. Tolerates a plain-string
 * content (some shapes carry the text directly) and non-array/absent content.
 */
function assistantText(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		return '';
	}
	const parts: string[] = [];
	for (const part of content) {
		if (
			typeof part === 'object' &&
			part !== null &&
			(part as Record<string, unknown>).type === 'text' &&
			typeof (part as Record<string, unknown>).text === 'string'
		) {
			parts.push((part as Record<string, unknown>).text as string);
		}
	}
	return parts.join('');
}

/** The session `.jsonl` file extension pi writes its event log under. */
const SESSION_LOG_EXT = '.jsonl';

/**
 * Find the session `.jsonl` event log inside a pi `--session-dir`, or
 * `undefined` if none exists yet. pi writes a single session file there; when
 * more than one is present (a reused dir) the most-recently-modified is chosen,
 * so a fresh run's log is tailed rather than a stale one.
 */
export function findSessionLog(sessionDir: string): string | undefined {
	if (!existsSync(sessionDir)) {
		return undefined;
	}
	let newest: {path: string; mtimeMs: number} | undefined;
	for (const name of readdirSync(sessionDir)) {
		if (!name.endsWith(SESSION_LOG_EXT)) {
			continue;
		}
		const path = join(sessionDir, name);
		let mtimeMs: number;
		try {
			mtimeMs = statSync(path).mtimeMs;
		} catch {
			continue;
		}
		if (newest === undefined || mtimeMs >= newest.mtimeMs) {
			newest = {path, mtimeMs};
		}
	}
	return newest?.path;
}

export interface SessionTailerOptions {
	/** The pi session dir to tail the `.jsonl` event log from. */
	sessionDir: string;
	/** Emit ANSI colour (the caller's TTY/`NO_COLOR` decision). */
	color: boolean;
	/** Where formatted high-signal lines are written (defaults to stderr). */
	sink?: (line: string) => void;
	/** How often (ms) to poll for new bytes / the log's appearance. */
	pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 100;

/**
 * A concurrent, READ-ONLY tail of the pi session `.jsonl`. It polls the session
 * dir for the log (which the pi adapter creates only once pi starts), then reads
 * newly-appended bytes, splits them into complete lines, and surfaces each via
 * {@link formatWatchEvent}. A partial trailing line is buffered until its
 * newline arrives, so an event split across two reads is never mis-parsed.
 *
 * It is a pure observer: nothing it does feeds back into the run. `start()`
 * begins polling; `stop()` performs one final drain (to catch events written
 * just before the agent exited) and releases the file handle. Created and driven
 * by `do --watch` ALONGSIDE the (async) agent launch.
 */
export class SessionTailer {
	private readonly sessionDir: string;
	private readonly color: boolean;
	private readonly sink: (line: string) => void;
	private readonly pollIntervalMs: number;

	private handle: FileHandle | undefined;
	private offset = 0;
	private pending = '';
	private timer: NodeJS.Timeout | undefined;
	private polling = false;
	private stopped = false;

	constructor(options: SessionTailerOptions) {
		this.sessionDir = options.sessionDir;
		this.color = options.color;
		this.sink = options.sink ?? ((line) => process.stderr.write(`${line}\n`));
		this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	}

	/** Begin polling the session dir for the log and tailing its new bytes. */
	start(): void {
		if (this.timer !== undefined || this.stopped) {
			return;
		}
		this.timer = setInterval(() => {
			void this.poll();
		}, this.pollIntervalMs);
		// `unref` so an orphaned timer never keeps the process alive past the run.
		this.timer.unref?.();
	}

	/**
	 * Stop tailing: one final drain (events written right before the agent exited
	 * must still be surfaced), then release the handle. Idempotent.
	 */
	async stop(): Promise<void> {
		this.stopped = true;
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		await this.drain();
		if (this.handle !== undefined) {
			await this.handle.close();
			this.handle = undefined;
		}
	}

	/** One poll tick: ensure the handle is open, then drain new bytes. */
	private async poll(): Promise<void> {
		if (this.polling) {
			return; // a slow read must not overlap the next tick.
		}
		this.polling = true;
		try {
			await this.drain();
		} catch {
			// A transient read error (the log being rotated/created) — try next tick.
		} finally {
			this.polling = false;
		}
	}

	/** Open the log if not yet open, read appended bytes, surface whole lines. */
	private async drain(): Promise<void> {
		if (this.handle === undefined) {
			const logPath = findSessionLog(this.sessionDir);
			if (logPath === undefined) {
				return; // log not written yet — wait for it.
			}
			this.handle = await open(logPath, 'r');
		}
		const stats = await this.handle.stat();
		if (stats.size <= this.offset) {
			return; // no new bytes.
		}
		const length = stats.size - this.offset;
		const buffer = Buffer.alloc(length);
		const {bytesRead} = await this.handle.read(buffer, 0, length, this.offset);
		this.offset += bytesRead;
		this.pending += buffer.toString('utf8', 0, bytesRead);
		this.flushLines();
	}

	/** Split the buffer on newlines, surfacing each COMPLETE line; keep the rest. */
	private flushLines(): void {
		let newlineIndex = this.pending.indexOf('\n');
		while (newlineIndex !== -1) {
			const line = this.pending.slice(0, newlineIndex);
			this.pending = this.pending.slice(newlineIndex + 1);
			const formatted = formatWatchEvent(line, this.color);
			if (formatted !== undefined) {
				this.sink(formatted);
			}
			newlineIndex = this.pending.indexOf('\n');
		}
	}
}
