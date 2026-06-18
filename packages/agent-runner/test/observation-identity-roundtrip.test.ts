import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	existsSync,
	mkdirSync,
	writeFileSync,
	readdirSync,
	rmSync,
	readFileSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {performAdvance} from '../src/advance.js';
import {gatherLifecycleInPlace} from '../src/lifecycle-gather.js';
import {ledgerRead} from '../src/ledger-read.js';
import type {ReviewGate, ReviewVerdict} from '../src/review-gate.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * Slice `observation-identity-is-its-filename-not-a-foreign-slug` — the
 * enumerate→resolve ROUND-TRIP for observations. An observation's identity is its
 * FILENAME (never a foreign frontmatter `slug:`), so the lifecycle pool's
 * `obs:<slug>` slug ALWAYS resolves back to its own file via the same advance
 * path that runs in the CI lifecycle propose matrix. A leg whose file VANISHED
 * between enumerate and run is a BENIGN SKIP (the `vanished` outcome, exit 0) —
 * not the previous exit-1 "a human must reconcile" wall under matrix scale.
 *
 * House style: throwaway working-tree + a local `--bare` arbiter,
 * `isolatePiAgentDir` keeps the developer's `~/.pi/agent/sessions/` untouched.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-obs-identity-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';

const ACQUIRED: AcquireAdvancingLockResult = {
	exitCode: 0,
	outcome: 'acquired',
	message: 'locked',
};
const RELEASED: ReleaseAdvancingLockResult = {
	exitCode: 0,
	outcome: 'released',
	message: 'released',
};

function stubGate(verdict: ReviewVerdict): ReviewGate {
	return async () => verdict;
}

const APPROVE_WITH_NITS: ReviewVerdict = {
	verdict: 'approve',
	findings: [
		{severity: 'non-blocking', question: 'rename this helper for clarity'},
	],
};

/** Run a fake build → integration so the review gate mints a review-nits obs. */
async function mintReviewNitsObservation(slug: string): Promise<{
	repo: string;
	observationFile: string;
}> {
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
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	const core = await performIntegration({
		cwd: repo,
		arbiter: ARBITER,
		slug,
		source: 'backlog',
		recovering: false,
		verify: PASS,
		review: true,
		reviewGate: stubGate(APPROVE_WITH_NITS),
		mode: 'merge',
		env: gitEnv(),
	});
	expect(core.outcome).toBe('completed');
	const obsDir = join(repo, 'work', 'observations');
	const files = readdirSync(obsDir).filter((f) =>
		f.startsWith(`review-nits-${slug}-`),
	);
	expect(files).toHaveLength(1);
	return {repo, observationFile: files[0]};
}

describe('observation identity = filename — review-nits minting', () => {
	it('writes `reviewOf:` not `slug:` (no foreign-slug identity)', async () => {
		const {repo, observationFile} = await mintReviewNitsObservation('alpha');
		const body = readFileSync(
			join(repo, 'work', 'observations', observationFile),
			'utf8',
		);
		// The frontmatter does NOT claim identity with a foreign slug.
		expect(body).not.toMatch(/^slug:/m);
		// The back-pointer is `reviewOf:`, naming the reviewed slice.
		expect(body).toMatch(/^reviewOf: alpha$/m);
	});

	it('no cross-namespace identity collision: the obs slug is the filename, NOT the reviewed-done slice slug', async () => {
		const {repo, observationFile} = await mintReviewNitsObservation('beta');
		const observations = ledgerRead.resolveLocalState({
			repoPath: repo,
		}).observations;
		const minted = observations.find((o) => o.file === observationFile);
		expect(minted).toBeDefined();
		// Identity is the FILENAME (with `.md` stripped), not the reviewed slug.
		expect(minted!.slug).toBe(observationFile.replace(/\.md$/, ''));
		expect(minted!.slug).not.toBe('beta');
		// The reviewed slice landed in done/ — same slug as the OLD foreign-slug
		// identity would have been (the collision the new scheme avoids).
		expect(minted!.slug.startsWith('review-nits-beta-')).toBe(true);
	});
});

describe('observation identity = filename — enumerate→resolve round-trip is TOTAL', () => {
	it('a minted review-nits observation enumerates into the lifecycle pool AND its `obs:<slug>` resolves back through advance', async () => {
		const {repo, observationFile} = await mintReviewNitsObservation('gamma');

		// ENUMERATE: with the triage gate ON, the lifecycle pool keys observations
		// by FILENAME (post-fix), so the emitted slug is the basename of the file
		// we just minted.
		const pools = gatherLifecycleInPlace({
			repoPath: repo,
			gates: {triage: true},
		});
		const expectedSlug = observationFile.replace(/\.md$/, '');
		const enumerated = pools.triage.find(
			(p) => p.namespace === 'observation' && p.slug === expectedSlug,
		);
		expect(
			enumerated,
			'minted obs must appear in the triage lifecycle pool',
		).toBeDefined();

		// RESOLVE: the SAME slug routed through `performAdvance` (the matrix path)
		// reaches the triage rung WITHOUT the old exit-1 "could not find its item
		// file" wall. The triage rung is question-gated by default → it surfaces
		// the question (no `findItemPath` failure on the resolve half).
		const result = await performAdvance({
			arg: `obs:${enumerated!.slug}`,
			cwd: repo,
			// A no-op surface gate that records the spawn, no real model.
			surfaceGate: async () => ({
				item: `observation:${enumerated!.slug}`,
				questions: [
					{question: 'promote, keep, or delete?', disposition: 'keep'},
				],
			}),
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		// NOT the old failure mode.
		expect(result.outcome).not.toBe('usage-error');
		expect(result.outcome).not.toBe('vanished');
		expect(result.message).not.toMatch(/could not find its item file/);
	});
});

describe('observation identity = filename — a vanished lifecycle leg is a BENIGN SKIP, not exit-1', () => {
	it('`obs:<slug>` whose file was deleted between enumerate and run skips with `vanished` (exit 0), not `usage-error` (exit 1)', async () => {
		const {repo, observationFile} = await mintReviewNitsObservation('delta');

		// Simulate the cross-tick window: a sibling parallel leg triaged/deleted
		// the observation between enumerate and run.
		rmSync(join(repo, 'work', 'observations', observationFile));

		const slug = observationFile.replace(/\.md$/, '');
		const result = await performAdvance({
			arg: `obs:${slug}`,
			cwd: repo,
			// observationTriage:'auto' takes the path that calls findItemPath at
			// the top of the triage rung (the same guard surface + apply share).
			observationTriage: 'auto',
			triageGate: async () => ({auto: false}),
			surfaceGate: async () => ({
				item: `observation:${slug}`,
				questions: [],
			}),
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		// BENIGN SKIP: exit 0, the `vanished` outcome, a clear cross-tick message.
		// NOT the old exit-1 "a human must reconcile" wall.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('vanished');
		expect(result.message).toMatch(/benign skip/);
		expect(result.message).not.toMatch(/a human must reconcile/);
	});
});

describe('observation identity = filename — the 17 migrated review-nits obs each round-trip', () => {
	it('every `work/observations/review-nits-*.md` in THIS repo enumerates with slug = its filename (no foreign slug)', () => {
		// This is a snapshot check against the actual repo — the migration is the
		// DATA half of this slice. We do not start a throwaway tree here: we read
		// the live observations and assert the invariant on each one. Walk up from
		// the test file until we find a `work/observations` dir (the test runs with
		// `cwd` = the package, not the repo root).
		let repoPath = resolve(__dirname, '..');
		while (
			repoPath !== dirname(repoPath) &&
			!existsSync(join(repoPath, 'work', 'observations'))
		) {
			repoPath = dirname(repoPath);
		}
		const obsDir = join(repoPath, 'work', 'observations');
		const files = readdirSync(obsDir).filter((f) =>
			/^review-nits-.+\.md$/.test(f),
		);
		// Sanity: the slice noted exactly 17 minted review-nits observations; a
		// later run-of-the-mill review-nits-* observation file may also be present
		// (e.g. the slug-defect observation itself), so we tolerate ≥ 17.
		expect(files.length).toBeGreaterThanOrEqual(17);

		const enumerated = ledgerRead.resolveLocalState({repoPath}).observations;
		for (const file of files) {
			const item = enumerated.find((o) => o.file === file);
			expect(item, `observation ${file} must enumerate`).toBeDefined();
			// Identity = filename stem (no foreign slug snuck through).
			expect(item!.slug).toBe(file.replace(/\.md$/, ''));
		}
	});
});
