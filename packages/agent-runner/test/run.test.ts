import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {runOnce, type AgentRunner, type TestGate} from '../src/run.js';
import {claimItem} from '../src/claim.js';
import {mergeConfig} from '../src/config.js';
import {scan} from '../src/scan.js';
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
	scratch = makeScratch('agent-runner-run-');
});
afterEach(() => {
	scratch.cleanup();
});

/** An agent that edits a file (so the commit is non-empty) and succeeds. */
const editingAgent: AgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

const greenGate: TestGate = () => ({green: true});
const redGate: TestGate = () => ({green: false, detail: 'tests failed'});

function configFor(root: string, overrides = {}) {
	// Scan only the seeded `project` repo. Throwaway clones/arbiter live as
	// siblings under `root`; pointing roots at the project keeps them out of scan.
	return mergeConfig({
		roots: [join(root, 'project')],
		defaultArbiter: 'arbiter',
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'merge',
		agentCmd: 'true',
		...overrides,
	});
}

describe('runOnce — happy path (green gate)', () => {
	it('claims an eligible item, runs the agent, and moves it to done on green tests', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const result = runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.claimedAndDone).toBe(1);
		const item = result.items[0];
		expect(item.status).toBe('claimed-done');
		// integration: merge → on the arbiter's main, in done/, not in-progress.
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(false);
	});
});

describe('runOnce — test gate keeps failing work out of done/', () => {
	it('leaves a red item in in-progress, never moving it to done', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const result = runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: redGate,
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('tests-failed');
		expect(result.claimedAndDone).toBe(0);
		// claim landed (in-progress on main), but it NEVER reached done.
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
	});
});

describe('runOnce — concurrency caps', () => {
	it('claims at most maxParallel items then stops', () => {
		seedRepoWithArbiter(scratch.root, ['a', 'b', 'c', 'd', 'e']);
		const config = configFor(scratch.root, {maxParallel: 2, perRepoMax: 10});
		const result = runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items).toHaveLength(2);
		expect(result.claimedAndDone).toBe(2);
	});

	it('claims at most perRepoMax items from one repo', () => {
		seedRepoWithArbiter(scratch.root, ['a', 'b', 'c', 'd']);
		const config = configFor(scratch.root, {maxParallel: 10, perRepoMax: 1});
		const result = runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items).toHaveLength(1);
	});
});

describe('runOnce — lost race is skipped cleanly', () => {
	it('skips an item already claimed by someone else (claim exit 2)', () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		// Pre-claim `solo` from an independent clone so the runner loses the race.
		const other = seeded.clone('other');
		const pre = claimItem({
			slug: 'solo',
			cwd: other,
			arbiter: 'arbiter',
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
		});
		expect(pre.outcome).toBe('claimed');

		const config = configFor(scratch.root);
		const result = runOnce({
			config,
			// scan the still-stale working clone (its backlog still lists solo)
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('lost-race');
		expect(result.skipped).toBe(1);
		expect(result.claimedAndDone).toBe(0);
	});
});

describe('runOnce — simultaneous two-runner race (exactly one winner)', () => {
	it('two runners racing the same single item produce exactly one claimed-done', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		// Two independent working clones of the arbiter, each its own scan root.
		const a = seeded.clone('a');
		const b = seeded.clone('b');

		const configFrom = (clone: string) =>
			mergeConfig({
				roots: [clone],
				defaultArbiter: 'arbiter',
				maxParallel: 4,
				perRepoMax: 2,
				integration: 'merge',
				agentCmd: 'true',
			});

		const runFrom = (clone: string, agentId: string) => {
			const config = configFrom(clone);
			return runOnce({
				config,
				report: scan(config),
				workspace: join(scratch.root, `ws-${agentId}`),
				agentRunner: editingAgent,
				testGate: greenGate,
				claimScript: CLAIM_SCRIPT,
				env: gitEnv(),
				agentId: () => agentId,
			});
		};

		const [ra, rb] = await Promise.all([
			Promise.resolve().then(() => runFrom(a, 'A')),
			Promise.resolve().then(() => runFrom(b, 'B')),
		]);

		const statuses = [ra.items[0]?.status, rb.items[0]?.status];
		const winners = statuses.filter((s) => s === 'claimed-done');
		const losers = statuses.filter((s) => s === 'lost-race');
		expect(winners).toHaveLength(1);
		expect(losers).toHaveLength(1);
	});
});

describe('runOnce — integration modes', () => {
	it('integration: pr does NOT push to main; it pushes the work branch + opens a PR', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root, {integration: 'pr'});
		let prBranch = '';
		const result = runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
			agentId: () => 'agentA',
			openPr: ({branch}) => {
				prBranch = branch;
			},
		});
		const item = result.items[0];
		expect(item.status).toBe('claimed-done');
		expect(item.integration?.mode).toBe('pr');
		expect(item.integration?.mergedToMain).toBe(false);
		expect(item.integration?.prOpened).toBe(true);
		expect(prBranch).toBe('work/feat-agentA');
		// PR mode never moves done/ onto main; the slice stays in-progress on main.
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(true);
	});

	it('integration: merge lands the done-move directly on the arbiter main', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root, {integration: 'merge'});
		const result = runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].integration?.mergedToMain).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);
	});
});

describe('runOnce — agent failure', () => {
	it('does not move to done when the agent itself fails', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const failingAgent: AgentRunner = () => ({ok: false, detail: 'boom'});
		const result = runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: failingAgent,
			testGate: greenGate,
			claimScript: CLAIM_SCRIPT,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('agent-failed');
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(true);
	});
});
