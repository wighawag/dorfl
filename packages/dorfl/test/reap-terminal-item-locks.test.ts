import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {buildProgram} from '../src/cli.js';
import {sweepTerminalItemLocks} from '../src/reap-branches.js';
import {acquireItemLock, itemLockRef} from '../src/item-lock.js';
import {refWrite} from '../src/ref-write.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	fixtureFolderRel,
	rmrf,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Task `ci-releases-locks-of-terminal-items`: the no-agent `reap-merged-branches`
 * CI job runs `dorfl gc --remote-branches`, and that SAME invocation now also
 * releases every per-item lock whose item is TERMINAL on the arbiter's `main`
 * (the `status --reconcile-locks` predicate), leased on the sha it read. Tested
 * against a local `--bare` arbiter, the substrate the CI job reaches.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-reap-terminal-locks-');
});
afterEach(() => {
	vi.restoreAllMocks();
	scratch.cleanup();
});

async function lock(repo: string, slug: string): Promise<void> {
	const acq = await acquireItemLock({
		item: `task:${slug}`,
		action: 'implement',
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(acq.outcome).toBe('acquired');
}

/** The event dorfl cannot observe: the propose PR is merged, so the item's body
 * comes to rest in `work/tasks/done/` on the arbiter's `main`. */
function landDone(arbiter: string, slug: string): void {
	const dest = join(scratch.root, `merge-${slug}`);
	const env = gitEnv();
	run('git', ['clone', '-q', `file://${arbiter}`, dest], scratch.root, {env});
	const from = join('work', fixtureFolderRel('backlog'), `${slug}.md`);
	const to = join('work', fixtureFolderRel('done'), `${slug}.md`);
	mkdirSync(join(dest, 'work', fixtureFolderRel('done')), {recursive: true});
	expect(run('git', ['mv', from, to], dest, {env}).status).toBe(0);
	run('git', ['commit', '-q', '-m', `merge: ${slug} -> done`], dest, {env});
	expect(
		run('git', ['push', '-q', 'origin', 'HEAD:main'], dest, {env}).status,
	).toBe(0);
	rmrf(dest);
}

function lockOnArbiter(arbiter: string, entry: string): string | undefined {
	const r = run(
		'git',
		['ls-remote', `file://${arbiter}`, itemLockRef(entry)],
		scratch.root,
		{
			env: gitEnv(),
		},
	);
	const sha = r.stdout.trim().split(/\s+/)[0];
	return r.status === 0 && sha ? sha : undefined;
}

async function seedMixed() {
	const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [
		'finished',
		'live',
	]);
	await lock(repo, 'finished');
	await lock(repo, 'live');
	landDone(arbiter, 'finished');
	return {repo, arbiter};
}

describe('gc --remote-branches releases the locks of items terminal on main', () => {
	it('releases a terminal item’s lock and leaves a non-terminal item’s lock untouched', async () => {
		const {repo, arbiter} = await seedMixed();
		const liveBefore = lockOnArbiter(arbiter, 'task-live');
		expect(lockOnArbiter(arbiter, 'task-finished')).toBeDefined();

		const res = await sweepTerminalItemLocks({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(res.released).toEqual(['task-finished']);
		expect(res.kept).toEqual(['task-live']);
		expect(res.errors).toEqual([]);
		expect(lockOnArbiter(arbiter, 'task-finished')).toBeUndefined();
		// Untouched: same ref, same sha.
		expect(lockOnArbiter(arbiter, 'task-live')).toBe(liveBefore);
	});

	it('--dry-run only reports what WOULD be released', async () => {
		const {repo, arbiter} = await seedMixed();

		const res = await sweepTerminalItemLocks({
			cwd: repo,
			arbiter: ARBITER,
			dryRun: true,
			env: gitEnv(),
		});

		expect(res.wouldRelease).toEqual(['task-finished']);
		expect(res.released).toEqual([]);
		expect(lockOnArbiter(arbiter, 'task-finished')).toBeDefined();
	});

	it('does NOT release a lock that moved between the read and the delete (lease)', async () => {
		const {repo, arbiter} = await seedMixed();
		const env = gitEnv();
		// A concurrent writer re-points the lock ref on the arbiter right after the
		// sweep read it, i.e. just before the leased delete is sent.
		const realDelete = refWrite.deleteLockRef;
		let moved = '';
		vi.spyOn(refWrite, 'deleteLockRef').mockImplementation(async (input) => {
			const other = run(
				'git',
				['commit-tree', '-m', 'racer', `${input.expectedSha}^{tree}`],
				repo,
				{
					env,
				},
			).stdout.trim();
			expect(other).toMatch(/^[0-9a-f]{40}$/);
			const push = run(
				'git',
				['push', '-q', '--force', ARBITER, `${other}:${input.ref}`],
				repo,
				{env},
			);
			expect(push.status).toBe(0);
			moved = other;
			return realDelete(input);
		});

		const res = await sweepTerminalItemLocks({
			cwd: repo,
			arbiter: ARBITER,
			env,
		});

		expect(res.released).toEqual([]);
		expect(res.errors.map((e) => e.entry)).toEqual(['task-finished']);
		// Still held, at the racer's sha: never forced away.
		expect(lockOnArbiter(arbiter, 'task-finished')).toBe(moved);
	});

	it('the CLI `gc --remote-branches` invocation (the CI job’s command) releases it and reports it', async () => {
		const {repo, arbiter} = await seedMixed();
		const out: string[] = [];
		vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
			out.push(a.join(' '));
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await buildProgram().parseAsync([
			'node',
			'dorfl',
			'gc',
			'--remote-branches',
			'--arbiter',
			ARBITER,
			'--cwd',
			repo,
			'--config',
			join(scratch.root, 'no-such-config.json'),
			'--workspace',
			join(scratch.root, '.dorfl'),
		]);

		expect(lockOnArbiter(arbiter, 'task-finished')).toBeUndefined();
		expect(lockOnArbiter(arbiter, 'task-live')).toBeDefined();
		const text = out.join('\n');
		expect(text).toMatch(/\[released\] lock task-finished/);
		expect(text).not.toMatch(/task-live/);
		expect(text).toMatch(/1 terminal-item lock\(s\) released/);
	});
});
