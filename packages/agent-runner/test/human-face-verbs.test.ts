import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import type {Command} from 'commander';
import {buildProgram} from '../src/cli.js';
import {performStart} from '../src/start.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `human-face-verbs` task (ADR §4): the in-place `resume` verb (+ hidden
 * `start --resume` alias) and `work-on` cd-by-default with the `--remote` FLAG
 * (migrated from the old positional `<remote> <slug>`). These tests assert the
 * CLI SURFACE (the new verb, the hidden alias, the flag grammar, the task-only
 * `prd:` rejection) plus the underlying `resume` behaviour (switch without
 * claiming).
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

/** The option flags ('--resume', '--remote <r>', …) declared on a command. */
function optionFlags(cmd: Command): string[] {
	return cmd.options.map((o) => o.flags);
}

describe('resume — the verb exists and is the in-place "continue here" face', () => {
	it('registers a top-level `resume` command', () => {
		expect(command('resume').name()).toBe('resume');
	});

	it('takes an optional [slug] (inferable from a work/<slug> branch), like start', () => {
		const usage = command('resume').usage();
		// Optional positional → wrapped in [].
		expect(usage).toMatch(/\[slug\]/);
	});

	it('its description names it the "continue here" verb WITHOUT claiming', () => {
		const desc = command('resume').description();
		expect(desc).toMatch(/without claiming/i);
		expect(desc).toMatch(/in-progress/i);
	});
});

describe('start --resume — kept as a HIDDEN alias (not in the headline help)', () => {
	it('still declares the --resume option (muscle memory)', () => {
		expect(optionFlags(command('start'))).toContain('--resume');
	});

	it('hides --resume from start\u2019s help output', () => {
		const help = command('start').helpInformation();
		// The hidden alias must NOT appear in the rendered help (it is demoted to
		// the `resume` verb); other start options still do.
		expect(help).not.toMatch(/--resume/);
		expect(help).toMatch(/--arbiter/);
	});

	it('marks the --resume option hidden', () => {
		const opt = command('start').options.find((o) => o.flags === '--resume');
		expect(opt).toBeDefined();
		// commander marks hidden options on the `hidden` field.
		expect((opt as {hidden?: boolean}).hidden).toBe(true);
	});
});

describe('work-on — --remote is a FLAG (migrated from positional <remote> <slug>)', () => {
	it('declares a --remote <r> option', () => {
		expect(optionFlags(command('work-on'))).toContain('--remote <r>');
	});

	it('takes a SINGLE required <slug> positional (no second positional <remote>)', () => {
		const usage = command('work-on').usage();
		expect(usage).toMatch(/<slug>/);
		// The old positional <remoteOrSlug>/second-slug grammar is gone.
		expect(usage).not.toMatch(/remoteOrSlug/);
		expect(command('work-on').registeredArguments).toHaveLength(1);
	});

	it('keeps --print-dir as the wrapper\u2019s plumbing (unchanged)', () => {
		expect(optionFlags(command('work-on'))).toContain('--print-dir');
	});

	it('documents the cd-by-default shell wrapper as the headline path', () => {
		const desc = command('work-on').description();
		expect(desc).toMatch(/cd you in by default/i);
		expect(desc).toMatch(/work-on\(\)\{ cd "\$\(agent-runner work-on/);
	});
});

describe('task-only (§3a): resume / work-on reject prd:, accept bare + task:', () => {
	/** Parse argv through the program, capturing a thrown SlugResolution exit. */
	async function runReject(argv: string[]): Promise<string> {
		const program = buildProgram();
		program.exitOverride();
		let captured = '';
		const origErr = console.error;
		const origExit = process.exit;
		console.error = (msg?: unknown) => {
			captured += String(msg ?? '');
		};
		// resolveTaskOnlySlug calls process.exit(1) on a prd: arg; intercept it.
		(process as {exit: unknown}).exit = ((code?: number) => {
			throw new Error(`__exit__:${code ?? 0}`);
		}) as typeof process.exit;
		try {
			await program.parseAsync(['node', 'agent-runner', ...argv]);
		} catch {
			// commander exitOverride or our exit shim throws — the message is captured.
		} finally {
			console.error = origErr;
			process.exit = origExit;
		}
		return captured;
	}

	it('resume rejects a prd: argument with "operates on tasks, not PRDs"', async () => {
		const out = await runReject(['resume', 'brief:some-prd']);
		expect(out).toMatch(/tasks, not briefs/);
	});

	it('work-on rejects a prd: argument with "operates on tasks, not PRDs"', async () => {
		const out = await runReject(['work-on', 'brief:some-prd']);
		expect(out).toMatch(/tasks, not briefs/);
	});
});

describe('resume behaviour — switches to an in-progress branch WITHOUT claiming', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-resume-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	function currentBranch(repo: string): string {
		return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
	}

	it('the `resume` verb\u2019s mode (performStart resume) re-engages an in-progress item with no claim', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const repo = seeded.repo;
		// Someone else claims it → its lock is held (the body rests in backlog/).
		const other = seeded.clone('other');
		await performClaim({
			slug: 'beta',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		// This is exactly what the `resume` verb wires: performStart({resume:true}).
		const result = await performStart({
			slug: 'beta',
			cwd: repo,
			arbiter: 'arbiter',
			resume: true,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('resumed');
		expect(result.branch).toBe('work/task-beta');
		expect(currentBranch(repo)).toBe('work/task-beta');
		// It did NOT (re-)claim: the body stays in backlog/, never moved.
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
	});
});
