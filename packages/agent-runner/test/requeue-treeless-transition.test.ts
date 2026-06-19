import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {returnToBacklog} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-requeue-treeless-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Drive a slice to needs-attention with its prior attempt's branch pushed to the
 * arbiter and the item surfaced in needs-attention/ on `<arbiter>/main` — WITHOUT
 * landing that needs-attention state in the cwd working tree. The cwd is left on
 * the original seed `main` (it never checks out the surfaced state), so a test can
 * prove a `requeue` does its move WITHOUT reading or writing that tree.
 */
async function stuckOnArbiterOnly(
	slug: string,
): Promise<{seeded: SeededRepo; repo: string}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	gitIn(['push', '-q', ARBITER, `work/task-${slug}:work/task-${slug}`], repo);
	await ledgerWrite.applyNeedsAttentionTransition({
		cwd: repo,
		slug,
		reason: 'gate red',
		arbiter: ARBITER,
		env: gitEnv(),
	});
	// Deliberately do NOT bring the surfaced needs-attention state into the cwd
	// tree: leave the working tree on the original seed `main` (which does NOT have
	// work/needs-attention/<slug>.md), so the requeue must read the arbiter, not cwd.
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-f', 'main'], repo);
	return {seeded, repo};
}

/** The commit shas reachable from `<arbiter>/main` (newest first). */
function arbiterMainLog(repo: string): string[] {
	gitIn(['fetch', '-q', ARBITER], repo);
	return gitIn(['log', '--format=%H', `${ARBITER}/main`], repo)
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s !== '');
}

describe('requeue — tree-less CAS transition (does not write the cwd tree)', () => {
	it('moves needs-attention/ → backlog/ on the arbiter WITHOUT a cwd checkout of the item', async () => {
		const {repo} = await stuckOnArbiterOnly('alpha');
		// Precondition: the item is NOT in the cwd working tree (it lives only on
		// the arbiter's main), proving the move cannot have come from the cwd tree.
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			false,
		);

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The move landed on the arbiter's main: needs-attention/ → backlog/.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
	});

	it('THE 8c92f63 REGRESSION: a pre-existing untracked cwd file is neither staged nor committed', async () => {
		const {repo} = await stuckOnArbiterOnly('beta');

		// Seed an UNTRACKED file in the shared checkout — the assistant's WIP that
		// commit 8c92f63 swallowed into the requeue chore commit.
		mkdirSync(join(repo, 'work', 'notes', 'ideas'), {recursive: true});
		const strayRel = 'work/notes/ideas/assistant-wip.md';
		writeFileSync(
			join(repo, strayRel),
			'# an idea the assistant was writing\n',
		);

		const beforeArbiter = arbiterMainLog(repo);
		const beforeHead = gitIn(['rev-parse', 'HEAD'], repo).trim();

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'beta',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// 1. The stray file is STILL UNTRACKED in the cwd (status shows it as `??`).
		const status = gitIn(['status', '--porcelain', strayRel], repo);
		expect(status.trim()).toBe(`?? ${strayRel}`);
		expect(readFileSync(join(repo, strayRel), 'utf8')).toBe(
			'# an idea the assistant was writing\n',
		);

		// 2. The cwd HEAD did not move — requeue made NO commit in the cwd tree.
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).toBe(beforeHead);

		// 3. The stray file is absent from any commit requeue added to the arbiter (a
		//    default requeue releases the lock and writes NO main commit, so the set is
		//    typically empty — the point is the stray is never swept in).
		const afterArbiter = arbiterMainLog(repo);
		const newCommits = afterArbiter.filter((c) => !beforeArbiter.includes(c));
		for (const commit of newCommits) {
			const files = gitIn(['show', '--name-only', '--format=', commit], repo);
			expect(files).not.toMatch(/assistant-wip\.md/);
		}

		// 4. And the requeue itself DID land: the lock is released, the body rests in
		//    backlog/ (claimable again).
		expect(stuckLockOnArbiter(repo, 'beta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
	});

	it('-m appends a dated handoff note (read+rewritten via the arbiter, not the cwd tree)', async () => {
		const {repo, seeded} = await stuckOnArbiterOnly('gamma');
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'gamma',
			arbiter: ARBITER,
			message: 'watch the flaky integration test',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// Read the moved file from a FRESH clone of the arbiter (the durable home).
		const fresh = seeded.clone('reader');
		const body = readFileSync(
			join(fresh, 'work', 'tasks', 'todo', 'gamma.md'),
			'utf8',
		);
		expect(body).toMatch(/## Requeue \d{4}-\d{2}-\d{2}/);
		expect(body).toMatch(/watch the flaky integration test/);
	});

	it('refuses (no move) when no arbiter is given — tree-less CAS needs a ref to push to', async () => {
		const {repo} = await stuckOnArbiterOnly('delta');
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'delta',
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/arbiter/i);
	});
});
