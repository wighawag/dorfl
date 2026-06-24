import {describe, it, expect} from 'vitest';
import {shouldUseColor, formatProposeNextStep} from '../src/output.js';

// The raw ANSI marker any colored output must contain (and plain output must not).
const ESC = '\u001b[';

describe('shouldUseColor — TTY/NO_COLOR rule', () => {
	it('true on an interactive TTY with NO_COLOR unset', () => {
		expect(shouldUseColor({isTTY: true}, {})).toBe(true);
	});

	it('false when stdout is not a TTY (piped / redirected)', () => {
		expect(shouldUseColor({isTTY: false}, {})).toBe(false);
		expect(shouldUseColor({}, {})).toBe(false);
		expect(shouldUseColor(undefined, {})).toBe(false);
	});

	it('false on a TTY when NO_COLOR is set (even to empty string)', () => {
		expect(shouldUseColor({isTTY: true}, {NO_COLOR: '1'})).toBe(false);
		expect(shouldUseColor({isTTY: true}, {NO_COLOR: ''})).toBe(false);
	});
});

describe('formatProposeNextStep — visually-distinct next step', () => {
	const base = {
		branch: 'work/zeta',
		arbiter: 'origin',
		requestOpened: false,
	};

	it('is surrounded by blank lines (separated from log noise)', () => {
		const block = formatProposeNextStep({...base, color: false});
		const lines = block.split('\n');
		expect(lines[0]).toBe('');
		expect(lines[lines.length - 1]).toBe('');
	});

	it('states the pushed branch/ref and the exact next command (push-only)', () => {
		const block = formatProposeNextStep({...base, color: false});
		expect(block).toContain('work/zeta');
		expect(block).toContain('origin/work/zeta');
		expect(block).toContain('gh pr create --head work/zeta');
	});

	it('reflects an opened review when the provider created one', () => {
		const block = formatProposeNextStep({
			...base,
			requestOpened: true,
			color: false,
		});
		expect(block).toContain('opened a review');
		expect(block).toContain('origin/work/zeta');
	});

	it('includes a heading marker so it stands out', () => {
		const block = formatProposeNextStep({...base, color: false});
		expect(block).toContain('Next step');
	});

	it('emits ANSI color codes when color is on (TTY)', () => {
		const block = formatProposeNextStep({...base, color: true});
		expect(block).toContain(ESC);
	});

	it('emits NO ANSI codes when color is off (piped / NO_COLOR)', () => {
		const block = formatProposeNextStep({...base, color: false});
		expect(block).not.toContain(ESC);
	});
});
