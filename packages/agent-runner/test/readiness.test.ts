import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	seedDoneOnArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-readiness-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Current branch (short name) of a checkout. */
function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}

/** Does a local branch exist in this checkout? */
function localBranchExists(repo: string, branch: string): boolean {
	return gitIn(['branch', '--list', branch], repo).trim() !== '';
}

describe('readiness guard — claim path: unmet blockedBy', () => {
	it('REFUSES by default and claims nothing, naming the missing slug(s)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
			blockedBy: ['dep-a', 'dep-b'],
		});
		// Neither dependency is in work/tasks/done/ on the arbiter.
		const notes: string[] = [];
		const result = await performClaim({
			slug: 'feature',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			humanPath: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('not-ready');
		// Names every missing slug.
		expect(result.message).toMatch(/dep-a/);
		expect(result.message).toMatch(/dep-b/);
		// Claimed NOTHING: still in backlog, not in-progress on the arbiter.
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'feature')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'in-progress', 'feature')).toBe(
			false,
		);
	});

	it('claims normally once the only missing dependency lands in done/', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
			blockedBy: ['dep-a'],
		});
		// Refused while dep-a is not done.
		const refused = await performClaim({
			slug: 'feature',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			humanPath: true,
			env: gitEnv(),
		});
		expect(refused.outcome).toBe('not-ready');

		// Land dep-a in work/tasks/done/ on the arbiter, then re-claim.
		seedDoneOnArbiter(seeded, 'dep-a');
		const ok = await performClaim({
			slug: 'feature',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			humanPath: true,
			env: gitEnv(),
		});
		expect(ok.exitCode).toBe(0);
		expect(ok.outcome).toBe('claimed');
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'feature')).toBe(true);
	});
});

describe('readiness guard — claim path: override', () => {
	it('claims an unmet-blockedBy slice anyway and loudly notes the override', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
			blockedBy: ['dep-a'],
		});
		const notes: string[] = [];
		const result = await performClaim({
			slug: 'feature',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			humanPath: true,
			override: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('claimed');
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'feature')).toBe(true);
		// Loud override notice mentioning the guard was overridden.
		expect(notes.some((n) => /OVERRIDDEN/.test(n))).toBe(true);
		expect(notes.some((n) => /dep-a/.test(n))).toBe(true);
	});
});

describe('readiness guard — claim path: needsAnswers warning', () => {
	it('prints a loud WARNING but still claims', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['questions'], {
			needsAnswers: true,
		});
		const notes: string[] = [];
		const result = await performClaim({
			slug: 'questions',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			humanPath: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('claimed');
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'questions')).toBe(true);
		expect(notes.some((n) => /WARNING/.test(n) && /needsAnswers/.test(n))).toBe(
			true,
		);
	});

	it('the override silences the needsAnswers warning', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['questions'], {
			needsAnswers: true,
		});
		const notes: string[] = [];
		const result = await performClaim({
			slug: 'questions',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			humanPath: true,
			override: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('claimed');
		// No raw WARNING line; the override notice replaces it.
		expect(notes.some((n) => /^!! WARNING:/.test(n))).toBe(false);
		expect(notes.some((n) => /OVERRIDDEN/.test(n))).toBe(true);
	});
});

describe('readiness guard — claim path: ready slice unchanged', () => {
	it('a fully-ready slice (deps done, no needsAnswers) claims with no warnings', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
			blockedBy: ['dep-a'],
		});
		seedDoneOnArbiter(seeded, 'dep-a');
		const notes: string[] = [];
		const result = await performClaim({
			slug: 'feature',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			humanPath: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('claimed');
		// No readiness chatter for a ready slice.
		expect(notes.some((n) => /OVERRIDDEN/.test(n))).toBe(false);
		expect(notes.some((n) => /WARNING/.test(n))).toBe(false);
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'feature')).toBe(true);
	});

	it('humanOnly is NOT gated on the human path (still claimable, no refusal)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['decided'], {
			humanOnly: true,
		});
		const result = await performClaim({
			slug: 'decided',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			humanPath: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('claimed');
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'decided')).toBe(true);
	});
});

describe('readiness guard — autonomous path is unchanged', () => {
	it('without humanPath, an unmet-blockedBy slice is still claimed (filtered upstream by eligibility)', async () => {
		// The autonomous runner does NOT pass humanPath: it pre-filters via
		// scan→eligibility, so performClaim itself must not start refusing.
		const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
			blockedBy: ['dep-a'],
		});
		const result = await performClaim({
			slug: 'feature',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('claimed');
	});
});

describe('readiness guard — start path inherits it', () => {
	it('start REFUSES an unmet-blockedBy slice and creates no work branch', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
			blockedBy: ['dep-a'],
		});
		const before = currentBranch(seeded.repo);
		const result = await performStart({
			slug: 'feature',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/dep-a/);
		// User untouched; NO work branch.
		expect(currentBranch(seeded.repo)).toBe(before);
		expect(localBranchExists(seeded.repo, 'work/slice-feature')).toBe(false);
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'feature')).toBe(true);
	});

	it('start --force claims the unmet-blockedBy slice and lands on the work branch', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feature'], {
			blockedBy: ['dep-a'],
		});
		const notes: string[] = [];
		const result = await performStart({
			slug: 'feature',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			override: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('started');
		expect(result.branch).toBe('work/slice-feature');
		expect(currentBranch(seeded.repo)).toBe('work/slice-feature');
		expect(notes.some((n) => /OVERRIDDEN/.test(n))).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'feature')).toBe(true);
	});

	it('start warns on needsAnswers but still starts', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['questions'], {
			needsAnswers: true,
		});
		const notes: string[] = [];
		const result = await performStart({
			slug: 'questions',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('started');
		expect(currentBranch(seeded.repo)).toBe('work/slice-questions');
		expect(notes.some((n) => /WARNING/.test(n))).toBe(true);
	});

	it('a fully-ready slice starts exactly as before (no behaviour change)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['ready']);
		const result = await performStart({
			slug: 'ready',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result).toEqual({
			exitCode: 0,
			outcome: 'started',
			branch: 'work/slice-ready',
			message: expect.stringContaining('Started'),
		});
		expect(currentBranch(seeded.repo)).toBe('work/slice-ready');
	});
});
