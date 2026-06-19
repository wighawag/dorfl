import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {buildProgram} from '../src/cli.js';
import {createJob, jobWorktreePath} from '../src/workspace.js';
import {performClaim} from '../src/claim-cas.js';
import {recoverIsolatedOneLiner} from '../src/do.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * CLI-surface tests for the `finish-already-committed-branch` operator surface:
 * `complete --isolated <slug>` (finish a stranded retained worktree) and
 * `resume --isolated <slug>` (re-engage it, print its path), plus the `do`
 * integration-failure recovery one-liner.
 *
 * House style (mirrors do-isolated.test.ts): a throwaway project + a local
 * `--bare` arbiter, a TEMP `workspacesDir` passed via `--workspace`, real shared
 * dirs untouched. We materialise a REAL retained job worktree and STRAND it, then
 * drive the surface through argv.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-complete-isolated-cli-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

function workspacesDir(): string {
	return join(scratch.root, 'agents-area');
}

/** Materialise + STRAND a retained job worktree (committed done-move, not pushed). */
async function seedStrandedWorktree(
	seeded: SeededRepo,
	slug: string,
): Promise<{worktreeDir: string}> {
	const ws = workspacesDir();
	const arbiterUrl = `file://${seeded.arbiter}`;
	const claim = await performClaim({
		slug,
		cwd: seeded.repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	const job = createJob({
		url: arbiterUrl,
		slug,
		workspacesDir: ws,
		env: gitEnv(),
	});
	const dir = job.dir;
	writeFileSync(join(dir, 'feature.txt'), 'the work\n');
	mkdirSync(join(dir, 'work', 'tasks', 'done'), {recursive: true});
	gitIn(
		['mv', `work/tasks/todo/${slug}.md`, `work/tasks/done/${slug}.md`],
		dir,
	);
	gitIn(['add', '-A'], dir);
	gitIn(['commit', '-q', '-m', `feat(${slug}): build the thing; done`], dir);
	expect(dir).toBe(jobWorktreePath(ws, arbiterUrl, slug));
	return {worktreeDir: dir};
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
	const origExit = process.exit;
	const origCwd = process.cwd();
	const origWrite = process.stdout.write.bind(process.stdout);
	console.error = (msg?: unknown) => {
		err += String(msg ?? '') + '\n';
	};
	(process.stdout as {write: unknown}).write = ((chunk: unknown) => {
		out += String(chunk ?? '');
		return true;
	}) as typeof process.stdout.write;
	(process as {exit: unknown}).exit = ((c?: number) => {
		code = c ?? 0;
		throw new Error(`__exit__:${code}`);
	}) as typeof process.exit;
	process.chdir(cwd);
	try {
		await program.parseAsync(['node', 'agent-runner', ...argv]);
	} catch {
		// the exit shim / commander exitOverride throws — captured above
	} finally {
		console.error = origErr;
		process.exit = origExit;
		process.stdout.write = origWrite;
		process.chdir(origCwd);
	}
	return {out, err, code};
}

describe('complete --isolated — CLI surface registration', () => {
	it('registers --isolated + --workspace on the complete command', () => {
		const program = buildProgram();
		const complete = program.commands.find((c) => c.name() === 'complete');
		expect(complete).toBeDefined();
		const opts = complete!.options;
		expect(opts.find((o) => o.long === '--isolated')).toBeDefined();
		expect(opts.find((o) => o.long === '--workspace')).toBeDefined();
	});

	it('registers --isolated on the resume command', () => {
		const program = buildProgram();
		const resume = program.commands.find((c) => c.name() === 'resume');
		expect(resume).toBeDefined();
		expect(resume!.options.find((o) => o.long === '--isolated')).toBeDefined();
	});
});

describe('complete --isolated <slug> — finishes a stranded worktree end-to-end', () => {
	it('integrates the kept commit (merge) from the operator checkout', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const {worktreeDir} = await seedStrandedWorktree(seeded, 'alpha');

		const {code} = await runCli(
			[
				'complete',
				'--isolated',
				'alpha',
				'--arbiter',
				ARBITER,
				'--workspace',
				workspacesDir(),
				'--merge',
			],
			seeded.repo,
		);
		expect(code).toBe(0);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'in-progress', 'alpha')).toBe(
			false,
		);
		// The redundant worktree was reaped.
		expect(existsSync(worktreeDir)).toBe(false);
	});

	it('with nothing retained → a clear nothing-to-recover message, exit 0, no fresh worktree', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const {code, err} = await runCli(
			[
				'complete',
				'--isolated',
				'beta',
				'--arbiter',
				ARBITER,
				'--workspace',
				workspacesDir(),
			],
			seeded.repo,
		);
		expect(code).toBe(0);
		expect(err).toMatch(/nothing to recover/i);
		expect(
			existsSync(
				jobWorktreePath(workspacesDir(), `file://${seeded.arbiter}`, 'beta'),
			),
		).toBe(false);
	});

	it('requires a slug', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['gamma']);
		const {code, err} = await runCli(
			['complete', '--isolated', '--workspace', workspacesDir()],
			seeded.repo,
		);
		expect(code).toBe(1);
		expect(err).toMatch(/requires <slug>/i);
	});
});

describe('resume --isolated <slug> — re-engages the retained worktree (prints its path)', () => {
	it('prints the located worktree path to stdout without claiming', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['delta']);
		const {worktreeDir} = await seedStrandedWorktree(seeded, 'delta');

		const {code, out} = await runCli(
			[
				'resume',
				'--isolated',
				'delta',
				'--arbiter',
				ARBITER,
				'--workspace',
				workspacesDir(),
			],
			seeded.repo,
		);
		expect(code).toBe(0);
		expect(out.trim()).toBe(worktreeDir);
		// It did NOT integrate (resume only re-engages): the worktree is still there.
		expect(existsSync(worktreeDir)).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'delta')).toBe(false);
	});

	it('nothing retained → a clear message on stderr, exit 0, nothing on stdout', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['epsilon']);
		const {code, out, err} = await runCli(
			[
				'resume',
				'--isolated',
				'epsilon',
				'--arbiter',
				ARBITER,
				'--workspace',
				workspacesDir(),
			],
			seeded.repo,
		);
		expect(code).toBe(0);
		expect(out.trim()).toBe('');
		expect(err).toMatch(/nothing to resume/i);
	});
});

describe('do integration-failure recovery one-liner', () => {
	it('names the exact complete --isolated recovery command for the slug', () => {
		const line = recoverIsolatedOneLiner('my-slice');
		expect(line).toMatch(/agent-runner complete --isolated my-slice/);
	});

	it('ALSO names the cross-machine finish (plain complete) so a CI-stranded slice finished from another checkout is not told to use the no-op --isolated', () => {
		const line = recoverIsolatedOneLiner('my-slice');
		// Same-machine shortcut still present...
		expect(line).toMatch(/complete --isolated my-slice/);
		// ...and the portable, any-checkout finish: plain `complete <slug>`.
		expect(line).toMatch(/agent-runner complete my-slice/);
		// Flags WHY --isolated is machine-local (so the reader is not misled).
		expect(line).toMatch(/SAME MACHINE/);
	});
});
