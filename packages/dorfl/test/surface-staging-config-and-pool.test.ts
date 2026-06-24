import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	existsSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {gatherLifecycleInPlace} from '../src/lifecycle-gather.js';
import {scanRepoPaths} from '../src/scan.js';
import {
	performAdvanceAuto,
	type AdvanceTickRunner,
} from '../src/advance-drivers.js';
import {performDoAuto, type DoRunner} from '../src/do-autopick.js';
import {applyAnsweredQuestions} from '../src/apply-persist.js';
import type {AdvanceResult} from '../src/advance.js';
import type {DoResult} from '../src/do.js';
import {mergeConfig, DEFAULT_CONFIG, type Config} from '../src/config.js';
import {DEFAULT_SELECTION_ORDER} from '../src/select-order.js';
import {newSidecar, serialiseSidecar, sidecarPathFor} from '../src/sidecar.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';
import {promoteFromPreBacklog} from '../src/needs-attention.js';
import {acquireItemLock, releaseItemLock} from '../src/item-lock.js';
import {run} from '../src/git.js';

/**
 * F2 — `surfaceStaging` (default true) opens the SURFACE polarity into STAGING
 * (`tasks/backlog/` + `prds/proposed/`) without opening the BUILD polarity
 * (prd `staging-surface-and-apply-promote-safety`).
 *
 * Covers the task acceptance set:
 *   (a) a `needsAnswers` task in `tasks/backlog/` appears in the surface pool
 *       under the default `true`;
 *   (b) a `needsAnswers` prd in `prds/proposed/` appears under the default;
 *   (c) both disappear under `surfaceStaging:false` (pool-only legacy);
 *   (d) BUILD/claim never sees staged items in EITHER mode (the trust model is
 *       untouched);
 *   (e) end-to-end: a `needsAnswers` task in `tasks/backlog/` surfaces → answer
 *       → apply WITHOUT a manual promote first;
 *   (f) F3 precondition assertion: a concurrent promote during the apply does
 *       NOT split-brain (the per-item lock serialises them).
 */

let root: string;
let repo: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-surface-staging-'));
	repo = join(root, 'project');
	mkdirSync(repo, {recursive: true});
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

function seedStagedTask(slug: string, fm: {needsAnswers?: boolean} = {}): void {
	const dir = join(repo, 'work', 'tasks', 'backlog');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	lines.push('blockedBy: []', '---', '', `# ${slug}`);
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

function seedPoolTask(slug: string, fm: {needsAnswers?: boolean} = {}): void {
	const dir = join(repo, 'work', 'tasks', 'ready');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	lines.push('blockedBy: []', '---', '', `# ${slug}`);
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

function seedStagedPrd(slug: string, fm: {needsAnswers?: boolean} = {}): void {
	const dir = join(repo, 'work', 'prds', 'proposed');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	lines.push('---', '', '# prd');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

function seedSidecar(
	namespace: 'task' | 'prd',
	slug: string,
	answered: boolean,
): void {
	const item = `${namespace}:${slug}`;
	const model = newSidecar(item, [{question: 'pick one?'}]);
	if (answered) {
		model.entries[0].answer = 'yes';
	}
	const rel = sidecarPathFor(item);
	const abs = join(repo, rel);
	mkdirSync(join(abs, '..'), {recursive: true});
	writeFileSync(abs, serialiseSidecar(model));
}

function cfg(over: Partial<Config> = {}): Config {
	return mergeConfig({autoBuild: true, autoTask: true, ...over});
}

describe('surfaceStaging defaults to true (Config + gate-family contract)', () => {
	it('built-in DEFAULT_CONFIG.surfaceStaging is true', () => {
		expect(DEFAULT_CONFIG.surfaceStaging).toBe(true);
		expect(mergeConfig({}).surfaceStaging).toBe(true);
	});
});

describe('surfaceStaging:true (default) — staged needsAnswers items appear in the surface pool', () => {
	it('(a) a `needsAnswers` task in tasks/backlog/ is a SURFACE candidate', () => {
		seedStagedTask('staged-task', {needsAnswers: true});
		const pools = gatherLifecycleInPlace({
			repoPath: repo,
			gates: {surface: true, surfaceStaging: true},
		});
		expect(pools.surface.map((i) => `${i.namespace}:${i.slug}`)).toContain(
			'task:staged-task',
		);
		expect(pools.apply).toEqual([]);
	});

	it('(b) a `needsAnswers` prd in prds/proposed/ is a SURFACE candidate', () => {
		seedStagedPrd('staged-prd', {needsAnswers: true});
		const pools = gatherLifecycleInPlace({
			repoPath: repo,
			gates: {surface: true, surfaceStaging: true},
		});
		expect(pools.surface.map((i) => `${i.namespace}:${i.slug}`)).toContain(
			'prd:staged-prd',
		);
	});

	it('scan --json `lifecycle.surface[]` enumerates staged items so the CI matrix sees them', () => {
		// Repo-level config opt-in to the SURFACE create-gate; surfaceStaging default
		// `true` widens it into staging via lifecycleGatesFrom.
		writeFileSync(
			join(repo, '.dorfl.json'),
			JSON.stringify({surfaceBlockers: true}, null, 2),
		);
		seedStagedTask('staged-task', {needsAnswers: true});
		seedStagedPrd('staged-prd', {needsAnswers: true});

		const report = scanRepoPaths([repo], cfg({surfaceBlockers: true}));
		const surface = report.repos[0].lifecycle.surface.map(
			(i) => `${i.namespace}:${i.slug}`,
		);
		expect(surface).toEqual(
			expect.arrayContaining(['task:staged-task', 'prd:staged-prd']),
		);
	});
});

describe('surfaceStaging:false — staging is NOT inspected (legacy pool-only)', () => {
	it('(c) staged task + prd disappear from the surface pool', () => {
		seedStagedTask('staged-task', {needsAnswers: true});
		seedStagedPrd('staged-prd', {needsAnswers: true});
		const pools = gatherLifecycleInPlace({
			repoPath: repo,
			gates: {surface: true, surfaceStaging: false},
		});
		expect(pools.surface).toEqual([]);
		expect(pools.apply).toEqual([]);
	});

	it('scan --json `lifecycle.surface[]` is empty for staged-only items when the gate is off', () => {
		writeFileSync(
			join(repo, '.dorfl.json'),
			JSON.stringify({surfaceBlockers: true, surfaceStaging: false}, null, 2),
		);
		seedStagedTask('staged-task', {needsAnswers: true});
		seedStagedPrd('staged-prd', {needsAnswers: true});

		const report = scanRepoPaths([repo], cfg({surfaceBlockers: true}));
		expect(report.repos[0].lifecycle.surface).toEqual([]);
	});
});

describe('(d) BUILD/claim eligibility is UNCHANGED in EITHER mode', () => {
	function buildRunner(): {run: DoRunner; args: string[]} {
		const args: string[] = [];
		const run: DoRunner = async (opts) => {
			args.push(opts.arg);
			return {
				exitCode: 0,
				outcome: 'completed',
				message: `did ${opts.arg}`,
			} satisfies DoResult;
		};
		return {run, args};
	}

	it('do auto-pick (build) does NOT see a staged task even with surfaceStaging:true', async () => {
		seedStagedTask('staged-buildable'); // NOT needsAnswers — would otherwise be eligible
		seedPoolTask('pool-buildable');
		const {run, args} = buildRunner();
		await performDoAuto({
			cwd: repo,
			run,
			config: cfg({surfaceStaging: true}),
			count: 99,
		});
		// Only the pool item is eligible; staging is invisible to BUILD/claim.
		expect(args).toEqual(['pool-buildable']);
	});

	it('do auto-pick does NOT see a staged task with surfaceStaging:false either', async () => {
		seedStagedTask('staged-buildable');
		seedPoolTask('pool-buildable');
		const {run, args} = buildRunner();
		await performDoAuto({
			cwd: repo,
			run,
			config: cfg({surfaceStaging: false}),
			count: 99,
		});
		expect(args).toEqual(['pool-buildable']);
	});

	it('scan eligibility `items[]` only enumerates the agent pool (tasks/ready), never staging', () => {
		seedStagedTask('staged-task');
		seedPoolTask('pool-task');
		const report = scanRepoPaths([repo], cfg());
		const slugs = report.repos[0].items.map((i) => i.slug);
		expect(slugs).toEqual(['pool-task']);
	});
});

describe('(e) end-to-end: surface → answer → apply on a staged needsAnswers task, NO manual promote', () => {
	function recordingRunner(): {
		run: AdvanceTickRunner;
		args: string[];
	} {
		const args: string[] = [];
		const run: AdvanceTickRunner = async (opts) => {
			args.push(opts.arg);
			return {
				exitCode: 0,
				outcome: 'advanced',
				slug: opts.arg,
				message: `advanced ${opts.arg}`,
			} satisfies AdvanceResult;
		};
		return {run, args};
	}

	it('a staged task with no sidecar is auto-picked into the SURFACE rung; once a sidecar is answered, it auto-picks into APPLY — all without leaving tasks/backlog/', async () => {
		seedStagedTask('born-in-staging', {needsAnswers: true});

		// First tick — SURFACE: no sidecar yet, so the gather routes the staged
		// item into the surface sub-pool (gate forced on, surfaceStaging default-on).
		const r1 = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run: r1.run,
			config: cfg(),
			lifecycleGates: {
				triage: true,
				surface: true,
				surfaceStaging: true,
			},
			count: 5,
		});
		expect(r1.args).toEqual(['born-in-staging']);

		// Simulate the surface rung minting an answered sidecar (the surface→answer
		// half of the loop; the rung body itself lives elsewhere and is unit-tested
		// separately — this task's contract is the candidate-set widening).
		seedSidecar('task', 'born-in-staging', /* answered */ true);

		// Second tick — APPLY (always-on consume): the answered sidecar moves the
		// staged item into the apply sub-pool. No manual promote happened.
		const r2 = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run: r2.run,
			config: cfg(),
			lifecycleGates: {
				triage: true,
				surface: true,
				surfaceStaging: true,
			},
			count: 5,
		});
		expect(r2.args).toEqual(['born-in-staging']);
	});

	it('apply rung commits the rewrite at the STAGING path (folder-agnostic, F3a) when the staged item still rests in tasks/backlog/', () => {
		// Real git working repo so apply can `git add`/`git commit`.
		const seeded = seedRepoWithArbiter(root, []);
		// Stage a needsAnswers task on the arbiter; the working repo has it too
		// (seedRepoWithArbiter set up the working clone before bare clone).
		const stagedDir = join(seeded.repo, 'work', 'tasks', 'backlog');
		mkdirSync(stagedDir, {recursive: true});
		writeFileSync(
			join(stagedDir, 'born-in-staging.md'),
			[
				'---',
				'slug: born-in-staging',
				'needsAnswers: true',
				'---',
				'',
				'## Problem',
				'',
				'A fresh task still in staging.',
				'',
			].join('\n'),
		);
		// Mint an ANSWERED sidecar in the working tree.
		const item = 'task:born-in-staging';
		const model = newSidecar(item, [{question: 'choose?'}]);
		model.entries[0].answer = 'go';
		const sidecarRel = sidecarPathFor(item);
		mkdirSync(join(seeded.repo, sidecarRel, '..'), {recursive: true});
		writeFileSync(join(seeded.repo, sidecarRel), serialiseSidecar(model));
		run('git', ['add', '-A'], seeded.repo, {env: gitEnv()});
		run('git', ['commit', '-q', '-m', 'stage + answer'], seeded.repo, {
			env: gitEnv(),
		});

		// Apply WITHOUT a prior promote — F3a's identity-keyed resolver finds the
		// item in `tasks-backlog`, and apply commits the rewrite at that path.
		const result = applyAnsweredQuestions({
			cwd: seeded.repo,
			item,
			itemPath: `work/tasks/backlog/born-in-staging.md`,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('resolved');
		// The item DID NOT move into the pool; only its body was rewritten in place.
		expect(result.itemPath).toBe('work/tasks/backlog/born-in-staging.md');
		expect(
			existsSync(join(seeded.repo, 'work/tasks/backlog/born-in-staging.md')),
		).toBe(true);
		expect(
			existsSync(join(seeded.repo, 'work/tasks/ready/born-in-staging.md')),
		).toBe(false);
		// Sidecar deleted on a clean resolve.
		expect(existsSync(join(seeded.repo, sidecarRel))).toBe(false);
	});
});

describe('(f) F3 precondition: a concurrent promote during apply does NOT split-brain', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('surface-staging-f3-precondition-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('a promote racing an apply-held advance lock on the same staged item LOSES CLEAN (the lock serialises them; F3b precondition)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const slug = 'race-during-apply';
		// Seed the staged task on the arbiter.
		const stagedDir = join(seeded.repo, 'work', 'tasks', 'backlog');
		mkdirSync(stagedDir, {recursive: true});
		writeFileSync(
			join(stagedDir, `${slug}.md`),
			`---\nslug: ${slug}\nneedsAnswers: true\n---\n\n# ${slug}\n`,
		);
		run('git', ['add', '-A'], seeded.repo, {env: gitEnv()});
		run('git', ['commit', '-q', '-m', `stage ${slug}`], seeded.repo, {
			env: gitEnv(),
		});
		run('git', ['push', '-q', 'arbiter', 'main'], seeded.repo, {
			env: gitEnv(),
		});

		// Apply holds the per-item advance lock first (mirrors an in-flight
		// answer-apply on the staged item).
		const applier = raceClone(seeded, 'apply');
		const held = await acquireItemLock({
			item: `task:${slug}`,
			action: 'advance',
			cwd: applier,
			arbiter: 'arbiter',
			env: racerEnv('apply'),
		});
		expect(held.outcome).toBe('acquired');

		// A concurrent promote contends on the SAME ref and LOSES CLEAN — no
		// `git mv` lands on `main`, the staged file is byte-for-byte unchanged,
		// and apply's lock is untouched (mirrors claim-cas loss semantics; if this
		// FAILS, the F3b blocker did not actually land what F2 needs).
		const promoter = raceClone(seeded, 'promote');
		const result = await promoteFromPreBacklog({
			slug,
			cwd: promoter,
			arbiter: 'arbiter',
			env: racerEnv('promote'),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(
			/per-item lock|already locked|implement\/task\/advance/i,
		);

		// No split-brain on `main`: the staged file is still in staging.
		run('git', ['fetch', '-q', 'arbiter'], seeded.repo, {env: gitEnv()});
		expect(
			run(
				'git',
				['cat-file', '-e', `arbiter/main:work/tasks/backlog/${slug}.md`],
				seeded.repo,
				{env: gitEnv()},
			).status,
		).toBe(0);
		expect(
			run(
				'git',
				['cat-file', '-e', `arbiter/main:work/tasks/ready/${slug}.md`],
				seeded.repo,
				{env: gitEnv()},
			).status,
		).not.toBe(0);

		await releaseItemLock({
			item: `task:${slug}`,
			cwd: applier,
			arbiter: 'arbiter',
			env: racerEnv('apply'),
		});
	});
});

// `DEFAULT_SELECTION_ORDER` is imported only to keep the test's `cfg()` close to
// the production shape (a Config without it would still merge from defaults, but
// this import documents that `surfaceStaging` is orthogonal to the selection order
// — the staging widening is an INPUT-set change, not an order change).
void DEFAULT_SELECTION_ORDER;
