import {describe, it, expect} from 'vitest';
import {
	createClaimSpinner,
	formatClaimStatusLine,
	type SpinnerClock,
	type SpinnerStream,
} from '../src/cli-spinner.js';
import type {ClaimCasResult} from '../src/claim-cas.js';

/**
 * A capture stream + fake clock — the two seams the helper needs to be
 * exercised without a real TTY or a real `setInterval`.
 */
function captureStream(): SpinnerStream & {written: string} {
	const buf: string[] = [];
	return {
		write(chunk: string): boolean {
			buf.push(chunk);
			return true;
		},
		get written(): string {
			return buf.join('');
		},
	};
}

function fakeClock(): SpinnerClock & {tick(): void; intervals: number} {
	let fn: (() => void) | undefined;
	let intervals = 0;
	return {
		setInterval(callback: () => void) {
			fn = callback;
			intervals += 1;
			return {token: intervals};
		},
		clearInterval() {
			fn = undefined;
		},
		tick(): void {
			if (fn) fn();
		},
		get intervals(): number {
			return intervals;
		},
	};
}

const CLAIMED: ClaimCasResult = {
	exitCode: 0,
	outcome: 'claimed',
	message: "claimed 'alpha'",
};
const LOST: ClaimCasResult = {
	exitCode: 2,
	outcome: 'lost',
	message: "'alpha' is no longer in backlog",
};

describe('createClaimSpinner — non-TTY default (byte-identical to today)', () => {
	it('the default (no isTTY flag) does not animate at all', () => {
		const stream = captureStream();
		const clock = fakeClock();
		const spinner = createClaimSpinner({
			stream,
			clock,
			label: 'Claiming alpha…',
		});
		expect(spinner.isTTY).toBe(false);
		spinner.start();
		// No frame drawn, no setInterval armed — a TRUE no-op for animation.
		expect(stream.written).toBe('');
		expect(clock.intervals).toBe(0);
	});

	it("note writes '>> <msg>\\n' directly (matches today's `console.error('>> ' + m)`)", () => {
		const stream = captureStream();
		const spinner = createClaimSpinner({
			stream,
			isTTY: false,
			label: 'Claiming alpha…',
		});
		spinner.start();
		spinner.note('progress one');
		spinner.note('progress two');
		expect(stream.written).toBe('>> progress one\n>> progress two\n');
	});

	it('finish on a SUCCESS result is silent (no new status line in non-TTY)', () => {
		const stream = captureStream();
		const spinner = createClaimSpinner({
			stream,
			isTTY: false,
			label: 'Claiming alpha…',
		});
		spinner.start();
		spinner.finish(CLAIMED);
		expect(stream.written).toBe('');
	});

	it('finish on a FAILURE result writes `error: <msg>\\n` only (matches today)', () => {
		const stream = captureStream();
		const spinner = createClaimSpinner({
			stream,
			isTTY: false,
			label: 'Claiming alpha…',
		});
		spinner.start();
		spinner.finish(LOST);
		expect(stream.written).toBe(`error: ${LOST.message}\n`);
	});

	it('stop is a no-op in non-TTY mode (no ANSI emitted)', () => {
		const stream = captureStream();
		const spinner = createClaimSpinner({
			stream,
			isTTY: false,
			label: 'Claiming alpha…',
		});
		spinner.start();
		spinner.stop();
		expect(stream.written).toBe('');
	});
});

describe('createClaimSpinner — TTY mode (injected stream + fake clock)', () => {
	it('start hides the cursor and draws an initial frame; tick redraws the next frame', () => {
		const stream = captureStream();
		const clock = fakeClock();
		const spinner = createClaimSpinner({
			stream,
			isTTY: true,
			clock,
			label: 'Claiming alpha…',
			frames: ['A', 'B', 'C'],
		});
		spinner.start();
		expect(clock.intervals).toBe(1);
		// hide-cursor + initial frame.
		expect(stream.written).toBe('\x1b[?25lA Claiming alpha…');
		clock.tick();
		// clear-line + next frame.
		expect(stream.written).toBe(
			'\x1b[?25lA Claiming alpha…' + '\r\x1b[2KB Claiming alpha…',
		);
	});

	it('note CLEARS the current frame, writes the line, then REDRAWS — no frame chars spliced into the note', () => {
		const stream = captureStream();
		const clock = fakeClock();
		const spinner = createClaimSpinner({
			stream,
			isTTY: true,
			clock,
			label: 'Claiming alpha…',
			frames: ['A', 'B'],
		});
		spinner.start();
		// Reset the buffer to focus on the note's effect.
		const beforeNote = stream.written;
		spinner.note('progress one');
		const noteOnly = stream.written.slice(beforeNote.length);
		// The note line appears as a clean, single `>> <msg>\n` — never with
		// a spinner frame character spliced into it.
		expect(noteOnly).toContain('>> progress one\n');
		expect(noteOnly).not.toMatch(/>> A progress/);
		expect(noteOnly).not.toMatch(/>> B progress/);
		// And the redraw of the current frame follows the note.
		expect(noteOnly.endsWith('A Claiming alpha…')).toBe(true);
		// The note write is bracketed by a clear-line before it.
		expect(noteOnly.startsWith('\r\x1b[2K')).toBe(true);
	});

	it('finish tears the animation down (clear interval, restore cursor) and emits ONE status line', () => {
		const stream = captureStream();
		const clock = fakeClock();
		const spinner = createClaimSpinner({
			stream,
			isTTY: true,
			clock,
			label: 'Claiming alpha…',
			frames: ['A'],
		});
		spinner.start();
		spinner.finish(CLAIMED);
		// The tail of the stream is the clear-line + show-cursor + status line.
		expect(stream.written.endsWith(`${formatClaimStatusLine(CLAIMED)}\n`)).toBe(
			true,
		);
		expect(stream.written).toContain('\x1b[?25h'); // show-cursor restored
		// Status line counts: exactly one terminal status line.
		const lines = stream.written.split('\n').filter((l) => l.length > 0);
		const statusLines = lines.filter((l) =>
			l.includes(formatClaimStatusLine(CLAIMED)),
		);
		expect(statusLines.length).toBe(1);
		// Idempotent teardown: a second finish/stop does not re-emit ANSI state.
		const beforeStop = stream.written;
		spinner.stop();
		expect(stream.written).toBe(beforeStop);
	});

	it('finish on a FAILURE result emits a status line (NOT today’s `error: <msg>`)', () => {
		const stream = captureStream();
		const clock = fakeClock();
		const spinner = createClaimSpinner({
			stream,
			isTTY: true,
			clock,
			label: 'Claiming alpha…',
			frames: ['A'],
		});
		spinner.start();
		spinner.finish(LOST);
		expect(stream.written).toContain(formatClaimStatusLine(LOST));
		// In TTY mode the new status line REPLACES `error: <msg>`.
		expect(stream.written).not.toContain(`error: ${LOST.message}`);
	});

	it('stop tears down without writing a status line (SIGINT / thrown-error path)', () => {
		const stream = captureStream();
		const clock = fakeClock();
		const spinner = createClaimSpinner({
			stream,
			isTTY: true,
			clock,
			label: 'Claiming alpha…',
			frames: ['A'],
		});
		spinner.start();
		spinner.stop();
		// Cursor restored, no status line.
		expect(stream.written).toContain('\x1b[?25h');
		expect(stream.written).not.toContain('✓');
		expect(stream.written).not.toContain('✗');
	});
});

describe('formatClaimStatusLine — outcome-keyed status line', () => {
	it('covers each ClaimCasOutcome with a distinct label that reuses result.message', () => {
		expect(formatClaimStatusLine(CLAIMED)).toContain('claimed');
		expect(formatClaimStatusLine(CLAIMED)).toContain(CLAIMED.message);
		expect(formatClaimStatusLine(LOST)).toContain('not claimable');
		expect(
			formatClaimStatusLine({
				exitCode: 3,
				outcome: 'contended',
				message: 'transient',
			}),
		).toContain('contended');
		expect(
			formatClaimStatusLine({
				exitCode: 1,
				outcome: 'not-ready',
				message: 'blocked by X',
			}),
		).toContain('not ready');
		expect(
			formatClaimStatusLine({
				exitCode: 1,
				outcome: 'usage-error',
				message: 'no remote',
			}),
		).toContain('error');
	});
});
