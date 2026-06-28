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
 * `advance-rung-surface` task (PRD `advance-loop`, US #32/33) — the SURFACE gate:
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
				item: 'task:foo',
				questions: [
					{
						question: 'which default applies?',
						context: 'src/foo.ts:10',
						default: 'use A',
					},
					{
						question: 'promote or keep?',
						context: 'an exact duplicate of bar',
					},
				],
			}),
			'```',
		].join('\n');
		const emit = parseSurfaceEmit(output);
		expect(emit.item).toBe('task:foo');
		expect(emit.questions).toHaveLength(2);
		expect(emit.questions[0].context).toBe('src/foo.ts:10');
		expect(emit.questions[0].default).toBe('use A');
		// A surfaced question is a PLAIN question — no disposition field any more.
		expect('disposition' in emit.questions[1]).toBe(false);
	});

	it('an EMPTY questions array is VALID (the honest "no open judgement" result)', () => {
		const emit = parseSurfaceEmit('{"item":"task:foo","questions":[]}');
		expect(emit.questions).toEqual([]);
	});

	it('IGNORES any disposition token on a surfaced question (the vocabulary is retired — a question is plain)', () => {
		// The disposition vocabulary is gone (task
		// `agentic-apply-retire-disposition-vocabulary`): a surfaced question carries
		// NO disposition token; what to DO with the answer is the agentic decision.
		const emit = parseSurfaceEmit(
			JSON.stringify({
				item: 'observation:foo',
				questions: [
					{question: 'task or PRD?', disposition: 'promote-task'},
					{question: 'spec-sized?', disposition: 'promote-prd'},
				],
			}),
		);
		expect(emit.questions).toHaveLength(2);
		expect('disposition' in emit.questions[0]).toBe(false);
		expect('disposition' in emit.questions[1]).toBe(false);
	});

	it('drops an empty-question placeholder (normalises); any disposition token is ignored', () => {
		const emit = parseSurfaceEmit(
			JSON.stringify({
				questions: [
					{question: '  ', context: 'placeholder'},
					{question: 'real?', disposition: 'bogus-value'},
				],
			}),
		);
		// The all-whitespace question is dropped; the disposition token is omitted.
		expect(emit.questions).toHaveLength(1);
		expect(emit.questions[0].question).toBe('real?');
		expect('disposition' in emit.questions[0]).toBe(false);
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
	it('carries question/context/default through with zero translation (no disposition field)', () => {
		const emit: SurfaceEmit = {
			questions: [
				{question: 'q1?', context: 'ctx', default: 'd'},
				{question: 'q2?'},
				{question: 'q3?'},
			],
		};
		expect(toNewQuestions(emit)).toEqual([
			{question: 'q1?', context: 'ctx', default: 'd'},
			{question: 'q2?'},
			{question: 'q3?'},
		]);
	});
});

describe('buildSurfacePrompt — frames the fresh-context surface + the required output', () => {
	it('names the item, references the in-band SURFACE-PROTOCOL doc, demands the JSON {questions}', () => {
		const p = buildSurfacePrompt('prd:autotask');
		expect(p).toContain('prd:autotask');
		// Points at the protocol doc (in-band discipline), not at a host-installed skill.
		expect(p).toMatch(/work\/protocol\/SURFACE-PROTOCOL\.md/);
		expect(p).toMatch(/"questions"/);
		// The disposition vocabulary is retired: the surface prompt no longer offers a
		// `disposition` token (the agentic apply decision sizes the signal).
		expect(p).not.toContain('disposition');
		// Fresh-context surfacer that EDITS nothing and EMITS only (mirrors review).
		expect(p).toMatch(/EMIT questions only|Do NOT edit/);
		// The skill JUDGES, the engine PERSISTS — the division of labour is named.
		expect(p).toMatch(/engine PERSISTS|engine persists/i);
	});

	it('does NOT re-inline the discipline prose (laws + humility rule live in SURFACE-PROTOCOL.md)', () => {
		const p = buildSurfacePrompt('task:foo');
		// The two-laws + humility-rule prose has moved OUT into the protocol doc;
		// the builder must not carry a duplicate (the drift this task exists to fix).
		expect(p).not.toMatch(/NEVER invent an answer/i);
		expect(p).not.toMatch(/GATHER-only/);
		expect(p).not.toMatch(/PERSIST-NEVER/);
		expect(p).not.toMatch(/HUMILITY RULE/i);
		// And the "use the surface-questions skill" framing is gone — we reference
		// the protocol DOC the skill points at, not the host-installed skill.
		expect(p).not.toMatch(/Run the `surface-questions` skill/);
	});

	it('carries the SHARED defensive-JSON parseability contract (the Gate-2 hardening)', () => {
		// The surface rung hit the IDENTICAL unparseable-emit failure the verdict
		// gate did (observation
		// `surface-rung-agent-emits-no-parseable-questions`); the prompt now reuses
		// the SAME `parseableJsonContractPrompt` the verdict gate carries instead of
		// being the lone un-hardened agent→JSON seam.
		const p = buildSurfacePrompt('task:foo');
		expect(p).toMatch(/Keep the JSON PARSEABLE/);
		expect(p).toMatch(/MINIFIED/);
		expect(p).toMatch(/literal double-quote/);
		expect(p).toMatch(/raw newline/);
		// The surface emit's longest field is `context`.
		expect(p).toMatch(/LONGEST field \(`context`\)/);
		// And the example is presented as something to MINIFY, not a multi-line
		// template that invites pretty-printing.
		expect(p).toMatch(/you MUST emit it MINIFIED/);
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
					output: '{"item":"task:foo","questions":[{"question":"q?"}]}',
				};
			},
			launchInteractive: () => {
				throw new Error('stub harness does not launch interactively');
			},
			isAlive: () => false,
		};
		const gate = harnessSurfaceGate({harness: spyHarness, agentCmd: 'ignored'});
		const emit = await gate({
			item: 'task:foo',
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
		const emit = await gate({item: 'task:foo', cwd: '/tmp'});
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
		await expect(gate({item: 'task:foo', cwd: '/tmp'})).rejects.toBeInstanceOf(
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
		await expect(gate({item: 'task:foo', cwd: '/tmp'})).rejects.toBeInstanceOf(
			SurfaceParseError,
		);
	});

	it('rejects a {model} placeholder with no surfaceModel (the substituteModel guard)', async () => {
		const gate = harnessSurfaceGate({
			harness: new NullHarness(),
			agentCmd: 'surface-agent --model {model}',
		});
		await expect(gate({item: 'task:foo', cwd: process.cwd()})).rejects.toThrow(
			new RegExp(MODEL_PLACEHOLDER.replace(/[{}]/g, '\\$&')),
		);
	});
});
