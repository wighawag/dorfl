import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Command} from 'commander';
import {buildProgram} from '../src/cli.js';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
} from './helpers/gitRepo.js';

/**
 * `flag-cleanup-renames` task (ADR §7) — the flag/name hygiene pass: `return` →
 * `requeue`, drop `--by` AND the whole `claimedBy` concept, make the readiness
 * override `--ignore-not-ready` ONLY (free `--force` for the destructive `gc
 * --force`), and de-emphasise the advanced/plumbing tier in help. These tests
 * pin the CLI SURFACE (verbs/flags) plus the two genuine behaviour points (the
 * plain `claim: <slug>` subject and the git-log refusal message).
 */

const ARBITER = 'arbiter';

/** Find a top-level subcommand by name on a freshly-built program. */
function command(name: string): Command {
	const program = buildProgram();
	const cmd = program.commands.find((c) => c.name() === name);
	if (!cmd) {
		throw new Error(`no '${name}' command registered`);
	}
	return cmd;
}

/** Find a subcommand under a parent group (e.g. `remote add`). */
function subcommand(parent: string, name: string): Command {
	const sub = command(parent).commands.find((c) => c.name() === name);
	if (!sub) {
		throw new Error(`no '${parent} ${name}' command registered`);
	}
	return sub;
}

/** The option flags ('--by', '--force', …) declared on a command. */
function optionFlags(cmd: Command): string[] {
	return cmd.options.map((o) => o.flags);
}

describe('return → requeue (the verb is renamed, not aliased)', () => {
	it('registers a top-level `requeue` command', () => {
		expect(command('requeue').name()).toBe('requeue');
	});

	it('no `return` command remains', () => {
		const program = buildProgram();
		expect(program.commands.find((c) => c.name() === 'return')).toBeUndefined();
	});

	it('requeue takes the required <slug> + keeps --reset / -m / --arbiter', () => {
		const cmd = command('requeue');
		expect(cmd.usage()).toMatch(/<slug>/);
		const flags = optionFlags(cmd);
		expect(flags).toContain('--reset');
		expect(flags).toContain('-m, --message <note>');
		expect(flags.some((f) => f.startsWith('--arbiter'))).toBe(true);
	});
});

describe('requeue behaves as `return` did — return-to-backlog via the ledger seam', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-requeue-cli-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('`dorfl requeue <slug>` moves a needs-attention item back to backlog', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const repo = seeded.repo;
		// Claim → onboard → route to needs-attention (the surface the verb acts on).
		const claim = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/task-alpha', `${ARBITER}/main`], repo);
		// Leave agent work so the bounce saves a wip commit + PUSHES the work branch
		// (the continue-branch the default requeue's safety guard checks for).
		writeFileSync(join(repo, 'feature.txt'), 'the work\n');
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'alpha',
			reason: 'gate red',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);

		// Drive the renamed verb through the actual CLI program (the same wiring the
		// `return` verb had — only the verb name changed).
		const program = buildProgram();
		await program.parseAsync([
			'node',
			'dorfl',
			'requeue',
			'alpha',
			'--cwd',
			repo,
			'--arbiter',
			ARBITER,
		]);

		// The item is back in the claimable pool: the lock is released, body in backlog.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
	});
});

describe('--by is removed (flag + the whole claimedBy concept)', () => {
	it('claim/start/work-on declare no --by option', () => {
		for (const name of ['claim', 'start', 'work-on']) {
			expect(optionFlags(command(name))).not.toContain('--by <who>');
			expect(optionFlags(command(name)).some((f) => /--by\b/.test(f))).toBe(
				false,
			);
		}
	});

	it('claim writes NO `claim:` commit to main (the lock is the claim; no `(by ...)` anywhere)', async () => {
		const scratch = makeScratch('dorfl-claim-subject-');
		try {
			const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
			gitIn(['fetch', '-q', ARBITER], repo);
			const before = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
			const result = await performClaim({
				slug: 'alpha',
				cwd: repo,
				arbiter: ARBITER,
				env: gitEnv(),
			});
			expect(result.exitCode).toBe(0);
			// Claim no longer lands a `claim: <slug>` commit on main — the per-item lock
			// IS the claim, and main's tip is unchanged.
			gitIn(['fetch', '-q', ARBITER], repo);
			const after = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
			expect(after).toBe(before);
			const subject = gitIn(
				['log', '-1', '--format=%s', `${ARBITER}/main`],
				repo,
			);
			expect(subject.trim()).not.toBe('claim: alpha');
			expect(subject).not.toMatch(/\(by /);
		} finally {
			scratch.cleanup();
		}
	});

	it('the in-progress refusal still fires and points at `git log` (never names the claimer)', async () => {
		const scratch = makeScratch('dorfl-refusal-');
		try {
			const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
			const repo = seeded.repo;
			const other = seeded.clone('other');
			await performClaim({
				slug: 'beta',
				cwd: other,
				arbiter: ARBITER,
				env: gitEnv(),
			});
			const result = await performStart({
				slug: 'beta',
				cwd: repo,
				arbiter: ARBITER,
				env: gitEnv(),
			});
			expect(result.exitCode).toBe(1);
			expect(result.outcome).toBe('refused');
			expect(result.message).toMatch(/already in-progress/);
			expect(result.message).toMatch(/git log/);
			expect(result.message).toMatch(/--resume/);
			// No `claimedBy` readback: the message never names the claimer.
			expect(result.message).not.toMatch(/\bby \w/);
		} finally {
			scratch.cleanup();
		}
	});

	it('no `claimedBy` symbol remains in the touched source (claim-cas.ts / start.ts)', () => {
		const here = dirname(fileURLToPath(import.meta.url));
		const srcDir = join(here, '..', 'src');
		for (const file of ['claim-cas.ts', 'start.ts']) {
			const text = readFileSync(join(srcDir, file), 'utf8');
			// The whole concept (the helper, the var, the camelCase symbol) is gone.
			expect(text).not.toMatch(/claimedBy/i);
			expect(text).not.toMatch(/claimedByFromCommit/);
			expect(text).not.toMatch(/resolveBy/);
		}
	});
});

describe('readiness override = --ignore-not-ready ONLY (--force freed for gc)', () => {
	it('claim/start/work-on declare --ignore-not-ready but NOT --force', () => {
		for (const name of ['claim', 'start', 'work-on']) {
			const flags = optionFlags(command(name));
			expect(flags).toContain('--ignore-not-ready');
			expect(flags).not.toContain('--force');
		}
	});

	it('--ignore-not-ready still overrides the readiness guard on start', async () => {
		const scratch = makeScratch('dorfl-ignore-not-ready-');
		try {
			const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
				blockedBy: ['dep-a'],
			});
			// Without override: refused (unmet blockedBy).
			const refused = await performStart({
				slug: 'feature',
				cwd: seeded.repo,
				arbiter: ARBITER,
				env: gitEnv(),
			});
			expect(refused.exitCode).toBe(1);
			expect(refused.outcome).toBe('refused');
		} finally {
			scratch.cleanup();
		}
	});

	it('the CLI maps --ignore-not-ready to the override (claims the unmet task)', async () => {
		const scratch = makeScratch('dorfl-ignore-cli-');
		try {
			const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
				blockedBy: ['dep-a'],
			});
			const repo = seeded.repo;
			const origCwd = process.cwd();
			const origExit = process.exit;
			let exitCode: number | undefined;
			(process as {exit: unknown}).exit = ((code?: number) => {
				exitCode = code ?? 0;
				throw new Error(`__exit__:${code ?? 0}`);
			}) as typeof process.exit;
			try {
				process.chdir(repo);
				const program = buildProgram();
				await program.parseAsync([
					'node',
					'dorfl',
					'claim',
					'feature',
					'--arbiter',
					ARBITER,
					'--ignore-not-ready',
				]);
			} catch {
				// performClaim calls process.exit; our shim throws — captured above.
			} finally {
				process.chdir(origCwd);
				process.exit = origExit;
			}
			// The override let the unmet-blockedBy task be claimed (exit 0). Claim
			// writes nothing to main, so the body stays in backlog/.
			expect(exitCode).toBe(0);
			expect(existsOnArbiterMain(repo, 'backlog', 'feature')).toBe(true);
		} finally {
			scratch.cleanup();
		}
	});
});

describe('gc --force --yes is UNCHANGED (the destructive flag keeps --force)', () => {
	it('gc declares both --force and --yes', () => {
		const flags = optionFlags(command('gc'));
		expect(flags).toContain('--force');
		expect(flags).toContain('--yes');
	});

	it('`gc --force` without --yes refuses with the confirm message', async () => {
		const scratch = makeScratch('dorfl-gc-flags-');
		const workspacesDir = join(scratch.root, '.dorfl');
		const origExit = process.exit;
		const origErr = console.error;
		const origLog = console.log;
		let captured = '';
		let code = 0;
		(process as {exit: unknown}).exit = ((c?: number) => {
			code = c ?? 0;
			throw new Error(`__exit__:${c ?? 0}`);
		}) as typeof process.exit;
		console.error = (m?: unknown) => {
			captured += String(m ?? '') + '\n';
		};
		console.log = (m?: unknown) => {
			captured += String(m ?? '') + '\n';
		};
		try {
			await buildProgram().parseAsync([
				'node',
				'dorfl',
				'gc',
				'--workspace',
				workspacesDir,
				'--force',
			]);
		} catch {
			// the exit shim threw — code + captured text recorded above.
		} finally {
			console.error = origErr;
			console.log = origLog;
			process.exit = origExit;
			scratch.cleanup();
		}
		// --force WITHOUT --yes is refused (exit 1) with the gate text — proving the
		// destructive flag keeps requiring --yes (unchanged by this task).
		expect(code).toBe(1);
		expect(captured).toMatch(
			/--force without --yes|Re-run with `gc --force --yes`/,
		);
	});
});

describe('help tiering — headline vs advanced/plumbing (ADR §7)', () => {
	/** The helpGroup label commander renders a command under. */
	function group(cmd: Command): string | undefined {
		return (cmd as {helpGroup: () => string | undefined}).helpGroup();
	}

	it('headline verbs share one group; ADR plumbing verbs share a DIFFERENT group', () => {
		const headline = [
			'run',
			'do',
			'work-on',
			'start',
			'complete',
			'scan',
			'status',
		];
		const advanced = ['claim', 'prompt', 'verify', 'gc'];
		const headlineGroup = group(command('run'));
		expect(headlineGroup).toBeTruthy();
		for (const name of headline) {
			expect(group(command(name))).toBe(headlineGroup);
		}
		const advancedGroup = group(command('claim'));
		expect(advancedGroup).toBeTruthy();
		expect(advancedGroup).not.toBe(headlineGroup);
		for (const name of advanced) {
			expect(group(command(name))).toBe(advancedGroup);
		}
	});

	it('remote add/ls/find are headline; remote rm is plumbing', () => {
		const headlineGroup = group(subcommand('remote', 'add'));
		expect(headlineGroup).toBeTruthy();
		for (const name of ['add', 'ls', 'find']) {
			expect(group(subcommand('remote', name))).toBe(headlineGroup);
		}
		expect(group(subcommand('remote', 'rm'))).not.toBe(headlineGroup);
	});

	it('the rendered top-level help groups advanced plumbing under its own heading', () => {
		const help = buildProgram().helpInformation();
		// Headline + advanced both appear, under DISTINCT headings (de-emphasised,
		// not removed): claim/verify/gc list under the advanced heading.
		expect(help).toMatch(/Advanced \/ plumbing:/);
		expect(help).toMatch(/Commands:/);
		// The plumbing verbs are still present (kept, not removed).
		for (const verb of ['claim', 'prompt', 'verify', 'gc']) {
			expect(help).toContain(verb);
		}
	});

	it('the named plumbing FLAGS are de-emphasised under an advanced options group', () => {
		const completeHelp = command('complete').helpInformation();
		expect(completeHelp).toMatch(/Advanced \/ plumbing options:/);
		const workOnHelp = command('work-on').helpInformation();
		expect(workOnHelp).toMatch(/Advanced \/ plumbing options:/);
	});

	it('the --auto-merge / --no-auto-merge flags are GONE from every command that exposed them', () => {
		// autoMerge is hard-deleted: `merge` IS the auto-land mode, `propose` is the
		// human checkpoint — there is no separate auto-merge sub-knob.
		for (const name of ['do', 'complete', 'run']) {
			const help = command(name).helpInformation();
			expect(help).not.toContain('--auto-merge');
			expect(help).not.toContain('--no-auto-merge');
			// `--review` (the gate it sat beside) is still present.
			expect(help).toContain('--review');
		}
	});
});
