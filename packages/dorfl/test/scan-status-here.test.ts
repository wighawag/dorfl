import {describe, it, expect} from 'vitest';
import type {Command} from 'commander';
import {buildProgram} from '../src/cli.js';

/**
 * The `scan-here-and-skip-redundant-cwd` decision: `scan` and `status` grow a
 * `--here` flag (report ONLY the current repo, skip the cross-repo loop) and DROP
 * `--no-cwd` (the cwd section is now auto-suppressed when the cwd is already a
 * registered mirror, via the fetch-free `cwdSectionDisposition` pre-check; `--here`
 * is the explicit cwd-only mode). These tests pin the CLI SURFACE; the behaviour
 * of the pre-check itself lives in `cwd-section.test.ts`.
 */

/** Find a subcommand by name on a freshly-built program. */
function command(name: string): Command {
	const program = buildProgram();
	const cmd = program.commands.find((c) => c.name() === name);
	if (!cmd) {
		throw new Error(`no '${name}' command registered`);
	}
	return cmd;
}

/** The option flags ('--here', '--json', …) declared on a command. */
function optionFlags(cmd: Command): string[] {
	return cmd.options.map((o) => o.flags);
}

describe('scan --here / status --here (focus on the current repo)', () => {
	it('scan declares --here and NO LONGER declares --no-cwd', () => {
		const flags = optionFlags(command('scan'));
		expect(flags).toContain('--here');
		expect(flags).not.toContain('--no-cwd');
	});

	it('status declares --here and NO LONGER declares --no-cwd', () => {
		const flags = optionFlags(command('status'));
		expect(flags).toContain('--here');
		expect(flags).not.toContain('--no-cwd');
	});

	it("scan's --here help names it the current-repo-only / skip-registry path", () => {
		const help = command('scan').helpInformation();
		expect(help).toMatch(/--here/);
		expect(help.toLowerCase()).toMatch(/only the current repo/);
	});

	it("status's --here help names it the this-repo-only path", () => {
		const help = command('status').helpInformation();
		expect(help).toMatch(/--here/);
		expect(help.toLowerCase()).toMatch(/only the current repo/);
	});
});
