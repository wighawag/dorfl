import {describe, it, expect} from 'vitest';
import type {Command} from 'commander';
import {buildProgram} from '../src/cli.js';

/**
 * `do-autopick` CLI surface — pins the variadic grammar + `-n` that the three
 * `do-*` slices grow on the ONE `.command('do')` block (this slice widens the
 * single optional positional into a VARIADIC one and adds `-n <x>`), without
 * tearing up `do-in-place`/`do-remote`'s additions. (The selection/ordering
 * behaviour is covered by do-autopick.test.ts / select-priority.test.ts.)
 */

function doCommand(): Command {
	const program = buildProgram();
	const cmd = program.commands.find((c) => c.name() === 'do');
	if (!cmd) {
		throw new Error("no 'do' command registered");
	}
	return cmd;
}

describe('do command grammar (do-autopick widens the shared block)', () => {
	it('takes a VARIADIC slug argument (zero = auto-pick, many = in sequence)', () => {
		const cmd = doCommand();
		const usage = cmd.usage();
		// Variadic + optional: `[slugs...]` (not a single required `<slug>`).
		expect(usage).toMatch(/\[slugs\.\.\.\]/);
	});

	it('adds the `-n, --number <x>` auto-pick count option', () => {
		const flags = doCommand().options.map((o) => o.flags);
		expect(flags.some((f) => f.includes('--number'))).toBe(true);
		expect(flags.some((f) => /-n\b/.test(f))).toBe(true);
	});

	it('keeps the prior do-* additions on the SAME block (--remote, --merge/--propose)', () => {
		const flags = doCommand().options.map((o) => o.flags);
		// do-remote's --remote and do-in-place's mode flags still live here.
		expect(flags.some((f) => f.startsWith('--remote'))).toBe(true);
		expect(flags.some((f) => f.startsWith('--merge'))).toBe(true);
		expect(flags.some((f) => f.startsWith('--propose'))).toBe(true);
	});

	it('describes the auto-pick / multi-arg / -n forms + tasks-first priority', () => {
		const desc = doCommand().description();
		expect(desc).toMatch(/auto-pick/i);
		expect(desc).toMatch(/in sequence/i);
		expect(desc).toMatch(/tasks-first/i);
	});
});
