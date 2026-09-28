import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildProgram} from '../src/cli.js';
import {DEFAULT_ARBITER_REMOTE} from '../src/arbiter.js';
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
 * CLI-surface behaviour for task `status-no-arbiter-is-honoured`:
 *
 * 1. `status --no-arbiter` really skips the arbiter section. Commander treats
 *    `--no-arbiter` as the NEGATION of `--arbiter <remote>` (one `arbiter` key,
 *    set to `false`), so the old `flags.noArbiter` check never fired.
 * 2. `scan --reconcile-locks` is ARBITER-SCOPED like `status --reconcile-locks`:
 *    only the cwd arbiter by default, `--all-arbiters` for the global drain, and
 *    a refusal when no arbiter resolves.
 *
 * House style (see `status-reconcile-locks-arbiter-scope-cli.test.ts`): a
 * throwaway workspacesDir under a temp scratch; `status` gets `--workspace` and
 * a NONEXISTENT `--config`, `scan` (no `--workspace`) gets a scratch config file
 * naming the scratch workspacesDir. Never the developer's real home state.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-status-no-arbiter-cli-');
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

/** A scratch config file pointing `scan` at the scratch workspacesDir. */
function scanConfig(): string {
	const path = join(scratch.root, 'scan-config.json');
	writeFileSync(path, JSON.stringify({workspacesDir: ws()}) + '\n');
	return path;
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

/** A plain operator checkout with the given remotes (NOT a participating repo:
 * no work/ tree, so only the registry path is exercised). */
function operatorRepo(label: string, remotes: Record<string, string>): string {
	const dir = join(scratch.root, `operator-${label}`);
	git(['init', '-q', '-b', 'main', dir], scratch.root, {env: gitEnv()});
	for (const [name, url] of Object.entries(remotes)) {
		git(['remote', 'add', name, url], dir, {env: gitEnv()});
	}
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
	return ['status', '--config', noConfig(), '--workspace', ws(), ...extra];
}

function scanArgv(extra: string[]): string[] {
	return ['scan', '--config', scanConfig(), ...extra];
}

describe('status --no-arbiter / --arbiter <remote>', () => {
	it('--no-arbiter skips the arbiter section', async () => {
		const cwd = operatorRepo('plain', {origin: 'file:///nowhere/a.git'});
		const {code, out} = await runCli(
			statusArgv(['--no-arbiter', '--json']),
			cwd,
		);
		expect(code ?? 0).toBe(0);
		expect(JSON.parse(out).arbiter).toBeUndefined();
	});

	it('with neither flag the arbiter section is shown (default unchanged)', async () => {
		const cwd = operatorRepo('plain', {origin: 'file:///nowhere/a.git'});
		const {code, out} = await runCli(statusArgv(['--json']), cwd);
		expect(code ?? 0).toBe(0);
		const report = JSON.parse(out);
		expect(report.arbiter).toBeDefined();
		expect(report.arbiter.remote).toBe(DEFAULT_ARBITER_REMOTE);
	});

	it('--arbiter <remote> keeps the arbiter section and is used as the remote', async () => {
		const {aUrl, bUrl} = await seedTwoArbiters();
		// origin is B, but the COORDINATION arbiter named on the CLI is A.
		const cwd = operatorRepo('two', {origin: bUrl, upstream: aUrl});
		const {code, out} = await runCli(
			statusArgv(['--arbiter', 'upstream', '--reconcile-locks', '--json']),
			cwd,
		);
		expect(code ?? 0).toBe(0);
		expect(JSON.parse(out).arbiter).toBeDefined();
		expect(lockHeld(aUrl, 'task-a-done')).toBe(false);
		expect(lockHeld(bUrl, 'task-b-done')).toBe(true);
	});

	it('--no-arbiter with --reconcile-locks falls back to the default arbiter, never `false`', async () => {
		const {aUrl, bUrl} = await seedTwoArbiters();
		const cwd = operatorRepo('a', {origin: aUrl});
		const {code} = await runCli(
			statusArgv(['--no-arbiter', '--reconcile-locks']),
			cwd,
		);
		expect(code ?? 0).toBe(0);
		expect(lockHeld(aUrl, 'task-a-done')).toBe(false);
		expect(lockHeld(bUrl, 'task-b-done')).toBe(true);
	});
});

describe('no other command pairs a valued --x <v> with --no-x', () => {
	it('every --no-x option negates a BOOLEAN --x (or has no positive form)', () => {
		const program = buildProgram();
		const offenders: string[] = [];
		const visit = (cmd: typeof program): void => {
			for (const opt of cmd.options) {
				if (!opt.negate) {
					continue;
				}
				const positive = cmd.options.find(
					(o) => !o.negate && o.attributeName() === opt.attributeName(),
				);
				if (
					positive !== undefined &&
					(positive.required || positive.optional)
				) {
					offenders.push(`${cmd.name()} ${positive.long}/${opt.long}`);
				}
			}
			for (const sub of cmd.commands) {
				visit(sub);
			}
		};
		visit(program);
		// `status --arbiter <remote>` / `--no-arbiter` is the one known pair, and
		// its action now reads the commander negation (`arbiter: false`).
		expect(offenders).toEqual(['status --arbiter/--no-arbiter']);
	});
});

describe('scan --reconcile-locks: arbiter-scoped like status', () => {
	it('carries --all-arbiters, and the help says the drain is arbiter-scoped', () => {
		const program = buildProgram();
		const scanCmd = program.commands.find((c) => c.name() === 'scan');
		const opts = scanCmd!.options;
		const all = opts.find((o) => o.flags.startsWith('--all-arbiters'));
		const reconcile = opts.find((o) => o.flags.startsWith('--reconcile-locks'));
		expect(all).toBeDefined();
		expect(reconcile!.description).toMatch(/ARBITER-SCOPED/);
		expect(reconcile!.description).toMatch(/--all-arbiters/);
		expect(all!.description).toMatch(/EVERY registered arbiter/);
	});

	it('by default releases ONLY the cwd arbiter’s stale lock', async () => {
		const {aUrl, bUrl} = await seedTwoArbiters();
		const {code, err} = await runCli(
			scanArgv(['--reconcile-locks']),
			operatorRepo('a', {origin: aUrl}),
		);
		expect(code ?? 0).toBe(0);
		expect(lockHeld(aUrl, 'task-a-done')).toBe(false);
		expect(lockHeld(bUrl, 'task-b-done')).toBe(true);
		expect(err).not.toMatch(/b-done/);
	});

	it('refuses (and releases nothing) when no arbiter resolves from the cwd', async () => {
		const {aUrl, bUrl} = await seedTwoArbiters();
		const {code, err} = await runCli(
			scanArgv(['--reconcile-locks']),
			scratch.root,
		);
		expect(code).toBe(1);
		expect(err).toMatch(/refusing: `scan --reconcile-locks`/);
		expect(err).toMatch(/--all-arbiters/);
		expect(lockHeld(aUrl, 'task-a-done')).toBe(true);
		expect(lockHeld(bUrl, 'task-b-done')).toBe(true);
	});

	it('--all-arbiters releases on EVERY registered arbiter, with a loud banner', async () => {
		const {aUrl, bUrl} = await seedTwoArbiters();
		const {code, err} = await runCli(
			scanArgv(['--reconcile-locks', '--all-arbiters']),
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
