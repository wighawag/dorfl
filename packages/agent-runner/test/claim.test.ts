import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {claimItem, claimItemAsync} from '../src/claim.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	CLAIM_SCRIPT,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-claim-');
});
afterEach(() => {
	scratch.cleanup();
});

describe('claimItem', () => {
	it('claims a backlog item (exit 0) and moves it to in-progress on the arbiter', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = claimItem({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('claimed');
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(false);
	});

	it('returns "lost" (not claimed) when the item is not in backlog (exit 2)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = claimItem({
			slug: 'does-not-exist',
			cwd: repo,
			arbiter: 'arbiter',
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('lost');
	});

	it('exposes the raw exit code for diagnostics', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ok = claimItem({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
		});
		expect(ok.exitCode).toBe(0);
	});
});

describe('claim race (mirrors claim.sh verification)', () => {
	it('a simultaneous two-runner race over the same item yields exactly one winner', async () => {
		// One backlog item, two independent clones of the same arbiter racing it.
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		const a = seeded.clone('a');
		const b = seeded.clone('b');

		// Genuinely concurrent: both claim.sh processes run at the same time, so the
		// arbiter's ref-CAS (not test ordering) is what picks the single winner.
		const [ra, rb] = await Promise.all([
			claimItemAsync({
				slug: 'solo',
				cwd: a,
				arbiter: 'arbiter',
				claimScript: CLAIM_SCRIPT,
				env: gitEnv(),
			}),
			claimItemAsync({
				slug: 'solo',
				cwd: b,
				arbiter: 'arbiter',
				claimScript: CLAIM_SCRIPT,
				env: gitEnv(),
			}),
		]);

		const claimed = [ra, rb].filter((r) => r.outcome === 'claimed');
		const lost = [ra, rb].filter((r) => r.outcome === 'lost');
		expect(claimed).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// The arbiter ref agrees: the item is in-progress exactly once.
		expect(existsOnArbiterMain(a, 'in-progress', 'solo')).toBe(true);
		expect(existsOnArbiterMain(a, 'backlog', 'solo')).toBe(false);
	});
});
