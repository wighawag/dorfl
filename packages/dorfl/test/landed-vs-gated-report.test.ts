import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {git} from '../src/git.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {
	LANDED_WITHOUT_REGATE_TRAILER,
	landIntegration,
	landedWithoutRegateReport,
} from '../src/integration-core.js';
import {
	gitEnv,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * The landed-vs-gated report (ADR `ci-agent-job-holds-no-write-token` decision
 * 2, task `ci-split-landed-vs-gated-report`): the merge-mode CAS loop never
 * re-gates, so an apply-phase land (the only caller that sets `gatedTip`, the
 * bundle tip) whose tree differs from the gated tree says so in the run output
 * and in a trailer on the landed commit. A non-phase land (no `gatedTip`) is
 * unchanged. The races are forced by a sibling landing on the arbiter's `main`
 * right before each of the first `races` pushes.
 */

const SLUG = 'add-thing';
const BRANCH = `work/task-${SLUG}`;

let scratch: Scratch;
let seeded: SeededRepo;

function g(cwd: string, ...args: string[]): string {
	return git(args, cwd, {env: gitEnv()}).trim();
}

beforeEach(() => {
	scratch = makeScratch('dorfl-landed-vs-gated-');
	seeded = seedRepoWithArbiter(scratch.root, [SLUG]);
});

afterEach(() => {
	vi.restoreAllMocks();
	scratch.cleanup();
});

/** Land a sibling commit on the arbiter's main (an empty one keeps the tree). */
function siblingLands(n: number, empty: boolean): void {
	const sibling = seeded.clone(`sibling-${n}`);
	if (empty) {
		g(sibling, 'commit', '-q', '--allow-empty', '-m', `sibling ${n}`);
	} else {
		writeFileSync(join(sibling, `SIBLING-${n}.md`), `sibling ${n}\n`);
		g(sibling, 'add', '-A');
		g(sibling, 'commit', '-q', '-m', `sibling ${n}`);
	}
	g(sibling, 'push', '-q', 'origin', 'HEAD:main');
}

async function land(opts: {
	races: number;
	emptySiblings?: boolean;
	mode?: 'merge' | 'propose';
	/** Pass the gated tip like the apply phase does (default true). */
	applyPhase?: boolean;
}) {
	const cwd = seeded.clone('job');
	g(cwd, 'switch', '-q', '-c', BRANCH, 'origin/main');
	writeFileSync(join(cwd, 'thing.ts'), 'export const thing = 1;\n');
	g(cwd, 'add', '-A');
	g(
		cwd,
		'commit',
		'-q',
		'-m',
		'build: add thing',
		'-m',
		'Co-authored-by: x <x@y>',
	);
	const gatedTree = g(cwd, 'rev-parse', `${BRANCH}^{tree}`);
	const gatedTip = g(cwd, 'rev-parse', BRANCH);

	const original = ledgerWrite.applyCompleteTransition.bind(ledgerWrite);
	let calls = 0;
	vi.spyOn(ledgerWrite, 'applyCompleteTransition').mockImplementation(
		(input) => {
			calls++;
			if (calls <= opts.races) siblingLands(calls, opts.emptySiblings ?? false);
			return original(input);
		},
	);
	const notes: string[] = [];
	const result = await landIntegration({
		cwd,
		arbiter: 'origin',
		slug: SLUG,
		branch: BRANCH,
		lifecycle: true,
		source: 'tasks-ready',
		commitMessage: 'build: add thing',
		env: gitEnv(),
		note: (m) => notes.push(m),
		mode: opts.mode ?? 'merge',
		title: 'Add thing',
		mergeJitterMs: 0,
		...(opts.applyPhase === false ? {} : {gatedTip}),
	});
	return {cwd, result, notes, calls, gatedTree};
}

function trailers(rev: string): string[] {
	return g(
		seeded.arbiter,
		'log',
		'-1',
		`--format=%(trailers:key=${LANDED_WITHOUT_REGATE_TRAILER},valueonly)`,
		rev,
	)
		.split('\n')
		.filter((l) => l !== '');
}

describe('the landed-vs-gated report on the merge-mode land', () => {
	it('a land that won its first push carries neither the trailer nor the line', async () => {
		const run = await land({races: 0});
		expect(run.result.outcome).toBe('completed');
		expect(run.calls).toBe(1);
		expect(trailers('main')).toEqual([]);
		expect(run.notes.join('\n')).not.toContain('landed without re-gate');
		expect(g(seeded.arbiter, 'rev-parse', 'main^{tree}')).toBe(run.gatedTree);
	}, 60_000);

	it('one lost race: the landed commit carries the trailer and the run output the line', async () => {
		const run = await land({races: 1});
		expect(run.result.outcome).toBe('completed');
		expect(run.result.integration?.mergedToMain).toBe(true);
		expect(run.calls).toBe(2);
		expect(g(seeded.arbiter, 'rev-parse', 'main^{tree}')).not.toBe(
			run.gatedTree,
		);
		expect(trailers('main')).toEqual([landedWithoutRegateReport(1)]);
		expect(landedWithoutRegateReport(1)).toBe(
			'landed without re-gate after 1 lost race',
		);
		expect(run.notes).toContain(
			`${BRANCH} landed without re-gate after 1 lost race.`,
		);
		// Only the message changed: the author, the other trailer and the subject stay.
		const body = g(seeded.arbiter, 'log', '-1', '--format=%s%n%an%n%B', 'main');
		expect(body.split('\n')[0]).toBe('build: add thing');
		expect(body).toContain('Co-authored-by: x <x@y>');
	}, 60_000);

	it('two lost races: the one trailer carries the final count', async () => {
		const run = await land({races: 2});
		expect(run.result.outcome).toBe('completed');
		expect(run.calls).toBe(3);
		expect(trailers('main')).toEqual([
			'landed without re-gate after 2 lost races',
		]);
		expect(run.notes).toContain(
			`${BRANCH} landed without re-gate after 2 lost races.`,
		);
	}, 60_000);

	it('a lost race whose re-rebase keeps the gated tree reports nothing', async () => {
		const run = await land({races: 1, emptySiblings: true});
		expect(run.result.outcome).toBe('completed');
		expect(run.calls).toBe(2);
		expect(g(seeded.arbiter, 'rev-parse', 'main^{tree}')).toBe(run.gatedTree);
		expect(trailers('main')).toEqual([]);
		expect(run.notes.join('\n')).not.toContain('landed without re-gate');
	}, 60_000);

	it('a non-phase land (no gated tip) that lost a race to a differing tree carries neither', async () => {
		const run = await land({races: 1, applyPhase: false});
		expect(run.result.outcome).toBe('completed');
		expect(run.result.integration?.mergedToMain).toBe(true);
		expect(run.calls).toBe(2);
		expect(g(seeded.arbiter, 'rev-parse', 'main^{tree}')).not.toBe(
			run.gatedTree,
		);
		expect(trailers('main')).toEqual([]);
		expect(run.notes.join('\n')).not.toContain('landed without re-gate');
		// The landed commit is the plain re-rebase: the message is untouched.
		expect(g(seeded.arbiter, 'log', '-1', '--format=%B', 'main')).toBe(
			'build: add thing\n\nCo-authored-by: x <x@y>',
		);
	}, 60_000);

	it('propose mode is unaffected: no trailer, no line', async () => {
		const run = await land({races: 1, mode: 'propose'});
		expect(run.result.outcome).toBe('completed');
		expect(run.calls).toBe(1);
		expect(trailers(`refs/heads/${BRANCH}`)).toEqual([]);
		expect(run.notes.join('\n')).not.toContain('landed without re-gate');
	}, 60_000);
});
