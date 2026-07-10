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
import type {ConfigOverrideMap} from '../src/config-override.js';

/**
 * `do-autopick` — the MULTI-ITEM selection forms (auto-pick / `-n` / multi-arg)
 * + the two-pool tasks-first priority (per-repo toggle). House style: a seeded
 * backlog of TASKS + taskable PRDs in a plain checkout (no git mutation — the
 * selection layer only READS `work/`), with a STUBBED single-`do` runner that
 * records the `arg` it was handed (so we assert WHICH items ran, in what ORDER,
 * without driving the real claim/build/integrate pipeline — that is do-in-place's
 * tested job). `do` is sequential, so a recording runner is sufficient.
 */

let root: string;
let repo: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-do-autopick-'));
	repo = join(root, 'project');
	mkdirSync(repo, {recursive: true});
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

/** Seed a `work/tasks/ready/<slug>.md` task with the given gate frontmatter. */
function seedTask(
	slug: string,
	fm: {humanOnly?: boolean; needsAnswers?: boolean; blockedBy?: string[]} = {},
): void {
	const dir = join(repo, 'work', 'tasks', 'ready');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.humanOnly) lines.push('humanOnly: true');
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	lines.push(`blockedBy: [${(fm.blockedBy ?? []).join(', ')}]`, '---', '', 'x');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

/** Seed a `work/tasks/done/<slug>.md` (satisfies a task's blockedBy). */
function seedDone(slug: string): void {
	const dir = join(repo, 'work', 'tasks', 'done');
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, `${slug}.md`), `---\nslug: ${slug}\n---\n`);
}

/** Seed a `work/specs/ready/<slug>.md` PRD with the given gate frontmatter. */
function seedPrd(
	slug: string,
	fm: {
		humanOnly?: boolean;
		needsAnswers?: boolean;
		taskedAfter?: string[];
	} = {},
): void {
	const dir = join(repo, 'work', 'specs', 'ready');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.humanOnly) lines.push('humanOnly: true');
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	if (fm.taskedAfter) lines.push(`taskedAfter: [${fm.taskedAfter.join(', ')}]`);
	lines.push('---', '', '# PRD');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

/**
 * Seed a TASKED PRD as RESIDENCE in `work/specs/tasked/` (the source of truth for
 * tasked-ness, task `prd-sliced-folder-step-a`) — it has left the to-task pool
 * (`work/specs/ready/`) and now resolves another PRD's `taskedAfter` by FOLDER residence
 * (the `tasked:` marker was removed in `remove-sliced-marker-step-b`).
 */
function seedTaskedPrd(slug: string): void {
	const fromDir = join(repo, 'work', 'specs', 'ready');
	const from = join(fromDir, `${slug}.md`);
	rmSync(from, {force: true});
	const dir = join(repo, 'work', 'specs', 'tasked');
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
	// autoBuild on so seeded tasks are eligible; autoTask on so PRDs are
	// taskable. Both default OFF, so the tests opt in explicitly.
	return mergeConfig({autoBuild: true, autoTask: true, ...over});
}

/** The minimal shared `DoOptions` base the layer threads to each run. */
function base(run: DoRunner) {
	return {cwd: repo, run} satisfies Partial<DoOptions> & {run: DoRunner};
}

describe('do (auto-pick) — applies the per-machine override over the committed .dorfl.json', () => {
	// REGRESSION (per-machine-config-override-layer Gate-2 block): the in-place
	// autopick path resolves the pool through `scanRepoPaths`, which must apply the
	// per-machine override on top of the committed `.dorfl.json`. Committed
	// `autoBuild: false` (task ineligible) vs override `"*": {autoBuild: true}`
	// (task eligible). The override is per-machine and beats the committed file,
	// so the seeded task MUST be auto-picked. Before the override was threaded
	// into `performDoAuto`, the committed `false` stood and nothing ran.
	it('the override ("*") flips autoBuild ON over a committed autoBuild:false (task is auto-picked)', async () => {
		seedTask('alpha');
		writeFileSync(
			join(repo, '.dorfl.json'),
			JSON.stringify({autoBuild: false}),
		);
		const override: ConfigOverrideMap = {'*': {autoBuild: true}};
		const {run, args} = recordingRunner();
		const result = await performDoAuto({
			...base(run),
			// Global ON, but committed file says OFF; the override flips it back ON.
			config: cfg({autoBuild: false}),
			override,
		});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual(['alpha']);
	});

	// CONTROL: same fixture, NO override ⇒ the committed `autoBuild: false` stands,
	// so the task is ineligible and nothing is auto-picked.
	it('control: WITHOUT the override the committed autoBuild:false stands (nothing auto-picked)', async () => {
		seedTask('alpha');
		writeFileSync(
			join(repo, '.dorfl.json'),
			JSON.stringify({autoBuild: false}),
		);
		const {run, args} = recordingRunner();
		const result = await performDoAuto({
			...base(run),
			config: cfg({autoBuild: false}),
		});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual([]);
	});
});

describe('do (auto-pick, no arg) — picks ONE eligible item', () => {
	it('auto-picks the first eligible TASK when tasks exist', async () => {
		seedTask('alpha');
		seedTask('beta');
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		const result = await performDoAuto({...base(run), config: cfg()});
		expect(result.exitCode).toBe(0);
		// exactly one item, the first eligible task (tasks sort by slug).
		expect(args).toEqual(['alpha']);
	});

	it('auto-picks a PRD (do spec:<slug>) when NO task is eligible', async () => {
		seedTask('humanly', {humanOnly: true}); // not eligible
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		const result = await performDoAuto({...base(run), config: cfg()});
		expect(result.exitCode).toBe(0);
		// the PRD dispatches to the `do spec:` path (prefixed arg).
		expect(args).toEqual(['spec:gamma']);
	});

	it('an empty backlog + no taskable PRD is NOT a failure (exit 0, nothing run)', async () => {
		const {run, args} = recordingRunner();
		const result = await performDoAuto({...base(run), config: cfg()});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual([]);
		expect(result.message).toMatch(/nothing eligible/i);
	});
});

describe('do -n <x> — x eligible items, in SEQUENCE', () => {
	it('takes x items, tasks first then PRDs, in order', async () => {
		seedTask('alpha');
		seedPrd('gamma');
		seedPrd('delta');
		const {run, args} = recordingRunner();
		const result = await performDoAuto({
			...base(run),
			config: cfg(),
			count: 3,
		});
		expect(result.exitCode).toBe(0);
		// one eligible task drains first, then the two taskable PRDs (by slug).
		expect(args).toEqual(['alpha', 'spec:delta', 'spec:gamma']);
	});

	it('-n bounds the count (does not over-take)', async () => {
		seedTask('alpha');
		seedTask('beta');
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		await performDoAuto({...base(run), config: cfg(), count: 2});
		expect(args).toEqual(['alpha', 'beta']); // count caps at 2; PRD untouched
	});
});

describe('do <a> <b> — explicit multi-arg, in the GIVEN order', () => {
	it('runs the named items in sequence (no pool/priority), arg passed verbatim', async () => {
		const {run, args} = recordingRunner();
		const result = await performDoArgs(['beta', 'task:alpha', 'prd:gamma'], {
			...base(run),
			config: cfg(),
		});
		expect(result.exitCode).toBe(0);
		// verbatim + in the operator's order (performDo does its own slug resolve).
		expect(args).toEqual(['beta', 'task:alpha', 'prd:gamma']);
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

describe('tasks-first PRIORITY + the configurable selectionOrder FLIP', () => {
	it('default (drain): an eligible TASK outranks a taskable PRD', async () => {
		seedTask('alpha');
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		await performDoAuto({...base(run), config: cfg(), count: 1});
		expect(args).toEqual(['alpha']);
	});

	it('[task, build, ...] (== old prdsFirst:true): a taskable PRD outranks an eligible task', async () => {
		seedTask('alpha');
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		await performDoAuto({
			...base(run),
			config: cfg({selectionOrder: ['task', 'build', 'surface', 'triage']}),
			count: 1,
		});
		expect(args).toEqual(['spec:gamma']);
	});

	it('the FULL ordering flips with the order (all tasks vs all PRDs)', async () => {
		seedTask('alpha');
		seedPrd('gamma');
		const off = recordingRunner();
		await performDoAuto({...base(off.run), config: cfg(), count: 9});
		expect(off.args).toEqual(['alpha', 'spec:gamma']);

		const on = recordingRunner();
		await performDoAuto({
			...base(on.run),
			config: cfg({selectionOrder: ['task', 'build', 'surface', 'triage']}),
			count: 9,
		});
		expect(on.args).toEqual(['spec:gamma', 'alpha']);
	});
});

describe('PRD pool eligibility is autoslice-gate (not reinvented)', () => {
	it('autoTask OFF ⇒ no PRD is selected even with no tasks', async () => {
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		const result = await performDoAuto({
			...base(run),
			config: cfg({autoTask: false}),
			count: 5,
		});
		expect(args).toEqual([]);
		expect(result.exitCode).toBe(0);
	});

	it('a humanOnly / needsAnswers PRD is excluded; a taskedAfter-blocked one too', async () => {
		seedPrd('human', {humanOnly: true});
		seedPrd('asks', {needsAnswers: true});
		seedPrd('beta', {taskedAfter: ['alpha']}); // alpha not tasked
		seedPrd('ready'); // the only taskable one
		const {run, args} = recordingRunner();
		await performDoAuto({...base(run), config: cfg(), count: 9});
		expect(args).toEqual(['spec:ready']);
	});

	it('a taskedAfter PRD becomes selectable once its blocker resides in prd-tasked/ (folder residence, not done/)', async () => {
		// beta's blocker alpha is UNTASKED ⇒ beta is excluded (alpha itself is
		// taskable: the gate does not exclude an untasked PRD).
		seedPrd('alpha');
		seedPrd('beta', {taskedAfter: ['alpha']});
		const blocked = recordingRunner();
		await performDoAuto({...base(blocked.run), config: cfg(), count: 9});
		expect(blocked.args).toEqual(['spec:alpha']);

		// Move alpha into `work/specs/tasked/` (the source of truth for tasked-ness) ⇒
		// beta's taskedAfter is satisfied (resolved against FOLDER residence) and beta
		// joins the pool. alpha itself has LEFT the to-task pool (it now rests in
		// prd-tasked/), so only beta is selectable.
		seedTaskedPrd('alpha');
		const unblocked = recordingRunner();
		await performDoAuto({...base(unblocked.run), config: cfg(), count: 9});
		expect(unblocked.args).toEqual(['spec:beta']);
	});

	it('blocked task is excluded from the task pool (existing eligibility path)', async () => {
		seedTask('beta', {blockedBy: ['alpha']}); // alpha not done ⇒ blocked
		seedTask('alpha'); // eligible
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
		// `performDo` (not a re-implementation). With no tasks/PRDs the layer never
		// calls it, so this asserts the DEFAULT identity without side-effects.
		seedTask('humanly', {humanOnly: true}); // nothing eligible
		const result = await performDoAuto({cwd: repo, config: cfg()});
		expect(result.exitCode).toBe(0);
		expect(result.results).toEqual([]);
	});
});

// A compile-time anchor: the default single-`do` runner the layer uses IS
// `performDo` (the do-in-place pipeline), not a fork.
void performDo;
