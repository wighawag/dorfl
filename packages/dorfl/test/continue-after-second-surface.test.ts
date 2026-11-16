import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
import {returnToBacklog} from '../src/needs-attention.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	isolatePiAgentDir,
	sidecarSurfacedOnArbiterMain,
	pathOnArbiterMain,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * Bug (dorfl 0.15.1, wherever task `assistant-folder-opt-in-and-lock`):
 * continuing a kept branch after a SECOND failure dead-ended on a conflict in
 * the item's question sidecar.
 *
 *   1. The gate fails: the surface writes `work/questions/task-<slug>.md` on
 *      `main`.
 *   2. requeue --reconcile + continue: the land clears the stale question state,
 *      which DELETES the sidecar in the branch's completion commit. The gate
 *      fails again and the surface REWRITES the sidecar on `main`.
 *   3. The next continue rebase is a modify/delete conflict on the sidecar,
 *      which was aborted and handed to the human (`requeue --reconcile` hit the
 *      same wall; only `--reset` was offered).
 *
 * The sidecar is runner-owned protocol state, so the continue rebase resolves
 * that conflict mechanically: the branch's deletion wins (its done-move makes
 * the question moot) unless `main`'s version carries a human answer.
 */

const ARBITER = 'arbiter';
const PASS = 'exit 0';
// Two DIFFERENT red gates, so the second surface rewrites the sidecar with a
// different reason (the live case: a different failure the second time).
const FAIL_FIRST = 'exit 1';
const FAIL_SECOND = 'exit 2';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-second-surface-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

function sidecarOnMain(repo: string, slug: string): string | undefined {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	const res = run(
		'git',
		['show', `${ARBITER}/main:work/questions/task-${slug}.md`],
		repo,
		{env: gitEnv()},
	);
	return res.status === 0 ? res.stdout : undefined;
}

/** A build that fails its gate on the autonomous path (surface + push). */
async function completeWith(
	repo: string,
	slug: string,
	verify: string,
): Promise<string> {
	const result = await performComplete({
		cwd: repo,
		slug,
		arbiter: ARBITER,
		integration: 'merge',
		verify,
		freshWorktreeGate: true,
		surfaceArbiter: ARBITER,
		env: gitEnv(),
	});
	return result.outcome;
}

/** requeue --reconcile, then continue from the kept branch in a fresh clone. */
async function reconcileAndContinue(
	seeded: SeededRepo,
	slug: string,
	name: string,
): Promise<string> {
	const requeued = await returnToBacklog({
		cwd: seeded.repo,
		slug,
		arbiter: ARBITER,
		reconcile: true,
		message: `try again (${name})`,
		env: gitEnv(),
	});
	expect(requeued.reasonNotMoved).toBeUndefined();
	expect(requeued.moved).toBe(true);

	const clone = seeded.clone(name);
	const started = await performStart({
		slug,
		cwd: clone,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(started.reason).toBeUndefined();
	expect(started.outcome).toBe('started');
	return clone;
}

describe('continue after a second surface (sidecar modify/delete)', () => {
	it('surface -> continue (branch deletes sidecar) -> surface again (main rewrites it) -> continue lands', async () => {
		const slug = 'alpha';
		const seeded = seedRepoWithArbiter(scratch.root, [slug]);
		const repo = seeded.repo;

		// 1. First attempt: build, gate red => surfaced (sidecar on main).
		const claimed = await performClaim({
			slug,
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claimed.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'first.txt'), 'first attempt\n');
		expect(await completeWith(repo, slug, FAIL_FIRST)).toBe('gate-failed');
		const firstSidecar = sidecarOnMain(repo, slug);
		expect(firstSidecar).toBeDefined();

		// 2. Continue: the land deletes the sidecar on the branch; gate red again,
		//    so the surface rewrites the sidecar on main.
		const second = await reconcileAndContinue(seeded, slug, 'second');
		writeFileSync(join(second, 'second.txt'), 'second attempt\n');
		expect(await completeWith(second, slug, FAIL_SECOND)).toBe('gate-failed');
		const branchRef = `${ARBITER}/work/task-${slug}`;
		gitIn(['fetch', '-q', ARBITER], second);
		expect(
			run(
				'git',
				['cat-file', '-e', `${branchRef}:work/questions/task-${slug}.md`],
				second,
				{env: gitEnv()},
			).status,
		).not.toBe(0); // the branch deleted it
		const secondSidecar = sidecarOnMain(second, slug);
		expect(secondSidecar).toBeDefined();
		expect(secondSidecar).not.toBe(firstSidecar); // main rewrote it

		// 3. Continue again: this is where 0.15.1 dead-ended on the sidecar.
		const third = await reconcileAndContinue(seeded, slug, 'third');
		writeFileSync(join(third, 'third.txt'), 'third attempt\n');
		expect(await completeWith(third, slug, PASS)).toBe('completed');

		// Landed with ALL three attempts' work and no stale question state.
		for (const f of ['first.txt', 'second.txt', 'third.txt']) {
			expect(pathOnArbiterMain(third, f)).toBe(true);
		}
		expect(sidecarSurfacedOnArbiterMain(third, slug)).toBe(false);
		const record = run(
			'git',
			['show', `${ARBITER}/main:work/tasks/done/${slug}.md`],
			third,
			{env: gitEnv()},
		);
		expect(record.status).toBe(0);
		expect(parseFrontmatter(record.stdout).needsAnswers).not.toBe(true);
	});
});
