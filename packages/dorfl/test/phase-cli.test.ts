import {afterEach, describe, expect, it, vi} from 'vitest';
import {CommanderError, type Command} from 'commander';
import {buildProgram} from '../src/cli.js';
import {AGENT_SPAWNING_VERBS, NON_AGENT_VERBS} from '../src/phase.js';

/**
 * The CLI surface of the CI phase mode (task `ci-split-phase-mode-and-guards`):
 * every verb is classified as agent-spawning or not (so a new verb cannot
 * escape the workflow guard), and the hidden `--phase` on `intake`, `advance`
 * and `do` is refused outside GitHub Actions at parse time.
 */

afterEach(() => {
	vi.unstubAllEnvs();
});

function command(name: string): Command {
	const cmd = buildProgram().commands.find((c) => c.name() === name);
	if (!cmd) {
		throw new Error(`no '${name}' command registered`);
	}
	return cmd;
}

describe('AGENT_SPAWNING_VERBS', () => {
	it('classifies every CLI verb as agent-spawning or explicitly not', () => {
		const verbs = buildProgram().commands.map((c) => c.name());
		const unclassified = verbs.filter(
			(v) => !AGENT_SPAWNING_VERBS.has(v) && !NON_AGENT_VERBS.has(v),
		);
		expect(unclassified).toEqual([]);
	});

	it('the two sets are disjoint and name only real verbs', () => {
		const verbs = new Set(buildProgram().commands.map((c) => c.name()));
		for (const v of AGENT_SPAWNING_VERBS) {
			expect(NON_AGENT_VERBS.has(v), v).toBe(false);
			expect(verbs.has(v), v).toBe(true);
		}
		for (const v of NON_AGENT_VERBS) {
			expect(verbs.has(v), v).toBe(true);
		}
	});

	it('includes the verbs CI runs agents with', () => {
		for (const v of ['intake', 'advance', 'do', 'run']) {
			expect(AGENT_SPAWNING_VERBS.has(v), v).toBe(true);
		}
	});
});

describe('the hidden --phase option', () => {
	it.each(['intake', 'advance', 'do'])(
		'%s carries a hidden --phase',
		(name) => {
			const opt = command(name).options.find((o) => o.long === '--phase');
			expect(opt).toBeDefined();
			expect(opt!.hidden).toBe(true);
			expect(command(name).helpInformation()).not.toMatch(/--phase/);
		},
	);

	it.each(['start', 'complete', 'run', 'verify'])(
		'%s has no --phase (laptop verbs keep one process)',
		(name) => {
			expect(command(name).options.some((o) => o.long === '--phase')).toBe(
				false,
			);
		},
	);

	it.each([
		['intake', ['intake', '1']],
		['advance', ['advance', 'some-task']],
		['do', ['do', 'some-task']],
	])(
		'%s --phase is rejected outside GitHub Actions before the action runs',
		async (_name, argv) => {
			vi.stubEnv('GITHUB_ACTIONS', '');
			const program = buildProgram();
			const sub = program.commands.find((c) => c.name() === argv[0])!;
			let stderr = '';
			sub.exitOverride();
			sub.configureOutput({writeErr: (s) => (stderr += s)});
			const action = vi.fn();
			sub.action(action);
			await expect(
				program.parseAsync(['node', 'dorfl', ...argv, '--phase', 'agent']),
			).rejects.toBeInstanceOf(CommanderError);
			expect(action).not.toHaveBeenCalled();
			expect(stderr).toMatch(/--phase/);
			expect(stderr).toMatch(/CI-only/);
			expect(stderr).toMatch(/GITHUB_ACTIONS=true/);
		},
	);

	it('parses a valid phase in GitHub Actions and rejects an unknown one', () => {
		vi.stubEnv('GITHUB_ACTIONS', 'true');
		const opt = command('advance').options.find((o) => o.long === '--phase')!;
		expect(opt.parseArg!('apply', undefined)).toBe('apply');
		expect(() => opt.parseArg!('build', undefined)).toThrow(
			/must be one of lock, agent, apply/,
		);
	});
});
