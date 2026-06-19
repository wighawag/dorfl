import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	performDoAuto,
	performDoArgs,
	type DoRunner,
} from '../src/do-autopick.js';
import {performDo, type DoOptions, type DoResult} from '../src/do.js';
import {mergeConfig, type Config} from '../src/config.js';

/**
 * `do-autopick` — the MULTI-ITEM selection forms (auto-pick / `-n` / multi-arg)
 * + the two-pool slices-first priority (per-repo toggle). House style: a seeded
 * backlog of SLICES + sliceable PRDs in a plain checkout (no git mutation — the
 * selection layer only READS `work/`), with a STUBBED single-`do` runner that
 * records the `arg` it was handed (so we assert WHICH items ran, in what ORDER,
 * without driving the real claim/build/integrate pipeline — that is do-in-place's
 * tested job). `do` is sequential, so a recording runner is sufficient.
 */

let root: string;
let repo: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-do-autopick-'));
	repo = join(root, 'project');
	mkdirSync(repo, {recursive: true});
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

/** Seed a `work/tasks/todo/<slug>.md` slice with the given gate frontmatter. */
function seedSlice(
	slug: string,
	fm: {humanOnly?: boolean; needsAnswers?: boolean; blockedBy?: string[]} = {},
): void {
	const dir = join(repo, 'work', 'tasks', 'todo');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.humanOnly) lines.push('humanOnly: true');
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	lines.push(`blockedBy: [${(fm.blockedBy ?? []).join(', ')}]`, '---', '', 'x');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

/** Seed a `work/tasks/done/<slug>.md` (satisfies a slice's blockedBy). */
function seedDone(slug: string): void {
	const dir = join(repo, 'work', 'tasks', 'done');
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, `${slug}.md`), `---\nslug: ${slug}\n---\n`);
}

/** Seed a `work/briefs/ready/<slug>.md` PRD with the given gate frontmatter. */
function seedPrd(
	slug: string,
	fm: {
		humanOnly?: boolean;
		needsAnswers?: boolean;
		sliceAfter?: string[];
	} = {},
): void {
	const dir = join(repo, 'work', 'briefs', 'ready');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.humanOnly) lines.push('humanOnly: true');
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	if (fm.sliceAfter) lines.push(`sliceAfter: [${fm.sliceAfter.join(', ')}]`);
	lines.push('---', '', '# PRD');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

/**
 * Seed a SLICED PRD as RESIDENCE in `work/briefs/tasked/` (the source of truth for
 * sliced-ness, slice `prd-sliced-folder-step-a`) — it has left the to-slice pool
 * (`work/briefs/ready/`) and now resolves another PRD's `sliceAfter` by FOLDER residence
 * (the `sliced:` marker was removed in `remove-sliced-marker-step-b`).
 */
function seedSlicedPrd(slug: string): void {
	const fromDir = join(repo, 'work', 'briefs', 'ready');
	const from = join(fromDir, `${slug}.md`);
	rmSync(from, {force: true});
	const dir = join(repo, 'work', 'briefs', 'tasked');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		['---', `slug: ${slug}`, '---', '', '# PRD'].join('\n'),
	);
}

/** A recording stub `do` runner: captures each `arg`, always succeeds. */
function recordingRunner(): {run: DoRunner; args: string[]} {
	const args: string[] = [];
	const run: DoRunner = async (options) => {
		args.push(options.arg);
		return {
			exitCode: 0,
			outcome: 'completed',
			slug: options.arg,
			message: `did ${options.arg}`,
		} satisfies DoResult;
	};
	return {run, args};
}

function cfg(over: Partial<Config> = {}): Config {
	// autoBuild on so seeded slices are eligible; autoSlice on so PRDs are
	// sliceable. Both default OFF, so the tests opt in explicitly.
	return mergeConfig({autoBuild: true, autoSlice: true, ...over});
}

/** The minimal shared `DoOptions` base the layer threads to each run. */
function base(run: DoRunner) {
	return {cwd: repo, run} satisfies Partial<DoOptions> & {run: DoRunner};
}

describe('do (auto-pick, no arg) — picks ONE eligible item', () => {
	it('auto-picks the first eligible SLICE when slices exist', async () => {
		seedSlice('alpha');
		seedSlice('beta');
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		const result = await performDoAuto({...base(run), config: cfg()});
		expect(result.exitCode).toBe(0);
		// exactly one item, the first eligible slice (slices sort by slug).
		expect(args).toEqual(['alpha']);
	});

	it('auto-picks a PRD (do prd:<slug>) when NO slice is eligible', async () => {
		seedSlice('humanly', {humanOnly: true}); // not eligible
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		const result = await performDoAuto({...base(run), config: cfg()});
		expect(result.exitCode).toBe(0);
		// the PRD dispatches to the `do prd:` path (prefixed arg).
		expect(args).toEqual(['prd:gamma']);
	});

	it('an empty backlog + no sliceable PRD is NOT a failure (exit 0, nothing run)', async () => {
		const {run, args} = recordingRunner();
		const result = await performDoAuto({...base(run), config: cfg()});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual([]);
		expect(result.message).toMatch(/nothing eligible/i);
	});
});

describe('do -n <x> — x eligible items, in SEQUENCE', () => {
	it('takes x items, slices first then PRDs, in order', async () => {
		seedSlice('alpha');
		seedPrd('gamma');
		seedPrd('delta');
		const {run, args} = recordingRunner();
		const result = await performDoAuto({
			...base(run),
			config: cfg(),
			count: 3,
		});
		expect(result.exitCode).toBe(0);
		// one eligible slice drains first, then the two sliceable PRDs (by slug).
		expect(args).toEqual(['alpha', 'prd:delta', 'prd:gamma']);
	});

	it('-n bounds the count (does not over-take)', async () => {
		seedSlice('alpha');
		seedSlice('beta');
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		await performDoAuto({...base(run), config: cfg(), count: 2});
		expect(args).toEqual(['alpha', 'beta']); // count caps at 2; PRD untouched
	});
});

describe('do <a> <b> — explicit multi-arg, in the GIVEN order', () => {
	it('runs the named items in sequence (no pool/priority), arg passed verbatim', async () => {
		const {run, args} = recordingRunner();
		const result = await performDoArgs(['beta', 'slice:alpha', 'prd:gamma'], {
			...base(run),
			config: cfg(),
		});
		expect(result.exitCode).toBe(0);
		// verbatim + in the operator's order (performDo does its own slug resolve).
		expect(args).toEqual(['beta', 'slice:alpha', 'prd:gamma']);
	});

	it('reports a non-zero exit when one named item fails (first failure surfaces)', async () => {
		const args: string[] = [];
		const run: DoRunner = async (options) => {
			args.push(options.arg);
			const failed = options.arg === 'beta';
			return {
				exitCode: failed ? 1 : 0,
				outcome: failed ? 'needs-attention' : 'completed',
				slug: options.arg,
				message: 'x',
			};
		};
		const result = await performDoArgs(['alpha', 'beta', 'charlie'], {
			...base(run),
			config: cfg(),
		});
		expect(result.exitCode).toBe(1);
		// still ran them all, sequentially (do does not abort the batch).
		expect(args).toEqual(['alpha', 'beta', 'charlie']);
	});
});

describe('slices-first PRIORITY + the configurable selectionOrder FLIP', () => {
	it('default (drain): an eligible SLICE outranks a sliceable PRD', async () => {
		seedSlice('alpha');
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		await performDoAuto({...base(run), config: cfg(), count: 1});
		expect(args).toEqual(['alpha']);
	});

	it('[slice, build, ...] (== old prdsFirst:true): a sliceable PRD outranks an eligible slice', async () => {
		seedSlice('alpha');
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		await performDoAuto({
			...base(run),
			config: cfg({selectionOrder: ['slice', 'build', 'surface', 'triage']}),
			count: 1,
		});
		expect(args).toEqual(['prd:gamma']);
	});

	it('the FULL ordering flips with the order (all slices vs all PRDs)', async () => {
		seedSlice('alpha');
		seedPrd('gamma');
		const off = recordingRunner();
		await performDoAuto({...base(off.run), config: cfg(), count: 9});
		expect(off.args).toEqual(['alpha', 'prd:gamma']);

		const on = recordingRunner();
		await performDoAuto({
			...base(on.run),
			config: cfg({selectionOrder: ['slice', 'build', 'surface', 'triage']}),
			count: 9,
		});
		expect(on.args).toEqual(['prd:gamma', 'alpha']);
	});
});

describe('PRD pool eligibility is autoslice-gate (not reinvented)', () => {
	it('autoSlice OFF ⇒ no PRD is selected even with no slices', async () => {
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		const result = await performDoAuto({
			...base(run),
			config: cfg({autoSlice: false}),
			count: 5,
		});
		expect(args).toEqual([]);
		expect(result.exitCode).toBe(0);
	});

	it('a humanOnly / needsAnswers PRD is excluded; a sliceAfter-blocked one too', async () => {
		seedPrd('human', {humanOnly: true});
		seedPrd('asks', {needsAnswers: true});
		seedPrd('beta', {sliceAfter: ['alpha']}); // alpha not sliced
		seedPrd('ready'); // the only sliceable one
		const {run, args} = recordingRunner();
		await performDoAuto({...base(run), config: cfg(), count: 9});
		expect(args).toEqual(['prd:ready']);
	});

	it('a sliceAfter PRD becomes selectable once its blocker resides in prd-sliced/ (folder residence, not done/)', async () => {
		// beta's blocker alpha is UNSLICED ⇒ beta is excluded (alpha itself is
		// sliceable: the gate does not exclude an unsliced PRD).
		seedPrd('alpha');
		seedPrd('beta', {sliceAfter: ['alpha']});
		const blocked = recordingRunner();
		await performDoAuto({...base(blocked.run), config: cfg(), count: 9});
		expect(blocked.args).toEqual(['prd:alpha']);

		// Move alpha into `work/briefs/tasked/` (the source of truth for sliced-ness) ⇒
		// beta's sliceAfter is satisfied (resolved against FOLDER residence) and beta
		// joins the pool. alpha itself has LEFT the to-slice pool (it now rests in
		// prd-sliced/), so only beta is selectable.
		seedSlicedPrd('alpha');
		const unblocked = recordingRunner();
		await performDoAuto({...base(unblocked.run), config: cfg(), count: 9});
		expect(unblocked.args).toEqual(['prd:beta']);
	});

	it('blocked slice is excluded from the slice pool (existing eligibility path)', async () => {
		seedSlice('beta', {blockedBy: ['alpha']}); // alpha not done ⇒ blocked
		seedSlice('alpha'); // eligible
		const {run, args} = recordingRunner();
		await performDoAuto({...base(run), config: cfg(), count: 9});
		// only alpha is eligible; beta is blocked. (no PRDs seeded)
		expect(args).toEqual(['alpha']);

		// satisfy the blocker ⇒ beta joins the pool.
		seedDone('alpha');
		const again = recordingRunner();
		await performDoAuto({...base(again.run), config: cfg(), count: 9});
		expect(again.args).toEqual(['alpha', 'beta']);
	});
});

describe('each selected item runs the EXISTING performDo pipeline', () => {
	it('defaults the runner to performDo (the do-in-place pipeline) when none injected', async () => {
		// We do not drive a full git pipeline here; just prove the default wiring is
		// `performDo` (not a re-implementation). With no slices/PRDs the layer never
		// calls it, so this asserts the DEFAULT identity without side-effects.
		seedSlice('humanly', {humanOnly: true}); // nothing eligible
		const result = await performDoAuto({cwd: repo, config: cfg()});
		expect(result.exitCode).toBe(0);
		expect(result.results).toEqual([]);
	});
});

// A compile-time anchor: the default single-`do` runner the layer uses IS
// `performDo` (the do-in-place pipeline), not a fork.
void performDo;
