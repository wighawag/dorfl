import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {buildProgram} from '../src/cli.js';
import {run} from '../src/git.js';
import {
	serialiseLockEntry,
	itemLockRef,
	LOCK_REF_PREFIX,
} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * CLI surface for `release-lock-entry-escape-hatch-and-literal-entry-reporting`:
 *
 *   - the item positional is OPTIONAL and `--entry <literal>` is registered;
 *   - (iv) providing BOTH an item positional AND --entry, or NEITHER, is a clear
 *     usage error (non-zero exit, actionable message);
 *   - `--entry <literal>` deletes the literal ref (exit 0), and an absent literal
 *     is a recoverable no-op (exit 0) whose message names the literal entry.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-release-lock-entry-cli-');
});
afterEach(() => {
	scratch.cleanup();
});

function lockRefOnArbiter(arbiter: string, entry: string): boolean {
	const r = run(
		'git',
		['ls-remote', `file://${arbiter}`, itemLockRef(entry)],
		scratch.root,
		{env: gitEnv()},
	);
	return r.status === 0 && r.stdout.trim() !== '';
}

/** Plant a literal pre-cutover lock ref on the arbiter (no current item-form). */
function plantLiteralLock(repo: string, entry: string): void {
	const env = gitEnv();
	const body = serialiseLockEntry({
		entry,
		action: 'implement',
		state: 'active',
		holder: 'pre-cutover',
		since: '2026-06-19T00:00:00.000Z',
	});
	const blob = run('git', ['hash-object', '-w', '--stdin'], repo, {
		env,
		input: body,
	}).stdout.trim();
	const tree = run('git', ['mktree'], repo, {
		env,
		input: `100644 blob ${blob}\tlock.md\n`,
	}).stdout.trim();
	const commit = run(
		'git',
		['commit-tree', tree, '-m', `lock: ${entry}`],
		repo,
		{env},
	).stdout.trim();
	run('git', ['push', ARBITER, `${commit}:${LOCK_REF_PREFIX}/${entry}`], repo, {
		env,
	});
}

/** Drive argv through the program; capture stdout + stderr + the exit code. */
async function runCli(
	argv: string[],
	cwd: string,
): Promise<{out: string; err: string; code: number | undefined}> {
	const program = buildProgram();
	program.exitOverride();
	let out = '';
	let err = '';
	let code: number | undefined;
	const origErr = console.error;
	const origLog = console.log;
	const origExit = process.exit;
	const origCwd = process.cwd();
	console.error = (msg?: unknown) => {
		err += String(msg ?? '') + '\n';
	};
	console.log = (msg?: unknown) => {
		out += String(msg ?? '') + '\n';
	};
	(process as {exit: unknown}).exit = ((c?: number) => {
		code = c ?? 0;
		throw new Error(`__exit__:${code}`);
	}) as typeof process.exit;
	process.chdir(cwd);
	try {
		await program.parseAsync(['node', 'dorfl', ...argv]);
	} catch {
		// the exit shim / commander exitOverride throws — captured above
	} finally {
		console.error = origErr;
		console.log = origLog;
		process.exit = origExit;
		process.chdir(origCwd);
	}
	return {out, err, code};
}

describe('release-lock CLI — --entry escape hatch registration + argument shape', () => {
	it('registers --entry and makes the item positional OPTIONAL', () => {
		const program = buildProgram();
		const cmd = program.commands.find((c) => c.name() === 'release-lock');
		expect(cmd).toBeDefined();
		expect(cmd!.options.find((o) => o.long === '--entry')).toBeDefined();
		// The positional is `[item]` (optional), not `<item>` (required).
		expect(cmd!.usage()).toMatch(/\[item\]/);
	});

	it('(iv) BOTH an item positional AND --entry is a usage error (exit 1)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['unused']);
		const {err, code} = await runCli(
			[
				'release-lock',
				'task:unused',
				'--entry',
				'slice-foo',
				'--arbiter',
				ARBITER,
			],
			repo,
		);
		expect(code).toBe(1);
		expect(err).toMatch(/not both/);
	});

	it('(iv) NEITHER an item positional NOR --entry is a usage error (exit 1)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['unused']);
		const {err, code} = await runCli(
			['release-lock', '--arbiter', ARBITER],
			repo,
		);
		expect(code).toBe(1);
		expect(err).toMatch(/name the lock to release/);
	});

	it('an invalid --entry value is rejected (exit 1, before any git op)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['unused']);
		const {err, code} = await runCli(
			['release-lock', '--entry', 'slice/escape', '--arbiter', ARBITER],
			repo,
		);
		expect(code).toBe(1);
		expect(err).toMatch(/invalid --entry/);
	});

	it('--entry <literal> deletes the literal ref (exit 0) and names it in the message', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['unused']);
		plantLiteralLock(repo, 'slice-claim-cas-spinner');
		expect(lockRefOnArbiter(arbiter, 'slice-claim-cas-spinner')).toBe(true);
		const {out, code} = await runCli(
			[
				'release-lock',
				'--entry',
				'slice-claim-cas-spinner',
				'--arbiter',
				ARBITER,
			],
			repo,
		);
		expect(code).toBeUndefined(); // clean return, no process.exit
		expect(out).toMatch(/Released lock 'slice-claim-cas-spinner'/);
		expect(out).toMatch(/slice-claim-cas-spinner/);
		expect(lockRefOnArbiter(arbiter, 'slice-claim-cas-spinner')).toBe(false);
	});

	it('--entry on an ABSENT literal is a recoverable no-op (exit 0), message names the literal', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['unused']);
		const {out, code} = await runCli(
			['release-lock', '--entry', 'slice-never-existed', '--arbiter', ARBITER],
			repo,
		);
		expect(code).toBeUndefined();
		expect(out).toMatch(/No lock to release for 'slice-never-existed'/);
		expect(out).toMatch(/all locks released/);
	});
});
