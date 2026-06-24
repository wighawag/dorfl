/**
 * A small, isolated terminal-spinner helper for the standalone
 * `agent-runner claim <slug>` CLI command (prd/task `claim-cas-spinner`).
 *
 * The push the claim CAS performs can take a few seconds (network +
 * arbiter round-trip), so the terminal looked frozen. This helper wraps
 * ONLY that CLI call site: it animates a single-line spinner on stderr
 * while {@link import('./claim-cas.js').performClaim} is in flight, and
 * tears it down cleanly on completion / SIGINT / a thrown error.
 *
 * Design constraints (all surfaced as injected seams so the helper is
 * unit-testable without real timers or a real TTY):
 *   - `stream`   — the WritableStream sink (stderr in production).
 *   - `isTTY`    — whether to animate at all. Defaults to `false` (the
 *                  non-TTY path), so tests stay deterministic by default.
 *   - `clock`    — `setInterval` / `clearInterval` pair. Defaults to a
 *                  no-op pair (no real timers in tests).
 *
 * Output contract:
 *   - In NON-TTY mode the helper is a pure no-op for animation. `note`
 *     writes `>> <message>\n` to the stream (byte-identical to today's
 *     `console.error('>> ' + message)`); `finish(result)` writes
 *     `error: <message>\n` ONLY on a non-zero exit (byte-identical to
 *     today's `if (result.exitCode !== 0) console.error('error: ' + ...)`).
 *     No new status line is introduced — silent on success, exactly as
 *     today's CLI tests and CI log scrapers expect.
 *   - In TTY mode the spinner frame is drawn/redrawn on a fake-clock
 *     tick; `note(message)` clears the current frame, writes the note
 *     line, then redraws (so notes and frames never trample each other);
 *     `finish(result)` clears the frame, restores the cursor, and writes
 *     ONE terminal status line describing the outcome.
 *   - `stop()` is the pure teardown path used for SIGINT / a thrown
 *     error: clear the frame, restore the cursor, NO status line.
 *
 * This module is consumed ONLY by the `agent-runner claim <slug>` CLI
 * surface in `cli.ts`. The autonomous `performClaim` call sites
 * (`do.ts`, `run.ts`, `start.ts`, `work-on.ts`, `continue-branch.ts`)
 * are explicitly OUT OF SCOPE and MUST NOT be wrapped — the claim-cas
 * return contract, exit codes, and seam contract are unchanged.
 */

import type {ClaimCasResult} from './claim-cas.js';

/** The clock seam: `setInterval` / `clearInterval`, faked in tests. */
export interface SpinnerClock {
	setInterval: (fn: () => void, ms: number) => unknown;
	clearInterval: (handle: unknown) => void;
}

/** The minimal writable surface the spinner needs (stderr in production). */
export interface SpinnerStream {
	write(chunk: string): boolean;
}

export interface CreateClaimSpinnerOptions {
	/** The sink the spinner animates / notes / status line are written to. */
	stream: SpinnerStream;
	/**
	 * Whether to animate at all. Defaults to `false` — the non-TTY path,
	 * which is a no-op for animation and keeps stderr byte-identical to
	 * today. Production passes `process.stdout.isTTY === true`.
	 */
	isTTY?: boolean;
	/**
	 * The `setInterval`/`clearInterval` seam. Defaults to a NO-OP pair so a
	 * test that forgets to inject a fake clock cannot accidentally spin a
	 * real timer (and so the non-TTY default truly never starts one).
	 * Production passes the global timers.
	 */
	clock?: SpinnerClock;
	/** The short label drawn next to the animating frame (e.g. `Claiming alpha…`). */
	label: string;
	/** Frame cadence in ms. Default 80ms (a calm braille spinner). */
	intervalMs?: number;
	/** The animation frames. Default: the standard 10-frame braille spinner. */
	frames?: readonly string[];
}

export interface ClaimSpinner {
	/** True iff this spinner instance will actually animate (TTY mode). */
	readonly isTTY: boolean;
	/** Begin animating (no-op in non-TTY mode, or if already started). */
	start(): void;
	/**
	 * Route the `performClaim` `note` callback through the spinner. In TTY
	 * mode this clears the current frame, writes `>> <message>\n`, then
	 * redraws the frame so notes and frames never trample each other. In
	 * non-TTY mode it writes the line directly — byte-identical to today.
	 */
	note(message: string): void;
	/**
	 * Finish with the claim result. In TTY mode: tear down (clear frame,
	 * restore cursor) and emit ONE terminal status line describing the
	 * outcome. In non-TTY mode: emit `error: <message>` ONLY on a non-zero
	 * exit, otherwise stay silent — byte-identical to today's CLI.
	 */
	finish(result: ClaimCasResult): void;
	/**
	 * Pure teardown for SIGINT / a thrown error: clear the frame and
	 * restore the cursor. NO status line. Safe to call multiple times.
	 */
	stop(): void;
}

const DEFAULT_FRAMES: readonly string[] = [
	'⠋',
	'⠙',
	'⠹',
	'⠸',
	'⠼',
	'⠴',
	'⠦',
	'⠧',
	'⠇',
	'⠏',
];
const DEFAULT_INTERVAL_MS = 80;

// Bare ANSI for hide-cursor / show-cursor / clear-current-line — kept tiny and
// inline so the helper has no runtime dependency. Only emitted in TTY mode.
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_LINE = '\r\x1b[2K';

const NOOP_CLOCK: SpinnerClock = {
	setInterval: () => undefined,
	clearInterval: () => undefined,
};

/**
 * Format the single terminal status line that replaces the spinner in TTY
 * mode. The outcome label tracks the existing exit-code semantics
 * (0=claimed / 2=lost (not claimable) / 3=contended / 1=usage-error or
 * not-ready); `result.message` is reused verbatim as the body.
 */
export function formatClaimStatusLine(result: ClaimCasResult): string {
	switch (result.outcome) {
		case 'claimed':
			return `✓ claimed — ${result.message}`;
		case 'lost':
			return `✗ not claimable — ${result.message}`;
		case 'contended':
			return `✗ contended — ${result.message}`;
		case 'not-ready':
			return `✗ not ready — ${result.message}`;
		case 'usage-error':
		default:
			return `✗ error — ${result.message}`;
	}
}

/**
 * Build a {@link ClaimSpinner} from injected seams. See the module-level
 * docstring for the contract; see the per-method JSDoc for the per-method
 * semantics in TTY vs non-TTY mode.
 */
export function createClaimSpinner(
	options: CreateClaimSpinnerOptions,
): ClaimSpinner {
	const stream = options.stream;
	const isTTY = options.isTTY === true;
	const clock = options.clock ?? NOOP_CLOCK;
	const frames = options.frames ?? DEFAULT_FRAMES;
	const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
	const label = options.label;

	let handle: unknown;
	let frameIndex = 0;
	let active = false;

	const drawFrame = (): void => {
		stream.write(`${frames[frameIndex % frames.length]} ${label}`);
	};
	const clearFrame = (): void => {
		stream.write(CLEAR_LINE);
	};
	const teardown = (): void => {
		if (!active) return;
		clock.clearInterval(handle);
		handle = undefined;
		clearFrame();
		stream.write(SHOW_CURSOR);
		active = false;
	};

	return {
		isTTY,
		start(): void {
			if (!isTTY || active) return;
			active = true;
			stream.write(HIDE_CURSOR);
			drawFrame();
			handle = clock.setInterval(() => {
				frameIndex = (frameIndex + 1) % frames.length;
				clearFrame();
				drawFrame();
			}, intervalMs);
		},
		note(message: string): void {
			if (!isTTY) {
				// Non-TTY: byte-identical to today's `console.error('>> ' + msg)`.
				stream.write(`>> ${message}\n`);
				return;
			}
			if (active) clearFrame();
			stream.write(`>> ${message}\n`);
			if (active) drawFrame();
		},
		finish(result: ClaimCasResult): void {
			if (isTTY) {
				teardown();
				stream.write(`${formatClaimStatusLine(result)}\n`);
				return;
			}
			// Non-TTY: silent on success, `error: <message>` on failure —
			// byte-identical to today's CLI behaviour.
			if (result.exitCode !== 0) {
				stream.write(`error: ${result.message}\n`);
			}
		},
		stop(): void {
			teardown();
		},
	};
}
