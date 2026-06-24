import {describe, it, expect} from 'vitest';
import type {Command} from 'commander';
import {buildProgram} from '../src/cli.js';

/**
 * `gc --remote-branches` CLI surface (the merged-remote-branch sweep task). Pins
 * that the sub-mode flag + its companions (`--arbiter`, `--cwd`, `--dry-run`) live
 * on the SAME `.command('gc')` block as the worktree reaper and the `--ledger`
 * sub-mode, so the one `gc` command carries all three surfaces. The sweep
 * BEHAVIOUR is covered by reap-branches.test.ts.
 */

function gcCommand(): Command {
	const program = buildProgram();
	const cmd = program.commands.find((c) => c.name() === 'gc');
	if (!cmd) {
		throw new Error("no 'gc' command registered");
	}
	return cmd;
}

describe('gc command grammar (the --remote-branches sub-mode)', () => {
	it('registers the --remote-branches sweep flag', () => {
		const flags = gcCommand().options.map((o) => o.flags);
		expect(flags.some((f) => f.includes('--remote-branches'))).toBe(true);
	});

	it('carries the sweep companions: --arbiter, --cwd, --dry-run', () => {
		const flags = gcCommand().options.map((o) => o.flags);
		expect(flags.some((f) => f.startsWith('--arbiter'))).toBe(true);
		expect(flags.some((f) => f.startsWith('--cwd'))).toBe(true);
		expect(flags.some((f) => f.startsWith('--dry-run'))).toBe(true);
	});

	it('keeps the existing gc surfaces on the SAME block (--ledger, --force, --json)', () => {
		const flags = gcCommand().options.map((o) => o.flags);
		expect(flags.some((f) => f.startsWith('--ledger'))).toBe(true);
		expect(flags.some((f) => f.startsWith('--force'))).toBe(true);
		expect(flags.some((f) => f.startsWith('--json'))).toBe(true);
	});
});
