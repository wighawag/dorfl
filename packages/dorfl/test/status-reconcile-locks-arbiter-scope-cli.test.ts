import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {buildProgram} from '../src/cli.js';
import {acquireItemLock} from '../src/item-lock.js';
import {git, run} from '../src/git.js';
import {
	makeScratch,
	gitEnv,
	type Scratch,
	registerMirrorWithWork,
	mirrorSrc,
} from './helpers/gitRepo.js';

/**
 * CLI-surface behaviour for `status --reconcile-locks`'s ARBITER SCOPE (task
 * `reconcile-locks-stays-within-the-current-arbiter`): like `gc`, the lock
 * drain is arbiter-scoped by DEFAULT (the arbiter resolved from the cwd), with
 * `--all-arbiters` as the explicit global opt-in and a REFUSAL when no arbiter
 * resolves and the flag is absent. The read-only report stays global.
 *
 * House style (see `gc-arbiter-scope-cli.test.ts`): a throwaway workspacesDir
 * (`--workspace`) under a temp scratch and `--config` pointed at a NONEXISTENT
 * path so pure defaults apply (never the developer's real config).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-status-reconcile-scope-cli-');
});
afterEach(() => {
	scratch.cleanup();
});

function ws(): string {
	return join(scratch.root, '.dorfl');
}

function noConfig(): string {
	return join(scratch.root, 'no-such-config.json');
}

/** Acquire a real per-item lock on the source repo behind a registered mirror. */
async function seedMirrorLock(name: string, slug: string): Promise<void> {
	const src = mirrorSrc(ws(), name);
	const clone = join(scratch.root, `seed-${name}-${slug}`);
	run('git', ['clone', '-q', `file://${src}`, clone], scratch.root, {
		env: gitEnv(),
	});
	run('git', ['remote', 'add', 'arbiter', `file://${src}`], clone, {
		env: gitEnv(),
	});
	const acq = await acquireItemLock({
		item: `task:${slug}`,
		action: 'implement',
		cwd: clone,
		arbiter: 'arbiter',
		env: gitEnv(),
	});
	expect(acq.outcome).toBe('acquired');
}

/** Two registered arbiters, each with ONE stale lock (item terminal on main). */
async function seedTwoArbiters(): Promise<{aUrl: string; bUrl: string}> {
	const a = registerMirrorWithWork(ws(), 'repo-a', {done: {'a-done.md': 'x'}});
	const b = registerMirrorWithWork(ws(), 'repo-b', {done: {'b-done.md': 'x'}});
	await seedMirrorLock('repo-a', 'a-done');
	await seedMirrorLock('repo-b', 'b-done');
	return {aUrl: a.originUrl, bUrl: b.originUrl};
}

/** A plain operator checkout whose `origin` IS `url` (NOT a participating repo:
 * no work/ tree, so only the registry path is exercised). */
function operatorRepo(label: string, url: string): string {
	const dir = join(scratch.root, `operator-${label}`);
	git(['init', '-q', '-b', 'main', dir], scratch.root, {env: gitEnv()});
	git(['remote', 'add', 'origin', url], dir, {env: gitEnv()});
	return dir;
}

function lockHeld(url: string, entry: string): boolean {
	const refs = run('git', ['ls-remote', url, 'refs/dorfl/lock/*'], ws(), {
		env: gitEnv(),
	}).stdout;
	return refs.includes(entry);
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
		// the exit shim / commander exitOverride throws: captured above.
	} finally {
		console.error = origErr;
		console.log = origLog;
		process.exit = origExit;
		process.chdir(origCwd);
	}
	return {out, err, code};
}

function statusArgv(extra: string[]): string[] {
	return [
		'status',
		'--config',
		noConfig(),
		'--workspace',
		ws(),
		'--no-arbiter',
		...extra,
	];
}

describe('status CLI grammar: the scope flag is registered', () => {
	it('carries --all-arbiters alongside --reconcile-locks, and the help says the drain is arbiter-scoped', () => {
		const program = buildProgram();
		const statusCmd = program.commands.find((c) => c.name() === 'status');
		expect(statusCmd).toBeDefined();
		const opts = statusCmd!.options;
		const all = opts.find((o) => o.flags.startsWith('--all-arbiters'));
		const reconcile = opts.find((o) => o.flags.startsWith('--reconcile-locks'));
		expect(all).toBeDefined();
		expect(reconcile).toBeDefined();
		expect(reconcile!.description).toMatch(/ARBITER-SCOPED/);
		expect(reconcile!.description).toMatch(/--all-arbiters/);
		expect(all!.description).toMatch(/EVERY registered arbiter/);
	});
});

describe('status --reconcile-locks: DEFAULT scope is the cwd arbiter', () => {
	it('from repo A it releases A’s stale lock and leaves repo B’s untouched', async () => {
		const {aUrl, bUrl} = await seedTwoArbiters();
		const {code, err, out} = await runCli(
			statusArgv(['--reconcile-locks']),
			operatorRepo('a', aUrl),
		);

		expect(code ?? 0).toBe(0);
		expect(lockHeld(aUrl, 'task-a-done')).toBe(false);
		// B is out of the write scope entirely...
		expect(lockHeld(bUrl, 'task-b-done')).toBe(true);
		expect(err).not.toMatch(/b-done/);
		expect(err).not.toMatch(/all-arbiters/i);
		// ...but the read-only report stays global: B's stale lock is still shown.
		expect(out).toMatch(/task-b-done/);
	});

	it('refuses (and releases nothing) when no arbiter resolves from the cwd', async () => {
		const {aUrl, bUrl} = await seedTwoArbiters();
		const {code, err} = await runCli(
			statusArgv(['--reconcile-locks']),
			scratch.root,
		);

		expect(code).toBe(1);
		expect(err).toMatch(/refusing/);
		expect(err).toMatch(/--all-arbiters/);
		expect(lockHeld(aUrl, 'task-a-done')).toBe(true);
		expect(lockHeld(bUrl, 'task-b-done')).toBe(true);
	});
});

describe('status --reconcile-locks --all-arbiters: the explicit global drain', () => {
	it('releases stale locks on EVERY registered arbiter, with a loud banner', async () => {
		const {aUrl, bUrl} = await seedTwoArbiters();
		const {code, err} = await runCli(
			statusArgv(['--reconcile-locks', '--all-arbiters']),
			// From a directory with NO arbiter: the global drain does not need one.
			scratch.root,
		);

		expect(code ?? 0).toBe(0);
		expect(err).toMatch(
			/--all-arbiters: releasing stale per-item locks GLOBALLY/,
		);
		expect(lockHeld(aUrl, 'task-a-done')).toBe(false);
		expect(lockHeld(bUrl, 'task-b-done')).toBe(false);
	});
});
