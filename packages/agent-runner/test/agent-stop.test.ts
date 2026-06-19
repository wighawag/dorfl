import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {
	parseStopSentinel,
	extractDecisionsBlock,
	emptyDiffStopReason,
	isWorkBranchDiffEmpty,
	STOP_SENTINEL_OPEN,
	STOP_SENTINEL_CLOSE,
} from '../src/agent-stop.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';

/**
 * `agent-stop-signal` — the build-agent → runner reporting channel PARSERS (pure
 * logic, no git). The runner-wiring (sentinel STOP routes to needs-attention
 * before the gate; the empty-diff backstop; the success/agent-failed paths
 * unchanged) lives in `do.test.ts` / `run.test.ts` (real git). Here we pin the
 * two output-channel readers + the backstop reason, plus the empty-diff
 * PREDICATE itself (branch-commit-aware) on throwaway git repos.
 */

describe('parseStopSentinel — the HARD STOP verdict on agent.output', () => {
	it('reads the reason VERBATIM from inside a complete sentinel block', () => {
		const output = [
			'I checked the slice against current src/.',
			STOP_SENTINEL_OPEN,
			'The slice rests on three premises that are now false:',
			'1. the convergence it asks for already landed in run-daemon-reframe.',
			'Re-scope before re-claiming.',
			STOP_SENTINEL_CLOSE,
			'Done — stopping as instructed.',
		].join('\n');
		const stop = parseStopSentinel(output);
		expect(stop).toBeDefined();
		expect(stop?.reason).toBe(
			[
				'The slice rests on three premises that are now false:',
				'1. the convergence it asks for already landed in run-daemon-reframe.',
				'Re-scope before re-claiming.',
			].join('\n'),
		);
	});

	it('tolerates leading/trailing whitespace on the marker lines', () => {
		const output = [
			'  ' + STOP_SENTINEL_OPEN + '  ',
			'drifted: premise X is false',
			'\t' + STOP_SENTINEL_CLOSE,
		].join('\n');
		expect(parseStopSentinel(output)?.reason).toBe(
			'drifted: premise X is false',
		);
	});

	it('returns undefined for a normal build (no markers)', () => {
		expect(
			parseStopSentinel('Implemented the feature; tests green.'),
		).toBeUndefined();
		expect(parseStopSentinel('')).toBeUndefined();
		expect(parseStopSentinel(undefined)).toBeUndefined();
	});

	it('does NOT trip on the marker mentioned mid-prose (must be its own line)', () => {
		const output = `The protocol marker is ${STOP_SENTINEL_OPEN} but I am not stopping.`;
		expect(parseStopSentinel(output)).toBeUndefined();
	});

	it('an unterminated open marker is not a complete sentinel', () => {
		const output = [STOP_SENTINEL_OPEN, 'reason but no close'].join('\n');
		expect(parseStopSentinel(output)).toBeUndefined();
	});

	it('an empty-bodied sentinel still yields a stable default reason (honest routing)', () => {
		const output = [STOP_SENTINEL_OPEN, '', STOP_SENTINEL_CLOSE].join('\n');
		const stop = parseStopSentinel(output);
		expect(stop).toBeDefined();
		expect(stop?.reason).toMatch(/no reason/i);
	});
});

describe('extractDecisionsBlock — the SOFT decisions log on agent.output', () => {
	it('extracts the prose under a ## Decisions heading', () => {
		const output = [
			'Implemented the slice.',
			'',
			'## Decisions',
			'',
			'- Chose to ERROR on -n × --remote (touches the do command); ',
			'  alternative: silently auto-pick. Reversible.',
			'',
			'## Other',
			'',
			'unrelated',
		].join('\n');
		const block = extractDecisionsBlock(output);
		expect(block).toBeDefined();
		expect(block).toMatch(/ERROR on -n × --remote/);
		expect(block).toMatch(/alternative: silently auto-pick/);
		// Stops at the next ## heading.
		expect(block).not.toMatch(/unrelated/);
	});

	it('returns undefined when no decisions block was reported', () => {
		expect(extractDecisionsBlock('just a normal summary')).toBeUndefined();
		expect(extractDecisionsBlock('')).toBeUndefined();
		expect(extractDecisionsBlock(undefined)).toBeUndefined();
	});

	it('returns undefined for an empty decisions block', () => {
		expect(extractDecisionsBlock('## Decisions\n\n')).toBeUndefined();
	});
});

describe('emptyDiffStopReason — the deterministic backstop reason', () => {
	it('names the slug + the no-op/stop framing', () => {
		const reason = emptyDiffStopReason('my-slice');
		expect(reason).toMatch(/my-slice/);
		expect(reason).toMatch(/no source change|empty diff/i);
		expect(reason).toMatch(/re-scope or re-claim/i);
	});
});

/**
 * `isWorkBranchDiffEmpty` — the DETERMINISTIC empty-diff predicate, now
 * branch-commit-aware (slice `noop-backstop-counts-branch-commits`). It is empty
 * IFF the working tree carries no source change (the FRESH-build signal) AND the
 * branch has no source COMMIT ahead of `<arbiter>/main` (so a `requeue`
 * continue-from-tip, whose prior work is already committed + green with a clean
 * tree, is NOT mis-read as a no-op). House style: throwaway repos + a `--bare`
 * arbiter, `GIT_CONFIG_GLOBAL` isolation.
 */
describe('isWorkBranchDiffEmpty — the branch-commit-aware empty-diff predicate', () => {
	let scratch: Scratch;
	const ENV = gitEnv();

	beforeEach(() => {
		scratch = makeScratch('agent-runner-empty-diff-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/**
	 * Build a throwaway repo on a `work/<slug>` branch cut from a `--bare` arbiter
	 * main, with only the CLAIM commit (which touches `work/` only) ahead of main.
	 * Returns the checkout dir; the caller layers on source commits / tree edits.
	 */
	function seedClaimedBranch(slug: string): string {
		const repo = join(scratch.root, 'project');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		writeFileSync(join(repo, 'README.md'), '# project\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed'], repo);
		const arbiter = join(scratch.root, 'project-work.git');
		gitIn(['clone', '-q', '--bare', repo, arbiter], scratch.root);
		gitIn(['remote', 'add', 'arbiter', `file://${arbiter}`], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Cut the work branch off the arbiter main + add the claim commit (work/ only).
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, 'arbiter/main'], repo);
		const ip = join(repo, 'work', 'in-progress');
		mkdirSync(ip, {recursive: true});
		writeFileSync(join(ip, `${slug}.md`), `claim: ${slug}\n`);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', `claim ${slug}`], repo);
		return repo;
	}

	it('TRUE (no-op) for a claim-commit-only branch with a clean working tree', async () => {
		const repo = seedClaimedBranch('alpha');
		expect(
			await isWorkBranchDiffEmpty({cwd: repo, arbiter: 'arbiter', env: ENV}),
		).toBe(true);
	});

	it('FALSE for a continue-from-tip: a prior SOURCE commit ahead of main, clean tree', async () => {
		const repo = seedClaimedBranch('alpha');
		// Prior attempt's COMMITTED source work (a non-work/ path), clean working tree.
		writeFileSync(join(repo, 'feature.ts'), 'export const x = 1;\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior source work'], repo);
		expect(gitIn(['status', '--porcelain'], repo).trim()).toBe('');
		expect(
			await isWorkBranchDiffEmpty({cwd: repo, arbiter: 'arbiter', env: ENV}),
		).toBe(false);
	});

	it('FALSE for a fresh build with a working-tree source change (unchanged signal)', async () => {
		const repo = seedClaimedBranch('alpha');
		writeFileSync(join(repo, 'new-source.ts'), 'export const y = 2;\n');
		expect(
			await isWorkBranchDiffEmpty({cwd: repo, arbiter: 'arbiter', env: ENV}),
		).toBe(false);
	});

	it('TRUE when the only commits ahead touch the `work/` ledger only', async () => {
		const repo = seedClaimedBranch('alpha');
		// A SECOND work/-only commit (still no source) must not read as a build.
		writeFileSync(join(repo, 'work', 'in-progress', 'alpha.md'), 'claim v2\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'work/ ledger touch'], repo);
		expect(
			await isWorkBranchDiffEmpty({cwd: repo, arbiter: 'arbiter', env: ENV}),
		).toBe(true);
	});

	it('TRUE when the only commit ahead touches the job-record only (excluded)', async () => {
		const repo = seedClaimedBranch('alpha');
		// The runner's own `.agent-runner-job.json` record is filtered out of the
		// commit-range check, exactly as the working-tree check filters it.
		writeFileSync(join(repo, '.agent-runner-job.json'), '{}\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'job record'], repo);
		expect(
			await isWorkBranchDiffEmpty({cwd: repo, arbiter: 'arbiter', env: ENV}),
		).toBe(true);
	});

	it('FALSE (safe direction) when the arbiter ref cannot be resolved/fetched', async () => {
		const repo = seedClaimedBranch('alpha');
		// A clean tree + claim-only branch would normally be TRUE, but an arbiter that
		// cannot be fetched makes the commit-range check fail → NON-empty (never
		// short-circuit a genuine build on an unknown).
		expect(
			await isWorkBranchDiffEmpty({cwd: repo, arbiter: 'nope', env: ENV}),
		).toBe(false);
	});
});
