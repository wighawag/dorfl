import {describe, it, expect} from 'vitest';
import {
	parseSurfaceEmit,
	SurfaceParseError,
	buildSurfacePrompt,
	harnessSurfaceGate,
	toNewQuestions,
	type SurfaceEmit,
} from '../src/surface-gate.js';
import {NullHarness, MODEL_PLACEHOLDER, type Harness} from '../src/harness.js';

/**
 * `advance-rung-surface` slice (PRD `advance-loop`, US #32/33) — the SURFACE gate:
 * the fresh-context `surface-questions` spawn + structured-emit parse, the DIRECT
 * mirror of the Gate-2 review gate. Pure-logic unit tests (no git): the emit
 * parser ({questions} list, empty is valid), the prompt framing (fresh-context,
 * EMITs only, the humility rule), and the surfaceModel override reaching the
 * launch via the EXISTING `LaunchInput.model` seam (no new model mechanism). The
 * engine PERSIST half is tested in `surface-persist.test.ts`; the rung WIRING in
 * `advance-surface.test.ts`.
 */

describe('parseSurfaceEmit — reads the surface-questions SKILL emit shape', () => {
	it('parses a {item, questions[…]} emit, even wrapped in prose/fences', () => {
		const output = [
			'Here are the questions.',
			'```json',
			JSON.stringify({
				item: 'slice:foo',
				questions: [
					{
						question: 'which default applies?',
						context: 'src/foo.ts:10',
						default: 'use A',
					},
					{
						question: 'promote or keep?',
						context: 'an exact duplicate of bar',
						disposition: 'keep',
					},
				],
			}),
			'```',
		].join('\n');
		const emit = parseSurfaceEmit(output);
		expect(emit.item).toBe('slice:foo');
		expect(emit.questions).toHaveLength(2);
		expect(emit.questions[0].context).toBe('src/foo.ts:10');
		expect(emit.questions[0].default).toBe('use A');
		expect(emit.questions[1].disposition).toBe('keep');
	});

	it('an EMPTY questions array is VALID (the honest "no open judgement" result)', () => {
		const emit = parseSurfaceEmit('{"item":"slice:foo","questions":[]}');
		expect(emit.questions).toEqual([]);
	});

	it('drops an unknown disposition + an empty-question placeholder (normalises)', () => {
		const emit = parseSurfaceEmit(
			JSON.stringify({
				questions: [
					{question: '  ', context: 'placeholder'},
					{question: 'real?', disposition: 'bogus-value'},
				],
			}),
		);
		// The all-whitespace question is dropped; the bogus disposition is omitted.
		expect(emit.questions).toHaveLength(1);
		expect(emit.questions[0].question).toBe('real?');
		expect(emit.questions[0].disposition).toBeUndefined();
	});

	it('throws SurfaceParseError on no {questions} / invalid JSON (never a silent surface)', () => {
		expect(() => parseSurfaceEmit('I have no questions for you')).toThrow(
			SurfaceParseError,
		);
		expect(() => parseSurfaceEmit('{"questions": not json')).toThrow(
			SurfaceParseError,
		);
		// A JSON object that is NOT a {questions} shape (no array) is a parse error.
		expect(() => parseSurfaceEmit('{"questions": "nope"}')).toThrow(
			SurfaceParseError,
		);
	});
});

describe('toNewQuestions — the emit shape maps 1:1 onto the sidecar NewQuestion', () => {
	it('carries question/context/default/disposition through with zero translation', () => {
		const emit: SurfaceEmit = {
			questions: [
				{question: 'q1?', context: 'ctx', default: 'd'},
				{question: 'q2?', disposition: 'promote-slice'},
			],
		};
		expect(toNewQuestions(emit)).toEqual([
			{question: 'q1?', context: 'ctx', default: 'd'},
			{question: 'q2?', disposition: 'promote-slice'},
		]);
	});
});

describe('buildSurfacePrompt — frames the fresh-context surface + the required output', () => {
	it('names the item, the surface-questions skill, and demands the JSON {questions}', () => {
		const p = buildSurfacePrompt('prd:autoslice');
		expect(p).toMatch(/surface-questions` skill|surface-questions\b/);
		expect(p).toContain('prd:autoslice');
		expect(p).toMatch(/"questions"/);
		// Fresh-context surfacer that EDITS nothing and EMITS only (mirrors review).
		expect(p).toMatch(/EMIT questions only|Do NOT edit/);
		expect(p).toMatch(/write NOTHING|writes nothing|PERSIST/i);
	});

	it('states the humility rule (surface the residue, NEVER invent an answer) + empty is valid', () => {
		const p = buildSurfacePrompt('slice:foo');
		expect(p).toMatch(/NEVER invent an answer/i);
		// An empty questions array (no open judgement) is an explicitly valid result.
		expect(p).toMatch(/EMPTY questions[\s\S]*array/i);
		// The skill JUDGES, the engine PERSISTS — the division of labour is named.
		expect(p).toMatch(/engine PERSISTS|engine persists/i);
	});
});

describe('harnessSurfaceGate — surfaceModel reaches the launch via the existing seam', () => {
	it('forwards surfaceModel as LaunchInput.model + feeds the surface prompt', async () => {
		let seenModel: string | undefined = 'UNSET';
		let seenPrompt = '';
		const spyHarness: Harness = {
			adapter: 'spy',
			launch(input) {
				seenModel = input.model;
				seenPrompt = input.prompt ?? '';
				// The emit rides the ANSWER channel (`output`), NOT `detail`.
				return {
					ok: true,
					record: {adapter: 'spy'},
					output: '{"item":"slice:foo","questions":[{"question":"q?"}]}',
				};
			},
			launchInteractive: () => {
				throw new Error('stub harness does not launch interactively');
			},
			isAlive: () => false,
		};
		const gate = harnessSurfaceGate({harness: spyHarness, agentCmd: 'ignored'});
		const emit = await gate({
			item: 'slice:foo',
			cwd: '/tmp',
			surfaceModel: 'surface/override',
		});
		expect(seenModel).toBe('surface/override');
		expect(seenPrompt).toMatch(/surface-questions/);
		expect(emit.questions).toHaveLength(1);
	});

	it('reads the emit from launched.output (the ANSWER channel), not detail', async () => {
		const outputHarness: Harness = {
			adapter: 'out',
			launch: () => ({
				ok: true,
				record: {adapter: 'out'},
				output:
					'Questions below.\n{"questions":[{"question":"open?","context":"c"}]}',
				detail: undefined,
			}),
			launchInteractive: () => {
				throw new Error('stub harness does not launch interactively');
			},
			isAlive: () => false,
		};
		const gate = harnessSurfaceGate({harness: outputHarness});
		const emit = await gate({item: 'slice:foo', cwd: '/tmp'});
		expect(emit.questions[0].question).toBe('open?');
	});

	it('an empty/absent output is the SurfaceParseError path (no silent surface)', async () => {
		const emptyOutput: Harness = {
			adapter: 'empty',
			launch: () => ({ok: true, record: {adapter: 'empty'}, output: undefined}),
			launchInteractive: () => {
				throw new Error('stub harness does not launch interactively');
			},
			isAlive: () => false,
		};
		const gate = harnessSurfaceGate({harness: emptyOutput});
		await expect(gate({item: 'slice:foo', cwd: '/tmp'})).rejects.toBeInstanceOf(
			SurfaceParseError,
		);
	});

	it('errors (SurfaceParseError) when the launch fails — never a silent surface', async () => {
		const failing: Harness = {
			adapter: 'fail',
			launch: () => ({ok: false, record: {adapter: 'fail'}, detail: 'boom'}),
			launchInteractive: () => {
				throw new Error('stub harness does not launch interactively');
			},
			isAlive: () => false,
		};
		const gate = harnessSurfaceGate({harness: failing});
		await expect(gate({item: 'slice:foo', cwd: '/tmp'})).rejects.toBeInstanceOf(
			SurfaceParseError,
		);
	});

	it('rejects a {model} placeholder with no surfaceModel (the substituteModel guard)', async () => {
		const gate = harnessSurfaceGate({
			harness: new NullHarness(),
			agentCmd: 'surface-agent --model {model}',
		});
		await expect(gate({item: 'slice:foo', cwd: process.cwd()})).rejects.toThrow(
			new RegExp(MODEL_PLACEHOLDER.replace(/[{}]/g, '\\$&')),
		);
	});
});
