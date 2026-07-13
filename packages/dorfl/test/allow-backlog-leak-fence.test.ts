import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {runOnce, type Dorfl} from '../src/run.js';
import {performClaim} from '../src/claim-cas.js';
import {listItemLocks} from '../src/item-lock.js';
import {
	performDoAuto,
	performDoArgs,
	type DoRunner,
} from '../src/do-autopick.js';
import {type DoOptions, type DoResult} from '../src/do.js';
import {loadAdvanceCiTemplate} from '../src/advance-ci-template.js';
import {mergeConfig, type Config} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	type Scratch,
	rmrf,
} from './helpers/gitRepo.js';

/**
 * Leak-fence assertions: `--allow-backlog` is EXPLICIT-INVOCATION-ONLY (prd
 * `do-allow-backlog-drive-staged-tasks-without-promotion`, US #4 + Resolved
 * decision 3: the fence is STRUCTURAL, not merely disciplinary).
 *
 * The keystone task gave a human a `do task:<slug> --allow-backlog` that widens
 * RESOLUTION + the claimable predicate to a `tasks/backlog/`-resident (STAGED)
 * body. The danger is recreating the competition bug one layer down: an
 * AUTONOMOUS claimer (the `run` daemon, `do`'s auto-pick / `-n` / multi-arg
 * selection, or a CI `advance` matrix leg) honouring the flag would race the
 * human who staged the task precisely so it would NOT be claimable-by-anyone.
 *
 * This file is the GUARD: it proves none of those three autonomous surfaces can
 * SET or HONOUR the flag. It adds COVERAGE, not new runtime behaviour; the
 * fence is already structural (`run` calls `performIntegration` with a hardcoded
 * `source: 'tasks-ready'` and `performClaim` without `allowBacklog`; auto-pick
 * builds the per-item `DoOptions` from the pool and never sets `allowBacklog`;
 * the CI template invokes `advance`, which has no such flag). These tests pin
 * that fence so a later refactor cannot silently open it.
 *
 * House style: the `run` proofs mirror `run.test.ts` (a throwaway working
 * checkout + a local `--bare` arbiter + a stubbed agent); the auto-pick proofs
 * mirror `do-autopick.test.ts` (a seeded `work/` tree + a RECORDING stub `do`
 * runner that captures the options each per-item run was handed); the CI proof
 * mirrors `advance-ci-template.test.ts` (assertions over the template text).
 */

// ───────────────────────────────────────────────────────────────────────────
// Fence 1: the `run` daemon's claim/integration path is POOL-ONLY.
// ───────────────────────────────────────────────────────────────────────────

describe('leak-fence: `run` daemon claim path is pool-only (tasks-ready), the flag is structurally unreachable', () => {
	let scratch: Scratch;
	let restorePiAgentDir: () => void;
	beforeEach(() => {
		scratch = makeScratch('dorfl-allow-backlog-fence-run-');
		restorePiAgentDir = isolatePiAgentDir(scratch.root);
	});
	afterEach(() => {
		restorePiAgentDir();
		scratch.cleanup();
	});

	const PASS = 'exit 0';
	/** A stubbed agent that edits a file (non-empty commit) and succeeds. */
	const editingAgent: Dorfl = ({cwd, slug}) => {
		writeFileSync(join(cwd, 'agent-output.txt'), `work done for ${slug}\n`);
		return {ok: true};
	};

	function configFor(overrides: Partial<Config> = {}): Config {
		return mergeConfig({
			defaultArbiter: 'arbiter',
			maxParallel: 4,
			perRepoMax: 2,
			integration: 'merge',
			agentCmd: 'true',
			verify: PASS,
			autoBuild: true,
			...overrides,
		});
	}

	function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
		return scanRepoPaths([join(scratch.root, 'project')], config);
	}

	it('a STAGED-only task (tasks/backlog/) is never even DISCOVERED by `run`s pool scan', () => {
		// `run` claims + builds from the working-tree scan, which reads ONLY the
		// agent pool `work/tasks/ready/*` (scan.ts), so a staged body in
		// `tasks/backlog/` is invisible to it. The flag cannot make `run` scan
		// staging because `run` never parses `do`s CLI flags at all.
		seedRepoWithArbiter(scratch.root, [], {staged: ['staged-only']});
		const report = scanProject(configFor());
		const allSlugs = report.repos.flatMap((r) =>
			r.items.map((item) => item.slug),
		);
		expect(allSlugs).not.toContain('staged-only');
	});

	it('runs to completion finding NOTHING to claim when the only task is staged (no autonomous staged-claim)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {
			staged: ['staged-only'],
		});
		const config = configFor();
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			dorfl: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		// Nothing eligible ⇒ nothing claimed/done; the staged body is untouched and
		// stays in tasks/backlog/ (it was never claimed, moved, or built).
		expect(result.claimedAndDone).toBe(0);
		expect(result.items).toEqual([]);
		expect(existsOnArbiterMain(repo, 'pre-backlog', 'staged-only')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'staged-only')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'staged-only')).toBe(false);
		// And no lock was taken: `run` never tried to claim a staged body.
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);
	});

	it('`run`s claim is pool-only: a direct performClaim WITHOUT the flag refuses a staged body (the exact call `run` makes)', async () => {
		// `run` calls `performClaim({slug, cwd, arbiter, env})` (run.ts ~L113/L145):
		// it NEVER passes `allowBacklog`. This is the call `run` makes verbatim:
		// it defaults off, so the claimable predicate keys on the pool folder and a
		// staged-only body is `lost` (exit 2). Proves the flag cannot be threaded in
		// from `run`s call shape.
		const {repo} = seedRepoWithArbiter(scratch.root, [], {
			staged: ['staged-only'],
		});
		const claim = await performClaim({
			slug: 'staged-only',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(2);
		expect(claim.outcome).toBe('lost');
		// No lock left behind; the body never moved.
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);
		expect(existsOnArbiterMain(repo, 'pre-backlog', 'staged-only')).toBe(true);
	});

	it('omitting `allowBacklog` (the shape `run` passes) is equivalent to the flag being off (claim refuses a staged body)', async () => {
		// The keystone ADDED `allowBacklog` to `performClaim`s options for the
		// EXPLICIT human path, so the option EXISTS; the fence is therefore
		// BEHAVIOURAL: `run`s call site omits it, and an omitted flag must behave
		// EXACTLY like `false` (pool-only). Pin that the omitted shape and the
		// explicit-`false` shape produce the SAME refusal of a staged body.
		const {repo: omitted} = seedRepoWithArbiter(scratch.root, [], {
			staged: ['staged-only'],
		});
		const {repo: explicitOff} = seedRepoWithArbiter(
			join(scratch.root, 'b'),
			[],
			{staged: ['staged-only']},
		);
		const claimOmitted = await performClaim({
			slug: 'staged-only',
			cwd: omitted,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const claimExplicitOff = await performClaim({
			slug: 'staged-only',
			cwd: explicitOff,
			arbiter: 'arbiter',
			allowBacklog: false,
			env: gitEnv(),
		});
		expect(claimOmitted.outcome).toBe('lost');
		expect(claimExplicitOff.outcome).toBe('lost');
		expect(claimOmitted.exitCode).toBe(claimExplicitOff.exitCode);
	});
});

// ───────────────────────────────────────────────────────────────────────────
// Fence 2: `do`s auto-pick / `-n` / multi-arg selection never SETS the flag.
// ───────────────────────────────────────────────────────────────────────────

describe('leak-fence: `do` auto-pick / -n / multi-arg never sets --allow-backlog (defaults off)', () => {
	let root: string;
	let repo: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'dorfl-allow-backlog-fence-autopick-'));
		repo = join(root, 'project');
		mkdirSync(repo, {recursive: true});
	});
	afterEach(() => {
		rmrf(root);
	});

	/** Seed a `work/tasks/ready/<slug>.md` pool task. */
	function seedTask(slug: string): void {
		const dir = join(repo, 'work', 'tasks', 'ready');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${slug}.md`),
			['---', `slug: ${slug}`, 'blockedBy: []', '---', '', 'x'].join('\n'),
		);
	}

	/** Seed a STAGED `work/tasks/backlog/<slug>.md` (the body the flag would target). */
	function seedStaged(slug: string): void {
		const dir = join(repo, 'work', 'tasks', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${slug}.md`),
			['---', `slug: ${slug}`, 'blockedBy: []', '---', '', 'x'].join('\n'),
		);
	}

	function cfg(over: Partial<Config> = {}): Config {
		return mergeConfig({autoBuild: true, autoTask: true, ...over});
	}

	/**
	 * A recording stub `do` runner: captures the `allowBacklog` each per-item run
	 * was handed (alongside the `arg`), always succeeds. The whole point of the
	 * fence is WHAT the selection layer threads to `performDo`, so we record it.
	 */
	function recordingRunner(): {
		run: DoRunner;
		seen: Array<{arg: string; allowBacklog: boolean | undefined}>;
	} {
		const seen: Array<{arg: string; allowBacklog: boolean | undefined}> = [];
		const run: DoRunner = async (options: DoOptions) => {
			seen.push({arg: options.arg, allowBacklog: options.allowBacklog});
			return {
				exitCode: 0,
				outcome: 'completed',
				slug: options.arg,
				message: `did ${options.arg}`,
			} satisfies DoResult;
		};
		return {run, seen};
	}

	function base(run: DoRunner) {
		return {cwd: repo, run} satisfies Partial<DoOptions> & {run: DoRunner};
	}

	it('auto-pick (no arg) threads allowBacklog=undefined to the selected item (never sets it)', async () => {
		seedTask('alpha');
		const {run, seen} = recordingRunner();
		const result = await performDoAuto({...base(run), config: cfg()});
		expect(result.exitCode).toBe(0);
		expect(seen.map((s) => s.arg)).toEqual(['alpha']);
		// The selection layer never injects the flag, so each per-item run defaults off.
		expect(seen.every((s) => s.allowBacklog !== true)).toBe(true);
	});

	it('`-n` multi-select threads allowBacklog off for EVERY selected item', async () => {
		seedTask('alpha');
		seedTask('beta');
		const {run, seen} = recordingRunner();
		await performDoAuto({...base(run), config: cfg(), count: 2});
		expect(seen.map((s) => s.arg)).toEqual(['alpha', 'beta']);
		expect(seen.every((s) => s.allowBacklog !== true)).toBe(true);
	});

	it('explicit multi-arg threads allowBacklog off for EVERY named item', async () => {
		const {run, seen} = recordingRunner();
		await performDoArgs(['alpha', 'beta'], {...base(run), config: cfg()});
		expect(seen.map((s) => s.arg)).toEqual(['alpha', 'beta']);
		expect(seen.every((s) => s.allowBacklog !== true)).toBe(true);
	});

	it('a STAGED body is NOT in the auto-pick pool (it picks from tasks/ready/ only)', async () => {
		// The pool scan reads only `work/tasks/ready/*`, so a staged body is not a
		// candidate at all, so auto-pick can never even NAME a staged slug, let
		// alone widen its resolution. (The CONTROL: a pool task IS picked.)
		seedStaged('staged-only');
		const {run, seen} = recordingRunner();
		const result = await performDoAuto({...base(run), config: cfg()});
		expect(result.exitCode).toBe(0);
		expect(seen.map((s) => s.arg)).not.toContain('staged-only');
		// nothing eligible ⇒ nothing ran.
		expect(seen).toEqual([]);
	});

	it('a `do` runner that DID honour the flag would still receive off from auto-pick (the selection layer is the fence)', async () => {
		// Defence in depth: even if a future `performDo` mis-read `allowBacklog`,
		// the SELECTION layer never sets it, so a pool selection stays pool-only.
		// We assert the threaded value is strictly not-true for the picked item.
		seedTask('alpha');
		const {run, seen} = recordingRunner();
		await performDoAuto({...base(run), config: cfg(), count: 1});
		const picked = seen.find((s) => s.arg === 'alpha');
		expect(picked).toBeDefined();
		expect(picked?.allowBacklog).not.toBe(true);
	});
});

// ───────────────────────────────────────────────────────────────────────────
// Fence 3: the autonomous CI `advance` surface never passes the flag.
// ───────────────────────────────────────────────────────────────────────────

describe('leak-fence: the CI `advance` matrix surface never passes --allow-backlog', () => {
	it('the shipped advance-loop CI template contains no --allow-backlog anywhere', () => {
		// CI `advance` legs are AUTONOMOUS claimers, so they must select from the pool
		// only. The template invokes `dorfl advance` (propose matrix + merge -n);
		// neither leg carries the flag (`advance` has no such option to begin with).
		const text = loadAdvanceCiTemplate();
		expect(text).not.toContain('--allow-backlog');
		expect(text).not.toContain('allow-backlog');
		expect(text).not.toContain('allowBacklog');
	});

	it('every `dorfl advance` invocation in the template is flag-free of --allow-backlog', () => {
		// Pin it per-invocation too (not just absence anywhere): each `dorfl advance`
		// command line is free of the flag. Documents the autonomous surface intent.
		const text = loadAdvanceCiTemplate();
		const advanceLines = text
			.split('\n')
			.filter((line) => line.includes('dorfl advance'));
		// The template DOES invoke advance (guards against a vacuous pass if the
		// template is ever restructured away from `dorfl advance`).
		expect(advanceLines.length).toBeGreaterThan(0);
		for (const line of advanceLines) {
			expect(line).not.toContain('allow-backlog');
		}
	});
});
