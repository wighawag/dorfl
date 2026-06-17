import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {performSlice, type SliceAgentRunner} from '../src/slicing.js';
import {performClaim} from '../src/claim-cas.js';
import {promoteFromPreBacklog} from '../src/needs-attention.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * STEP A of the staging/pool position gate (PRD
 * `staging-pool-position-gate-and-trust-model`, slice
 * `pre-backlog-staging-folder-and-promote-step-a`; governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`).
 *
 * The TRACER proves four things end-to-end against a `--bare file://` arbiter
 * (house pattern via `test/helpers/gitRepo.ts`):
 *
 *   (a) the slicing path's emitted slices land STAGED in `work/pre-backlog/`,
 *       NOT in `work/backlog/`;
 *   (b) `work/backlog/` STILL means the agent-eligible pool — the claim CAS reads
 *       `work/backlog/` byte-for-byte unchanged and refuses a STAGED slug;
 *   (c) the runner-owned promotion (`promoteFromPreBacklog`) moves the staged
 *       slice `pre-backlog/ → backlog/` on the arbiter and the same slug
 *       becomes claimable;
 *   (d) the agent cannot self-place into the pool — a slicing agent that writes
 *       directly into `work/backlog/` has its writes scrubbed by the
 *       pool-placement fence, so the final arbiter carries nothing in the pool
 *       for that slug (only the legitimately staged file). There is no
 *       agent-facing API that performs the promotion: it is a separate
 *       runner-owned function the slicing path does not call.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('pre-backlog-step-a-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

function seedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'prd');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug} — slice me`,
			`slug: ${slug}`,
			'---',
			'',
			'## Problem Statement',
			'',
			`PRD body for ${slug}.`,
			'',
		].join('\n'),
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `prd: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/** An agent that writes one staged slice file under `work/pre-backlog/`. */
function stagingAgent(file = 'child'): SliceAgentRunner {
	return ({cwd}) => {
		const dir = join(cwd, 'work', 'pre-backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${file}.md`),
			[
				'---',
				`title: ${file}`,
				`slug: ${file}`,
				'prd: it',
				'---',
				'',
				'## Prompt',
				'',
				'> build it',
				'',
			].join('\n'),
		);
		return {ok: true};
	};
}

/**
 * A MISBEHAVING agent that writes BOTH:
 *  - a legitimate staged slice under `work/pre-backlog/<legit>.md`, AND
 *  - a self-placement attempt directly under `work/backlog/<hijack>.md`
 *    (an attempt to self-promote into the agent-eligible pool, PRD US #4 / ADR).
 * The runner's pool-placement fence must scrub the second.
 */
function selfPlacingAgent(legit: string, hijack: string): SliceAgentRunner {
	return ({cwd}) => {
		const staged = join(cwd, 'work', 'pre-backlog');
		mkdirSync(staged, {recursive: true});
		writeFileSync(
			join(staged, `${legit}.md`),
			`---\nslug: ${legit}\nprd: it\n---\n\n## Prompt\n\n> ${legit}\n`,
		);
		const pool = join(cwd, 'work', 'backlog');
		mkdirSync(pool, {recursive: true});
		writeFileSync(
			join(pool, `${hijack}.md`),
			`---\nslug: ${hijack}\nprd: it\n---\n\n## Prompt\n\n> hijacked into pool\n`,
		);
		return {ok: true};
	};
}

function onArbiterMain(repo: string, path: string): boolean {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
}

function showArbiterMain(repo: string, path: string): string {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return run('git', ['show', `${ARBITER}/main:${path}`], repo, {
		env: gitEnv(),
	}).stdout;
}

describe('STEP A — slicer output lands STAGED in pre-backlog/, not backlog/', () => {
	it('a --merge slicing run commits the emitted slice under work/pre-backlog/ (the pool is untouched)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: stagingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.emitted).toEqual(['work/pre-backlog/child.md']);
		// The slice landed in the STAGING folder, not the pool.
		expect(onArbiterMain(repo, 'work/pre-backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/backlog/child.md')).toBe(false);
		// PRD lifecycle move still happens (the staging split is orthogonal).
		expect(onArbiterMain(repo, 'work/prd-sliced/it.md')).toBe(true);
	});
});

describe('STEP A — work/backlog/ STILL means the agent-eligible pool (readers unchanged)', () => {
	it('a STAGED slug is NOT claimable (the claim CAS reads work/backlog/ only)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: stagingAgent('staged-only'),
			env: gitEnv(),
		});
		// The slice is staged on the arbiter…
		expect(onArbiterMain(repo, 'work/pre-backlog/staged-only.md')).toBe(true);
		// …but the claim CAS (which reads work/backlog/<slug>.md) refuses it: there
		// is no such pool item.
		const claim = await performClaim({
			slug: 'staged-only',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.outcome).not.toBe('claimed');
	});

	it('a slug that IS in work/backlog/ (seeded directly) is claimable (the pool reader is unchanged)', async () => {
		// Seed a slice directly into the pool (modelling something a human / a future
		// promotion has already moved into work/backlog/).
		const {repo} = seedRepoWithArbiter(scratch.root, ['inpool']);
		const claim = await performClaim({
			slug: 'inpool',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.outcome).toBe('claimed');
	});
});

describe('STEP A — the runner-owned promotion makes a staged slice claimable', () => {
	it('promoteFromPreBacklog moves work/pre-backlog/<slug>.md -> work/backlog/<slug>.md on the arbiter; afterwards the slug claims', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: stagingAgent('to-promote'),
			env: gitEnv(),
		});
		// Precondition: staged, NOT in the pool — and not claimable.
		expect(onArbiterMain(repo, 'work/pre-backlog/to-promote.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/backlog/to-promote.md')).toBe(false);
		const before = await performClaim({
			slug: 'to-promote',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(before.outcome).not.toBe('claimed');

		// PROMOTE (runner-owned).
		const promoted = await promoteFromPreBacklog({
			slug: 'to-promote',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(promoted.moved).toBe(true);
		expect(promoted.commitMessage).toMatch(
			/promote work\/pre-backlog\/ -> work\/backlog\//,
		);

		// Postcondition: in the pool, no longer staged — and now claimable.
		expect(onArbiterMain(repo, 'work/pre-backlog/to-promote.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/backlog/to-promote.md')).toBe(true);
		const after = await performClaim({
			slug: 'to-promote',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(after.outcome).toBe('claimed');
	});

	it('promote on a slug not in pre-backlog/ refuses cleanly (no main move)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await promoteFromPreBacklog({
			slug: 'nope',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/not staged|wrong slug|nothing/i);
	});
});

describe('STEP A — the agent cannot self-place into the pool (pool-placement fence)', () => {
	it('an agent that writes work/backlog/<hijack>.md during slicing has its write scrubbed; only work/pre-backlog/<legit>.md lands', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: selfPlacingAgent('legit', 'hijack'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The legitimate STAGED placement landed (the agent's pre-backlog/ write).
		expect(onArbiterMain(repo, 'work/pre-backlog/legit.md')).toBe(true);
		// The self-placement attempt did NOT reach the pool: the runner's fence
		// scrubbed the agent's `work/backlog/<hijack>.md` write before the
		// integrate's `git add -A` could land it.
		expect(onArbiterMain(repo, 'work/backlog/hijack.md')).toBe(false);
		// And — crucially — the agent cannot promote the legit slice into the pool
		// either: nothing the slicing path emits puts an item into work/backlog/.
		// The promotion is a separate runner-owned move (`promoteFromPreBacklog`).
		expect(onArbiterMain(repo, 'work/backlog/legit.md')).toBe(false);
	});

	it('a pool-edit attempt (the agent overwrites a PRE-EXISTING pool slice during slicing) is also reverted (HEAD content preserved)', async () => {
		// Seed a pool slice on the arbiter first.
		const {repo} = seedRepoWithArbiter(scratch.root, ['poolitem']);
		const poolBefore = showArbiterMain(repo, 'work/backlog/poolitem.md');
		seedPrd(repo, 'it');
		// Agent writes a legit staged slice AND tampers with the pre-existing pool slice.
		const tamperingAgent: SliceAgentRunner = ({cwd}) => {
			const staged = join(cwd, 'work', 'pre-backlog');
			mkdirSync(staged, {recursive: true});
			writeFileSync(
				join(staged, 'fresh.md'),
				'---\nslug: fresh\nprd: it\n---\n\n## Prompt\n\n> fresh\n',
			);
			writeFileSync(
				join(cwd, 'work', 'backlog', 'poolitem.md'),
				'TAMPERED CONTENT',
			);
			return {ok: true};
		};
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: tamperingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The pre-existing pool slice is BYTE-FOR-BYTE unchanged on the arbiter.
		expect(showArbiterMain(repo, 'work/backlog/poolitem.md')).toBe(poolBefore);
		// The legitimately staged slice landed.
		expect(onArbiterMain(repo, 'work/pre-backlog/fresh.md')).toBe(true);
	});
});
