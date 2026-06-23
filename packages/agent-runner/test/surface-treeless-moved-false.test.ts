import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performDo} from '../src/do.js';
import {performStart} from '../src/start.js';
import {runOnce} from '../src/run.js';
import {returnToBacklog} from '../src/needs-attention.js';
import * as ledgerWriteModule from '../src/ledger-write.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * The after-commit CONTINUE-sites surface a stuck continued task to
 * needs-attention TREE-LESSLY. That surface is a CAS publish to the arbiter's
 * main; it returns `{moved, reasonNotMoved}` and reports `{moved:false}` (NOT an
 * error) when it loses the CAS race against a busy arbiter (its contention-retry
 * cap exhausted) or has no arbiter. These tests pin that on a `moved:false` the
 * site produces the DISTINCT honest `surface-unmoved` result (the surface did NOT
 * reach main; the item is still in-progress on the arbiter), instead of a clean
 * needs-attention that would claim the surface landed.
 *
 * Both branches are covered: the `moved:true` happy path still reports a clean
 * needs-attention; the `moved:false` path (the seam STUBBED to return it, never
 * real contention) reports `surface-unmoved`. Real git + a local `--bare`
 * arbiter; throwaway temp fixtures only (no shared/global location is written).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-surface-unmoved-');
});
afterEach(() => {
	scratch.cleanup();
	vi.restoreAllMocks();
});

const ARBITER = 'arbiter';

/** Scan the single seeded `project` checkout (the layout `seedRepoWithArbiter` uses). */
function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
	return scanRepoPaths([join(scratch.root, 'project')], config);
}

/** A green-gate merge config over the seeded checkout (mirrors run.test.ts). */
function configFor(overrides: Record<string, unknown> = {}) {
	return mergeConfig({
		defaultArbiter: ARBITER,
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'merge',
		agentCmd: 'true',
		verify: 'exit 0',
		autoBuild: true,
		...overrides,
	});
}

/**
 * Drive a repo into the onboard-time CONTINUE rebase-conflict state: a kept
 * `work/task-<slug>` (from a requeue) whose commits cannot replay onto a main
 * that advanced with a CONFLICTING edit. Mirrors the existing do.test.ts
 * conflict scenario. Leaves the repo's local `main` on the advanced arbiter main,
 * ready for a second `performDo`/`runOnce`/`performStart` that hits the continue
 * site.
 */
async function intoContinueConflict(slug: string): Promise<{
	repo: string;
	arbiter: string;
	seeded: ReturnType<typeof seedRepoWithArbiter>;
}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;

	// First attempt: edit a SHARED file then fail the gate, so the kept
	// work/task-<slug> (with that edit) is pushed to the arbiter.
	const first = await performDo({
		arg: slug,
		cwd: repo,
		arbiter: ARBITER,
		integration: 'merge',
		verify: 'exit 1',
		agentRunner: ({cwd}) => {
			writeFileSync(join(cwd, 'shared.txt'), 'agent version\n');
			return {ok: true};
		},
		env: gitEnv(),
	});
	expect(first.outcome).toBe('needs-attention');

	// Requeue (keep + continue).
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
	const requeued = await returnToBacklog({
		cwd: repo,
		slug,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(requeued.moved).toBe(true);

	// Main advances with a CONFLICTING edit to the same file (from a separate
	// clone), so the kept branch cannot replay onto the new main.
	const mover = seeded.clone('mover');
	gitIn(['fetch', '-q', ARBITER], mover);
	gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
	writeFileSync(join(mover, 'shared.txt'), 'main version (conflicting)\n');
	gitIn(['add', '-A'], mover);
	gitIn(['commit', '-q', '-m', 'conflicting main edit'], mover);
	gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

	gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
	return {repo, arbiter: seeded.arbiter, seeded};
}

describe('do — continue-site surface moved:false (surface-unmoved)', () => {
	it('a moved:false surface (seam stubbed) reports surface-unmoved, NOT a clean needs-attention', async () => {
		const {repo} = await intoContinueConflict('alpha');

		// STUB the tree-less surface to LOSE the CAS race (contention-exhausted).
		const spy = vi
			.spyOn(
				ledgerWriteModule.ledgerWrite,
				'applyTreelessNeedsAttentionTransition',
			)
			.mockResolvedValue({
				moved: false,
				reasonNotMoved: 'the arbiter main kept moving (contended) — stubbed.',
			});

		let agentRan = false;
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});

		expect(spy).toHaveBeenCalled();
		expect(agentRan).toBe(false);
		// DISTINCT honest outcome (NOT 'needs-attention').
		expect(result.outcome).toBe('surface-unmoved');
		expect(result.outcome).not.toBe('needs-attention');
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/still IN-PROGRESS on the arbiter/i);
		expect(result.message).toMatch(/contended/i);
	});

	it('a moved:true surface still reports a clean needs-attention (happy path unchanged)', async () => {
		const {repo} = await intoContinueConflict('beta');

		let agentRan = false;
		const result = await performDo({
			arg: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});

		expect(agentRan).toBe(false);
		expect(result.outcome).toBe('needs-attention');
		expect(result.exitCode).toBe(1);
		// The surface landed: the item is on the arbiter's needs-attention.
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(stuckLockOnArbiter(repo, 'beta')).toBe(true);
	});
});

describe('run — continue-site surface moved:false (surface-unmoved)', () => {
	it('a moved:false surface (seam stubbed) reports status surface-unmoved, NOT needs-attention', async () => {
		const {repo, arbiter} = await intoContinueConflict('gamma');
		const workspacesDir = join(scratch.root, '.agent-runner');
		const config = configFor({
			workspacesDir,
		});
		// run scans the working-tree repos; this repo's main is on the advanced
		// arbiter main with the kept work branch still on the arbiter.
		const report = scanProject(config);

		const spy = vi
			.spyOn(
				ledgerWriteModule.ledgerWrite,
				'applyTreelessNeedsAttentionTransition',
			)
			.mockResolvedValue({
				moved: false,
				reasonNotMoved: 'the arbiter main kept moving (contended) — stubbed.',
			});

		let agentRan = false;
		const result = await runOnce({
			config,
			report,
			workspace: workspacesDir,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});

		expect(spy).toHaveBeenCalled();
		expect(agentRan).toBe(false);
		const item = result.items.find((i) => i.slug === 'gamma');
		expect(item?.status).toBe('surface-unmoved');
		expect(item?.status).not.toBe('needs-attention');
		expect(item?.detail).toMatch(/still IN-PROGRESS on the arbiter/i);
		// It counts as a failure, NOT a clean needs-attention.
		expect(result.needsAttention).toBe(0);
		expect(arbiter).toBeTruthy();
	});

	it('a moved:true surface still reports status needs-attention (happy path unchanged)', async () => {
		const {repo} = await intoContinueConflict('delta');
		const workspacesDir = join(scratch.root, '.agent-runner');
		const config = configFor({
			workspacesDir,
		});
		const report = scanProject(config);

		const result = await runOnce({
			config,
			report,
			workspace: workspacesDir,
			agentRunner: () => ({ok: true}),
			env: gitEnv(),
		});

		const item = result.items.find((i) => i.slug === 'delta');
		expect(item?.status).toBe('needs-attention');
		expect(result.needsAttention).toBe(1);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(stuckLockOnArbiter(repo, 'delta')).toBe(true);
	});
});

describe('start — continue-site surface moved:false (surface-unmoved)', () => {
	it('a moved:false surface (seam stubbed) reports outcome surface-unmoved, NOT needs-attention', async () => {
		const {repo} = await intoContinueConflict('epsilon');

		const spy = vi
			.spyOn(
				ledgerWriteModule.ledgerWrite,
				'applyTreelessNeedsAttentionTransition',
			)
			.mockResolvedValue({
				moved: false,
				reasonNotMoved: 'the arbiter main kept moving (contended) — stubbed.',
			});

		const result = await performStart({
			slug: 'epsilon',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(spy).toHaveBeenCalled();
		expect(result.outcome).toBe('surface-unmoved');
		expect(result.outcome).not.toBe('needs-attention');
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/still IN-PROGRESS on the arbiter/i);
		expect(result.message).toMatch(/contended/i);
	});

	it('a moved:true surface still reports outcome needs-attention (happy path unchanged)', async () => {
		const {repo} = await intoContinueConflict('zeta');

		const result = await performStart({
			slug: 'zeta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('needs-attention');
		expect(result.exitCode).toBe(1);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(stuckLockOnArbiter(repo, 'zeta')).toBe(true);
	});
});
