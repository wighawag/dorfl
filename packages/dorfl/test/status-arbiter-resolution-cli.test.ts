import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildProgram} from '../src/cli.js';
import {git} from '../src/git.js';
import {makeScratch, gitEnv, type Scratch} from './helpers/gitRepo.js';

/**
 * Regression (dorfl 0.16.0, rocketh-playground): `dorfl status` printed "no
 * 'arbiter' remote configured in this repo. Run `dorfl arbiter init --remote
 * arbiter`" in a repo whose arbiter is `origin`, while `do`, `advance` and
 * `requeue` all worked against `origin`. Status now resolves the arbiter the
 * way they do: `--arbiter`, else the per-repo/global `defaultArbiter`.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-status-arbiter-');
});
afterEach(() => {
	scratch.cleanup();
});

async function runCli(argv: string[], cwd: string): Promise<string> {
	const program = buildProgram();
	program.exitOverride();
	let out = '';
	const origErr = console.error;
	const origLog = console.log;
	const origExit = process.exit;
	const origCwd = process.cwd();
	console.error = () => {};
	console.log = (msg?: unknown) => {
		out += String(msg ?? '') + '\n';
	};
	(process as {exit: unknown}).exit = ((c?: number) => {
		throw new Error(`__exit__:${c ?? 0}`);
	}) as typeof process.exit;
	process.chdir(cwd);
	try {
		await program.parseAsync(['node', 'dorfl', ...argv]);
	} catch {
		// exit shim
	} finally {
		console.error = origErr;
		console.log = origLog;
		process.exit = origExit;
		process.chdir(origCwd);
	}
	return out;
}

/** A plain checkout (no work/ tree) whose only remote is a hosted `origin`. */
function githubCheckout(): string {
	const dir = join(scratch.root, 'checkout');
	git(['init', '-q', '-b', 'main', dir], scratch.root, {env: gitEnv()});
	git(
		[
			'remote',
			'add',
			'origin',
			'https://github.com/wighawag/rocketh-playground.git',
		],
		dir,
		{env: gitEnv()},
	);
	return dir;
}

function statusArgv(): string[] {
	return [
		'status',
		'--config',
		join(scratch.root, 'no-such-config.json'),
		'--workspace',
		join(scratch.root, '.dorfl'),
	];
}

describe('status resolves the arbiter like do/advance/requeue', () => {
	it('reports origin (the default arbiter) instead of asking for an `arbiter` remote', async () => {
		const out = await runCli(statusArgv(), githubCheckout());
		expect(out).not.toMatch(/no 'arbiter' remote configured/);
		expect(out).not.toMatch(/arbiter init/);
		expect(out).toMatch(/Arbiter remote: origin/);
		expect(out).toMatch(/github\.com\/wighawag\/rocketh-playground/);
		// A hosted arbiter is not inspected locally; it is not called missing.
		expect(out).not.toMatch(/exists: no/);
		expect(out).toMatch(/hosted: yes/);
	});

	it('honours a per-repo defaultArbiter and --arbiter', async () => {
		const dir = githubCheckout();
		git(['remote', 'add', 'upstream', 'https://example.com/up.git'], dir, {
			env: gitEnv(),
		});
		writeFileSync(
			join(dir, 'dorfl.json'),
			JSON.stringify({defaultArbiter: 'upstream'}),
		);
		expect(await runCli(statusArgv(), dir)).toMatch(/Arbiter remote: upstream/);
		expect(await runCli([...statusArgv(), '--arbiter', 'origin'], dir)).toMatch(
			/Arbiter remote: origin/,
		);
	});
});
