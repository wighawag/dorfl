import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	performAdvanceAuto,
	performAdvanceArgs,
	isCalmAtRest,
	type AdvanceTickRunner,
} from '../src/advance-drivers.js';
import type {AdvanceResult} from '../src/advance.js';
import {mergeConfig, type Config} from '../src/config.js';
import type {ConfigOverrideMap} from '../src/config-override.js';

/**
 * `advance-drivers-and-gates` — the one-shot SEQUENTIAL driver over the advance
 * TICK (the loop driver is `run`, tested in `run-*.test.ts`). House style: a
 * seeded `work/` of slices + sliceable PRDs in a plain checkout (no git mutation —
 * the SELECTION layer only READS `work/`), with a STUBBED single-tick runner that
 * records the `arg` it was handed (so we assert WHICH items advanced, in what
 * ORDER, without driving the real classify/lock/execute pipeline — that is
 * advance.test.ts's tested job). `advance -n` is SEQUENTIAL, so a recording runner
 * is sufficient.
 *
 * Proves: one-shot sequential `-n`; the bare/`-n` selection respects the FLAT
 * per-action gates (build→`autoBuild`, slice→`autoTask`) by SELECTION; surface/
 * apply are ALWAYS allowed even with every flag off (the named path); and the
 * drain/idle convergence (US #31).
 */

let root: string;
let repo: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-advance-drivers-'));
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

/** Seed a `work/briefs/ready/<slug>.md` PRD with the given gate frontmatter. */
function seedPrd(
	slug: string,
	fm: {humanOnly?: boolean; needsAnswers?: boolean; briefAfter?: string[]} = {},
): void {
	const dir = join(repo, 'work', 'briefs', 'ready');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.humanOnly) lines.push('humanOnly: true');
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	if (fm.briefAfter) lines.push(`briefAfter: [${fm.briefAfter.join(', ')}]`);
	lines.push('---', '', '# PRD');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

/**
 * A recording tick runner: captures each `arg` (the ORDER + identity of every
 * item the driver advanced), and returns a caller-chosen outcome (default
 * `advanced`). Records nothing about the model/lock — the tick's own tests pin
 * that; here we assert the DRIVER's selection + sequencing.
 */
function recordingRunner(
	outcomeFor: (arg: string) => AdvanceResult['outcome'] = () => 'advanced',
): {run: AdvanceTickRunner; args: string[]} {
	const args: string[] = [];
	const run: AdvanceTickRunner = async (options) => {
		args.push(options.arg);
		const outcome = outcomeFor(options.arg);
		return {
			exitCode: outcome === 'no-op' ? 0 : outcome === 'advanced' ? 0 : 1,
			outcome,
			slug: options.arg,
			message: `${outcome} ${options.arg}`,
		} satisfies AdvanceResult;
	};
	return {run, args};
}

function cfg(over: Partial<Config> = {}): Config {
	// Both gates default OFF (the per-action gate family); the tests opt in
	// explicitly to assert the gate composition.
	return mergeConfig({autoBuild: true, autoTask: true, ...over});
}

describe('advance (auto-pick) — applies the per-machine override over the committed .agent-runner.json', () => {
	// REGRESSION (per-machine-config-override-layer Gate-2 block): the in-place
	// advance autopick path resolves its pool through `scanRepoPaths` and must
	// apply the per-machine override on top of the committed `.agent-runner.json`.
	// Committed `autoBuild: false` (slice ineligible) vs override `"*":
	// {autoBuild: true}` (eligible) ⇒ the slice MUST advance. Before `override`
	// was threaded into `performAdvanceAuto`, the committed `false` stood.
	it('the override ("*") flips autoBuild ON over a committed autoBuild:false (slice advances)', async () => {
		seedSlice('alpha');
		writeFileSync(
			join(repo, '.agent-runner.json'),
			JSON.stringify({autoBuild: false}),
		);
		const override: ConfigOverrideMap = {'*': {autoBuild: true}};
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg({autoBuild: false}),
			override,
		});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual(['alpha']);
	});

	// CONTROL: same fixture, NO override ⇒ committed `autoBuild: false` stands, so
	// nothing advances.
	it('control: WITHOUT the override the committed autoBuild:false stands (nothing advances)', async () => {
		seedSlice('alpha');
		writeFileSync(
			join(repo, '.agent-runner.json'),
			JSON.stringify({autoBuild: false}),
		);
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg({autoBuild: false}),
		});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual([]);
	});
});

describe('advance (bare, no arg) — auto-picks ONE eligible item', () => {
	it('auto-picks the first eligible SLICE when slices exist', async () => {
		seedSlice('alpha');
		seedSlice('beta');
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({cwd: repo, run, config: cfg()});
		expect(result.exitCode).toBe(0);
		// exactly one item, the first eligible slice (slices sort by slug).
		expect(args).toEqual(['alpha']);
	});

	it('auto-picks a PRD (advance prd:<slug>) when NO slice is eligible', async () => {
		seedSlice('humanly', {humanOnly: true}); // not eligible
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({cwd: repo, run, config: cfg()});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual(['brief:gamma']);
	});

	it('an empty backlog + no sliceable PRD is calm-at-rest (exit 0, nothing run)', async () => {
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({cwd: repo, run, config: cfg()});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual([]);
		expect(result.message).toMatch(/nothing eligible/i);
	});
});

describe('advance -n <x> — x eligible items, ALWAYS SEQUENTIAL (US #25)', () => {
	it('takes x items, slices first then PRDs, in order', async () => {
		seedSlice('alpha');
		seedPrd('gamma');
		seedPrd('delta');
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			count: 3,
		});
		expect(result.exitCode).toBe(0);
		// one eligible slice drains first, then the two sliceable PRDs (by slug).
		expect(args).toEqual(['alpha', 'brief:delta', 'brief:gamma']);
	});

	it('-n runs the ticks SEQUENTIALLY (no overlap) — a serialised in-flight count', async () => {
		seedSlice('alpha');
		seedSlice('beta');
		let inFlight = 0;
		let maxInFlight = 0;
		const order: string[] = [];
		const run: AdvanceTickRunner = async (options) => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			order.push(`start:${options.arg}`);
			await new Promise((r) => setTimeout(r, 5));
			order.push(`end:${options.arg}`);
			inFlight--;
			return {exitCode: 0, outcome: 'advanced', message: ''};
		};
		await performAdvanceAuto({cwd: repo, run, config: cfg(), count: 2});
		// NEVER two ticks in flight at once — `-n` is a dumb sequential loop.
		expect(maxInFlight).toBe(1);
		// Each item fully completes before the next starts.
		expect(order).toEqual([
			'start:alpha',
			'end:alpha',
			'start:beta',
			'end:beta',
		]);
	});

	it('-n bounds the count (does not over-take)', async () => {
		seedSlice('alpha');
		seedSlice('beta');
		seedPrd('gamma');
		const {run, args} = recordingRunner();
		await performAdvanceAuto({cwd: repo, run, config: cfg(), count: 2});
		expect(args).toHaveLength(2);
	});
});

describe('advance <a> <b> — explicit named items, IN SEQUENCE', () => {
	it('advances the NAMED items in the given order (no pool/priority)', async () => {
		const {run, args} = recordingRunner();
		const result = await performAdvanceArgs(
			['obs:stray', 'brief:thing', 'feature'],
			{cwd: repo, run, config: cfg()},
		);
		expect(result.exitCode).toBe(0);
		// verbatim, in the operator's order — the tick resolves each namespace.
		expect(args).toEqual(['obs:stray', 'brief:thing', 'feature']);
	});
});

describe('advance — the FLAT per-action gate family (US #23) by SELECTION', () => {
	it('with autoBuild OFF, the bare/-n selection picks NO slice (build gated)', async () => {
		seedSlice('alpha');
		seedSlice('beta');
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg({autoBuild: false}),
			count: 5,
		});
		// build→autoBuild: off ⇒ no slice surfaces in the autonomous pool.
		expect(args).toEqual([]);
		expect(result.exitCode).toBe(0);
	});

	it('with autoTask OFF, the bare/-n selection picks NO PRD (slice gated)', async () => {
		seedPrd('gamma');
		seedPrd('delta');
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg({autoTask: false}),
			count: 5,
		});
		// slice→autoTask: off ⇒ no PRD surfaces in the autonomous pool.
		expect(args).toEqual([]);
	});

	it('with EVERY gate off, the bare selection is empty (zero autonomy) BUT a NAMED surface/apply still runs (always-allowed)', async () => {
		seedSlice('alpha');
		seedPrd('gamma');
		// Bare form with all flags off: the "question loop with ZERO autonomy" case
		// — nothing autonomous is selected.
		const {run: bareRun, args: bareArgs} = recordingRunner();
		const bare = await performAdvanceAuto({
			cwd: repo,
			run: bareRun,
			config: cfg({
				autoBuild: false,
				autoTask: false,
				observationTriage: 'off',
			}),
			count: 5,
		});
		expect(bareArgs).toEqual([]);
		expect(bare.exitCode).toBe(0);

		// But NAMING an item still advances it — surface + apply are ALWAYS allowed,
		// never pool-gated. The tick (not the driver) runs the surface/apply rung; the
		// driver just hands the named arg through regardless of the gate family.
		const {run: namedRun, args: namedArgs} = recordingRunner();
		await performAdvanceArgs(['feature'], {
			cwd: repo,
			run: namedRun,
			config: cfg({
				autoBuild: false,
				autoTask: false,
				observationTriage: 'off',
			}),
		});
		expect(namedArgs).toEqual(['feature']);
	});
});

describe('advance — convergence: the loop DRAINS + IDLES at rest (US #31)', () => {
	it('a pending-sidecar pool IDLES — every tick a clean NO-OP, nothing advances, STABLE', async () => {
		// Three eligible slices whose ticks classify NO-OP (a pending sidecar awaiting
		// a human). The driver selects them but each tick no-ops — the pool is stable.
		seedSlice('alpha');
		seedSlice('beta');
		seedSlice('gamma');
		const {run, args} = recordingRunner(() => 'no-op');
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			count: 5,
		});
		expect(args).toEqual(['alpha', 'beta', 'gamma']);
		expect(result.exitCode).toBe(0);
		// CALM-AT-REST: nothing advanced, nothing failed (no thrash).
		expect(isCalmAtRest(result)).toBe(true);
		expect(result.results.every((r) => r.outcome === 'no-op')).toBe(true);
	});

	it('the pool DRAINS monotonically as answers arrive (a no-op item flips to advanced)', async () => {
		seedSlice('alpha');
		seedSlice('beta');
		seedSlice('gamma');

		// Pass 1: all three pending ⇒ all no-op (calm).
		const pass1 = await performAdvanceAuto({
			cwd: repo,
			run: recordingRunner(() => 'no-op').run,
			config: cfg(),
			count: 5,
		});
		expect(isCalmAtRest(pass1)).toBe(true);

		// Pass 2: the human answered `alpha` ⇒ its tick now ADVANCES (apply); the
		// others still no-op. The advancing count grew; the no-op pool shrank.
		const pass2 = await performAdvanceAuto({
			cwd: repo,
			run: recordingRunner((arg) => (arg === 'alpha' ? 'advanced' : 'no-op'))
				.run,
			config: cfg(),
			count: 5,
		});
		const advanced2 = pass2.results.filter(
			(r) => r.outcome === 'advanced',
		).length;
		const noop2 = pass2.results.filter((r) => r.outcome === 'no-op').length;
		expect(advanced2).toBe(1); // alpha drained
		expect(noop2).toBe(2); // beta, gamma still idle
		expect(isCalmAtRest(pass2)).toBe(false); // progress, not at rest

		// Monotonic: the no-op (idle) count strictly shrank from pass 1 (3) to pass 2 (2).
		const noop1 = pass1.results.filter((r) => r.outcome === 'no-op').length;
		expect(noop2).toBeLessThan(noop1);
	});
});

describe('advance — aggregate exit contract', () => {
	it('exits non-zero iff some item failed (worst outcome surfaces)', async () => {
		const {run} = recordingRunner((arg) =>
			arg === 'bad' ? 'usage-error' : 'advanced',
		);
		const result = await performAdvanceArgs(['ok', 'bad', 'ok2'], {
			cwd: repo,
			run,
			config: cfg(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/3 items \(2 ok, 1 not\)/);
	});

	it('exits 0 when every item succeeded', async () => {
		const {run} = recordingRunner();
		const result = await performAdvanceArgs(['a', 'b'], {
			cwd: repo,
			run,
			config: cfg(),
		});
		expect(result.exitCode).toBe(0);
	});
});
