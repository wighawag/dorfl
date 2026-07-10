import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {buildProgram} from '../src/cli.js';
import {listPromotable} from '../src/needs-attention.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
	fixtureFolderRel,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * The `promote [item]` CLI verb + the `listPromotable` discovery function (PRD
 * `staging-pool-position-gate-and-trust-model`, tasks
 * `pre-backlog-staging-folder-and-promote-step-a` /
 * `pre-prd-staging-pool-split-and-untrusted-prd-placement`): the runner/human
 * side of the staging gate that admits a STAGED item into its agent-eligible
 * pool. The underlying moves (`promoteFromPreBacklog` / `promoteFromPreSpec`) are
 * tested directly in the two staging test files; THIS file covers the new
 * surface:
 *
 *   - `promote` with NO argument LISTS what is staged (the discovery half), read
 *     from the ARBITER's truth (not the local tree);
 *   - `promote task:<slug>` / `prd:<slug>` / a bare `<slug>` (= task) routes to
 *     the right promotion;
 *   - error cases fail loud (a not-staged slug, an `obs:` prefix).
 *
 * House pattern: a throwaway repo + a `--bare file://` arbiter (remote name
 * `arbiter`).
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('promote-command-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Stage a task file in `work/tasks/backlog/` on the arbiter. */
function stageTask(repo: string, slug: string): void {
	stageStaged(repo, 'pre-backlog', slug);
}

/** Stage a PRD file in `work/specs/proposed/` on the arbiter. */
function stagePrd(repo: string, slug: string): void {
	stageStaged(repo, 'pre-prd', slug);
}

function stageStaged(repo: string, folder: string, slug: string): void {
	const dir = join(repo, 'work', fixtureFolderRel(folder));
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		`---\nslug: ${slug}\n---\n\n## Prompt\n\n> ${slug}\n`,
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `stage ${folder}/${slug}`], repo, {
		env: gitEnv(),
	});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

function onArbiterMain(repo: string, path: string): boolean {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
}

/**
 * Drive the `promote` command through `buildProgram()` from inside `repo`,
 * intercepting `process.exit` (the action exits) + capturing stdout/stderr. The
 * established CLI-test idiom (see do-isolated.test.ts).
 */
async function runPromote(
	repo: string,
	args: string[],
): Promise<{out: string; err: string; code: number | undefined}> {
	const program = buildProgram();
	program.exitOverride();
	let out = '';
	let err = '';
	let code: number | undefined;
	const origLog = console.log;
	const origErr = console.error;
	const origExit = process.exit;
	const origCwd = process.cwd();
	console.log = (msg?: unknown) => {
		out += String(msg ?? '') + '\n';
	};
	console.error = (msg?: unknown) => {
		err += String(msg ?? '') + '\n';
	};
	(process as {exit: unknown}).exit = ((c?: number) => {
		code = c ?? 0;
		throw new Error(`__exit__:${code}`);
	}) as typeof process.exit;
	process.chdir(repo);
	try {
		await program.parseAsync([
			'node',
			'dorfl',
			'promote',
			...args,
			'--arbiter',
			ARBITER,
		]);
	} catch {
		// The exit shim (or commander exitOverride) throws — captured above.
	} finally {
		console.log = origLog;
		console.error = origErr;
		process.exit = origExit;
		process.chdir(origCwd);
	}
	return {out, err, code};
}

describe('listPromotable — reads the arbiter staging folders', () => {
	it('lists tasks in pre-backlog/ then PRDs in pre-prd/, sorted, from the arbiter (not the local tree)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		stageTask(repo, 'beta-task');
		stageTask(repo, 'alpha-task');
		stagePrd(repo, 'some-prd');
		const result = await listPromotable({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.error).toBeUndefined();
		expect(result.items).toEqual([
			{namespace: 'task', slug: 'alpha-task'},
			{namespace: 'task', slug: 'beta-task'},
			{namespace: 'spec', slug: 'some-prd'},
		]);
	});

	it('returns an empty list (no error) when nothing is staged', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await listPromotable({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.error).toBeUndefined();
		expect(result.items).toEqual([]);
	});

	it('reports an error for an unknown arbiter remote (never throws)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await listPromotable({
			cwd: repo,
			arbiter: 'nope',
			env: gitEnv(),
		});
		expect(result.items).toEqual([]);
		expect(result.error).toMatch(/no git remote named 'nope'/);
	});
});

describe('promote [item] — no argument LISTS what is staged', () => {
	it('lists staged tasks + PRDs as `namespace:slug` lines', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		stageTask(repo, 'my-task');
		stagePrd(repo, 'my-prd');
		const {out, code} = await runPromote(repo, []);
		expect(code, out).toBeUndefined(); // a plain return, not process.exit
		expect(out).toMatch(/task:my-task/);
		expect(out).toMatch(/spec:my-prd/);
	});

	it('says nothing is staged when both staging folders are empty', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const {out} = await runPromote(repo, []);
		expect(out).toMatch(/Nothing staged to promote/);
	});
});

describe('promote <item> — admits a staged item into its pool', () => {
	it('promote task:<slug> moves pre-backlog/ -> backlog/ on the arbiter (claimable)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		stageTask(repo, 'feature-x');
		expect(onArbiterMain(repo, 'work/tasks/backlog/feature-x.md')).toBe(true);
		const {out} = await runPromote(repo, ['task:feature-x']);
		expect(out).toMatch(/Promoted task 'feature-x' into the pool/);
		expect(onArbiterMain(repo, 'work/tasks/ready/feature-x.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/backlog/feature-x.md')).toBe(false);
	});

	it('a BARE slug defaults to a task (mirrors requeue)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		stageTask(repo, 'bare-one');
		const {out} = await runPromote(repo, ['bare-one']);
		expect(out).toMatch(/Promoted task 'bare-one' into the pool/);
		expect(onArbiterMain(repo, 'work/tasks/ready/bare-one.md')).toBe(true);
	});

	it('promote prd:<slug> (legacy input alias) moves proposed/ -> ready/ on the arbiter (auto-sliceable)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		stagePrd(repo, 'vision');
		expect(onArbiterMain(repo, 'work/specs/proposed/vision.md')).toBe(true);
		// `prd:` INPUT is still accepted (contract task removes it); the produced
		// namespace VALUE + message speak `spec`.
		const {out} = await runPromote(repo, ['prd:vision']);
		expect(out).toMatch(/Promoted spec 'vision' into the pool/);
		expect(onArbiterMain(repo, 'work/specs/ready/vision.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/specs/proposed/vision.md')).toBe(false);
	});
});

describe('promote <item> — error cases fail loud', () => {
	it('a not-staged slug exits non-zero with an honest reason', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const {err, code} = await runPromote(repo, ['task:ghost']);
		expect(code).toBe(1);
		expect(err).toMatch(/not staged in work\/pre-backlog\//);
	});

	it('an observation prefix is rejected (observations have no pool)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const {err, code} = await runPromote(repo, ['obs:something']);
		expect(code).toBe(1);
		expect(err).toMatch(/not an observation|no agent pool/i);
	});
});
