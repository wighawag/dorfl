import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	rmSync,
	mkdirSync,
	writeFileSync,
	symlinkSync,
	readFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {
	HANDOFF_INTENT_KINDS,
	HANDOFF_INTENT_TABLE,
	HANDOFF_LIMITS,
	HANDOFF_RUNGS,
	HandoffRejected,
	canonicalHandoffItem,
	handoffName,
	intentRowFor,
	validateHandoffRecord,
	type HandoffRecord,
	type HandoffRung,
	type IntentRow,
} from '../src/ci-handoff-format.js';
import {
	HANDOFF_BUNDLE,
	HANDOFF_JSON,
	parseBundleHeader,
	readHandoff,
	writeHandoff,
} from '../src/ci-handoff.js';

/**
 * The CI handoff: the agent job writes it, the apply job reads it as HOSTILE.
 * The intent table is the security contract: a record carries only the fields
 * of its row's "taken from the record" column, for a kind its trusted rung can
 * produce, within the limits set in code.
 */

const ITEM_FOR: Record<HandoffRung, string> = {
	'build-task': 'task:add-thing',
	'task-spec': 'spec:big-thing',
	surface: 'task:add-thing',
	'triage-observation': 'observation:odd-note',
	apply: 'observation:odd-note',
	intake: 'issue:42',
};

/** A valid `products` for every row, exercising every field the row allows. */
const SAMPLE: Record<string, Record<string, unknown>> = {
	'integrate-build': {
		prTitle: 'Add the thing',
		prBody: 'Adds the thing.\n\nDetails.',
		reviewProse: 'Looks right.',
	},
	'integrate-answered-merge': {},
	'merge-restale': {},
	'needs-attention': {reason: 'gate red', questions: ['Which way?']},
	'deadline-checkpoint': {},
	stop: {reason: 'premise drifted', stopKind: 'sentinel'},
	'agent-failed': {failureDetail: 'exit 1'},
	'tasking-land': {
		candidates: {'first-task': '---\ntitle: First\n---\nbody\n'},
		prBody: 'Tasks the spec.',
		reviewVerdict: 'approve',
		reviewProse: 'Fine.',
		specBody: '## Problem Statement\n\nx\n',
	},
	'tasking-surface': {
		candidates: {'first-task': 'body'},
		reason: 'review blocked',
		questions: ['Split?'],
	},
	surface: {
		questions: [
			'What is X?',
			{question: 'Which Y?', context: 'Y is new.', default: 'The old Y.'},
		],
	},
	triage: {disposition: 'map', target: 'task:add-thing', reason: 'same'},
	'apply-decision': {
		outcome: 'task',
		title: 'Do the thing',
		body: '## What to build\n\nx\n',
		slug: 'do-the-thing',
		reason: 'answered',
	},
	'intake-ask': {question: 'Which version?'},
	'intake-bounce': {bounceText: 'Please file separate issues.'},
	'intake-task': {title: 'Fix the bug', body: '## What to build\n'},
	'intake-spec': {
		title: 'A big change',
		body: '## Problem Statement\n',
		humanOnly: true,
		needsAnswers: false,
	},
};

/** A sample whose cross-field rules allow the named field. */
const LIMIT_SAMPLE: Record<string, Record<string, unknown>> = {
	'triage.questions': {disposition: 'keep'},
	'apply-decision.questions': {outcome: 'ask'},
};

function recordFor(
	row: IntentRow,
	products: Record<string, unknown> = SAMPLE[row.row],
): {rung: HandoffRung; record: HandoffRecord} {
	const rung = row.rungs[0];
	return {
		rung,
		record: {
			schema: 1,
			item: ITEM_FOR[rung],
			intent: {kind: row.kind},
			products,
		} as HandoffRecord,
	};
}

function rowNamed(name: string): IntentRow {
	return HANDOFF_INTENT_TABLE.find((r) => r.row === name)!;
}

function sh(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
}

/** A repo with `main` at base and `work/task-add-thing` one commit ahead. */
function makeRepo(root: string): {repo: string; baseSha: string} {
	const repo = join(root, 'repo');
	mkdirSync(repo);
	sh(repo, 'init', '-q', '-b', 'main');
	sh(repo, 'config', 'user.email', 't@t');
	sh(repo, 'config', 'user.name', 't');
	writeFileSync(join(repo, 'a.txt'), 'a\n');
	sh(repo, 'add', '.');
	sh(repo, 'commit', '-qm', 'base');
	const baseSha = sh(repo, 'rev-parse', 'HEAD');
	sh(repo, 'checkout', '-qb', 'work/task-add-thing');
	writeFileSync(join(repo, 'b.txt'), 'b\n');
	sh(repo, 'add', '.');
	sh(repo, 'commit', '-qm', 'work');
	return {repo, baseSha};
}

function expectRejected(fn: () => unknown, rule: string): void {
	let caught: unknown;
	try {
		fn();
	} catch (e) {
		caught = e;
	}
	expect(caught, `expected a ${rule} rejection`).toBeInstanceOf(
		HandoffRejected,
	);
	expect((caught as HandoffRejected).rule).toBe(rule);
}

let root: string;
let runnerTemp: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-handoff-'));
	runnerTemp = join(root, 'runner-temp');
	mkdirSync(runnerTemp);
});
afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

describe('the intent table', () => {
	it('has the 15 kinds, each produced by some rung, every row with all four columns', () => {
		expect(HANDOFF_INTENT_KINDS).toHaveLength(15);
		for (const kind of HANDOFF_INTENT_KINDS) {
			expect(HANDOFF_INTENT_TABLE.some((r) => r.kind === kind)).toBe(true);
		}
		for (const row of HANDOFF_INTENT_TABLE) {
			expect(row.recomputed.length).toBeGreaterThan(0);
			expect(row.record).toBeDefined();
			expect(row.bundle.carries.length).toBeGreaterThan(0);
			expect(row.resumesAt.length).toBeGreaterThan(0);
			expect(row.rungs.length).toBeGreaterThan(0);
			expect(SAMPLE[row.row], `a sample for ${row.row}`).toBeDefined();
		}
	});

	it('maps each (rung, kind) pair to at most one row', () => {
		for (const rung of HANDOFF_RUNGS) {
			for (const kind of HANDOFF_INTENT_KINDS) {
				const rows = HANDOFF_INTENT_TABLE.filter(
					(r) => r.kind === kind && r.rungs.includes(rung),
				);
				expect(rows.length).toBeLessThanOrEqual(1);
			}
		}
	});

	it('takes only the spec columns from the record, and code only where the spec says', () => {
		const fields = Object.fromEntries(
			HANDOFF_INTENT_TABLE.map((r) => [r.row, Object.keys(r.record).sort()]),
		);
		expect(fields).toEqual({
			'integrate-build': ['prBody', 'prTitle', 'reviewProse'],
			'integrate-answered-merge': [],
			'merge-restale': [],
			'needs-attention': ['questions', 'reason'],
			'deadline-checkpoint': [],
			stop: ['reason', 'stopKind'],
			'agent-failed': ['failureDetail'],
			'tasking-land': [
				'candidates',
				'prBody',
				'reviewProse',
				'reviewVerdict',
				'specBody',
			],
			'tasking-surface': ['candidates', 'questions', 'reason'],
			surface: ['questions'],
			triage: ['disposition', 'questions', 'reason', 'target'],
			'apply-decision': [
				'body',
				'outcome',
				'questions',
				'reason',
				'slug',
				'title',
			],
			'intake-ask': ['question'],
			'intake-bounce': ['bounceText'],
			'intake-task': ['body', 'title'],
			'intake-spec': ['body', 'humanOnly', 'needsAnswers', 'title'],
		});
		const withBundle = HANDOFF_INTENT_TABLE.filter(
			(r) => r.bundle.rule !== 'none',
		).map((r) => `${r.row}:${r.bundle.rule}`);
		expect(withBundle.sort()).toEqual([
			'agent-failed:optional',
			'deadline-checkpoint:required',
			'integrate-answered-merge:required',
			'integrate-build:required',
			'needs-attention:optional',
			'stop:optional',
		]);
	});

	it('bounds each kind to the rungs that can produce it', () => {
		expect(intentRowFor('surface', 'integrate')).toBeUndefined();
		expect(intentRowFor('intake', 'integrate')).toBeUndefined();
		expect(intentRowFor('build-task', 'integrate')?.row).toBe(
			'integrate-build',
		);
		expect(intentRowFor('apply', 'integrate')?.row).toBe(
			'integrate-answered-merge',
		);
	});
});

describe('round trip: write, then read and validate', () => {
	for (const row of HANDOFF_INTENT_TABLE) {
		it(`${row.row}`, () => {
			const {rung, record} = recordFor(row);
			const dir = join(runnerTemp, 'handoff');
			let bundle;
			let baseSha: string | undefined;
			if (row.bundle.rule !== 'none') {
				const made = makeRepo(root);
				baseSha = made.baseSha;
				bundle = {
					repo: made.repo,
					workBranch: 'work/task-add-thing',
					baseSha,
				};
			}
			writeHandoff({dir, rung, record, bundle});
			const read = readHandoff({
				dir,
				runnerTemp,
				trust: {item: ITEM_FOR[rung], rung},
			});
			expect(read.record).toEqual(record);
			expect(read.row.row).toBe(row.row);
			expect(read.lfsObjects).toEqual([]);
			if (bundle) {
				expect(read.bundle?.ref).toBe('refs/heads/work/task-add-thing');
				expect(read.bundle?.prerequisites).toEqual([baseSha]);
				expect(read.bundle?.tip).toBe(
					sh(bundle.repo, 'rev-parse', 'work/task-add-thing'),
				);
			} else {
				expect(read.bundle).toBeUndefined();
			}
		});
	}

	it('an optional bundle may be left out', () => {
		const {rung, record} = recordFor(rowNamed('needs-attention'));
		const dir = join(runnerTemp, 'h');
		writeHandoff({dir, rung, record});
		const read = readHandoff({
			dir,
			runnerTemp,
			trust: {item: record.item, rung},
		});
		expect(read.bundle).toBeUndefined();
	});

	it('writes the item in canonical form (a bare slug is a task)', () => {
		const {rung, record} = recordFor(rowNamed('integrate-build'));
		const dir = join(runnerTemp, 'h');
		const {repo, baseSha} = makeRepo(root);
		writeHandoff({
			dir,
			rung,
			record: {...record, item: 'add-thing'},
			bundle: {repo, workBranch: 'work/task-add-thing', baseSha},
		});
		const json = JSON.parse(readFileSync(join(dir, HANDOFF_JSON), 'utf8'));
		expect(json.item).toBe('task:add-thing');
		readHandoff({dir, runnerTemp, trust: {item: 'add-thing', rung}});
	});
});

describe('record rejections', () => {
	const row = rowNamed('surface');
	const trust = {item: 'task:add-thing', rung: 'surface' as const};
	const base = () => JSON.parse(JSON.stringify(recordFor(row).record));

	it('rejects an unknown schema', () => {
		expectRejected(
			() => validateHandoffRecord({...base(), schema: 2}, trust),
			'schema',
		);
		expectRejected(
			() => validateHandoffRecord({...base(), schema: '1'}, trust),
			'schema',
		);
	});

	it('rejects an unknown kind', () => {
		expectRejected(
			() => validateHandoffRecord({...base(), intent: {kind: 'push'}}, trust),
			'kind',
		);
	});

	it('rejects an unknown field at every level', () => {
		expectRejected(
			() => validateHandoffRecord({...base(), branch: 'main'}, trust),
			'field',
		);
		expectRejected(
			() =>
				validateHandoffRecord(
					{...base(), intent: {kind: 'surface', mode: 'merge'}},
					trust,
				),
			'field',
		);
		const r = base();
		r.products.sidecarPath = 'work/questions/x.md';
		expectRejected(() => validateHandoffRecord(r, trust), 'field');
		// JSON.parse makes `__proto__` an own key: it is an unknown field too.
		const proto = JSON.parse(
			'{"schema":1,"item":"task:add-thing","intent":{"kind":"surface"},' +
				'"products":{"questions":["q"],"__proto__":{"x":1}}}',
		);
		expectRejected(() => validateHandoffRecord(proto, trust), 'field');
	});

	it('rejects a record field the row does not take (a trusted target)', () => {
		const {rung, record} = recordFor(rowNamed('integrate-answered-merge'));
		expectRejected(
			() =>
				validateHandoffRecord(
					{...record, products: {prTitle: 'x'}},
					{item: record.item, rung},
				),
			'field',
		);
	});

	it('rejects an intent kind the trusted rung cannot produce', () => {
		const {record} = recordFor(rowNamed('integrate-build'));
		expectRejected(
			() =>
				validateHandoffRecord(
					{...record, item: 'task:add-thing'},
					{item: 'task:add-thing', rung: 'surface'},
				),
			'kind-for-rung',
		);
		const intake = recordFor(rowNamed('intake-task')).record;
		expectRejected(
			() =>
				validateHandoffRecord(intake, {item: 'issue:42', rung: 'build-task'}),
			'kind-for-rung',
		);
	});

	it("rejects a record naming another item than the run's", () => {
		expectRejected(
			() => validateHandoffRecord({...base(), item: 'task:other'}, trust),
			'item',
		);
	});

	it('rejects a missing required field and a malformed value', () => {
		expectRejected(
			() => validateHandoffRecord({...base(), products: {}}, trust),
			'field',
		);
		expectRejected(
			() =>
				validateHandoffRecord({...base(), products: {questions: 'x'}}, trust),
			'field',
		);
		const stop = recordFor(rowNamed('stop'));
		expectRejected(
			() =>
				validateHandoffRecord(
					{...stop.record, products: {reason: 'x', stopKind: 'other'}},
					{item: stop.record.item, rung: stop.rung},
				),
			'field',
		);
	});

	it('rejects a multi-line or control-character title', () => {
		const {rung, record} = recordFor(rowNamed('intake-task'));
		for (const title of ['a\nb', 'a\rb', 'a\u0007', '   ']) {
			expectRejected(
				() =>
					validateHandoffRecord(
						{...record, products: {title, body: 'x'}},
						{item: record.item, rung},
					),
				'field',
			);
		}
	});

	it('rejects an unsafe candidate slug and an unsafe minted slug', () => {
		const land = recordFor(rowNamed('tasking-land'));
		expectRejected(
			() =>
				validateHandoffRecord(
					{
						...land.record,
						products: {
							...SAMPLE['tasking-land'],
							candidates: {'../escape': 'x'},
						},
					},
					{item: land.record.item, rung: land.rung},
				),
			'field',
		);
		const apply = recordFor(rowNamed('apply-decision'));
		expectRejected(
			() =>
				validateHandoffRecord(
					{
						...apply.record,
						products: {...SAMPLE['apply-decision'], slug: '../x'},
					},
					{item: apply.record.item, rung: apply.rung},
				),
			'field',
		);
	});

	it('enforces the cross-field rules of triage and apply-decision', () => {
		const t = recordFor(rowNamed('triage'));
		const tTrust = {item: t.record.item, rung: t.rung};
		for (const products of [
			{disposition: 'map'},
			{disposition: 'keep', target: 'task:x'},
			{disposition: 'duplicate', target: 'task:x', questions: ['q']},
			{disposition: 'map', target: 'task:../x'},
		]) {
			expectRejected(
				() => validateHandoffRecord({...t.record, products}, tTrust),
				'field',
			);
		}
		validateHandoffRecord(
			{...t.record, products: {disposition: 'keep', questions: ['q']}},
			tTrust,
		);
		const a = recordFor(rowNamed('apply-decision'));
		const aTrust = {item: a.record.item, rung: a.rung};
		for (const products of [
			{outcome: 'task', title: 't', body: 'b'},
			{outcome: 'dispose', slug: 'x'},
			{outcome: 'ask'},
			{outcome: 'resolve', questions: ['q']},
		]) {
			expectRejected(
				() => validateHandoffRecord({...a.record, products}, aTrust),
				'field',
			);
		}
		validateHandoffRecord(
			{...a.record, products: {outcome: 'ask', questions: ['q']}},
			aTrust,
		);
	});

	describe('every over-limit text field', () => {
		for (const row of HANDOFF_INTENT_TABLE) {
			for (const [name, spec] of Object.entries(row.record)) {
				if (!('maxChars' in spec)) continue;
				it(`${row.row}.${name}`, () => {
					const {rung, record} = recordFor(
						row,
						LIMIT_SAMPLE[`${row.row}.${name}`] ?? SAMPLE[row.row],
					);
					const over = 'x'.repeat(spec.maxChars + 1);
					const atLimit = 'x'.repeat(spec.maxChars);
					const value = (s: string) =>
						spec.type === 'text-list' || spec.type === 'question-list'
							? [s]
							: spec.type === 'documents'
								? {'a-task': s}
								: s;
					const trust = {item: record.item, rung};
					validateHandoffRecord(
						{...record, products: {...record.products, [name]: value(atLimit)}},
						trust,
					);
					expectRejected(
						() =>
							validateHandoffRecord(
								{
									...record,
									products: {...record.products, [name]: value(over)},
								},
								trust,
							),
						'limit',
					);
				});
			}
		}
	});

	describe('a surfaced question with its context and default', () => {
		const surface = {item: 'task:add-thing', rung: 'surface' as const};
		const triage = {
			item: 'observation:odd-note',
			rung: 'triage-observation' as const,
		};
		const surfaceWith = (questions: unknown) => ({
			...base(),
			products: {questions},
		});
		const keepWith = (questions: unknown) => ({
			...recordFor(rowNamed('triage')).record,
			products: {disposition: 'keep', questions},
		});
		const full = {question: 'Q?', context: 'C.', default: 'D.'};

		it('takes the closed object and the bare text, on surface and triage', () => {
			validateHandoffRecord(
				surfaceWith([full, {question: 'Q2?'}, 'Q3?']),
				surface,
			);
			validateHandoffRecord(keepWith([full, 'Q2?']), triage);
		});

		it('rejects an unknown key in a question', () => {
			for (const check of [
				() =>
					validateHandoffRecord(
						surfaceWith([{...full, kind: 'merge'}]),
						surface,
					),
				() => validateHandoffRecord(keepWith([{...full, id: 'q1'}]), triage),
				() =>
					validateHandoffRecord(
						surfaceWith([{...full, answer: 'yes'}]),
						surface,
					),
			]) {
				expectRejected(check, 'field');
			}
		});

		it('rejects an oversize question, context or default', () => {
			const max = HANDOFF_LIMITS.reasonChars;
			for (const key of ['question', 'context', 'default'] as const) {
				validateHandoffRecord(
					surfaceWith([{...full, [key]: 'x'.repeat(max)}]),
					surface,
				);
				expectRejected(
					() =>
						validateHandoffRecord(
							surfaceWith([{...full, [key]: 'x'.repeat(max + 1)}]),
							surface,
						),
					'limit',
				);
				expectRejected(
					() =>
						validateHandoffRecord(
							keepWith([{...full, [key]: 'x'.repeat(max + 1)}]),
							triage,
						),
					'limit',
				);
			}
		});

		it('rejects a wrong type, a missing question and a control character', () => {
			for (const questions of [
				[42],
				[null],
				[['Q?']],
				[{...full, context: 7}],
				[{...full, default: ['D.']}],
				[{...full, question: {text: 'Q?'}}],
				[{context: 'C.', default: 'D.'}],
				[{...full, context: 'bell\u0007'}],
				{question: 'Q?'},
			]) {
				expectRejected(
					() => validateHandoffRecord(surfaceWith(questions), surface),
					'field',
				);
			}
		});

		it('keeps an ask to question texts', () => {
			const a = recordFor(rowNamed('apply-decision')).record;
			expectRejected(
				() =>
					validateHandoffRecord(
						{...a, products: {outcome: 'ask', questions: [full]}},
						{item: 'observation:odd-note', rung: 'apply'},
					),
				'field',
			);
		});
	});

	it('uses the limits of the spec', () => {
		expect(HANDOFF_LIMITS).toMatchObject({
			artifactBytes: 200 * 1024 * 1024,
			bundleBytes: 100 * 1024 * 1024,
			blobBytes: 20 * 1024 * 1024,
			lfsBytes: 500 * 1024 * 1024,
			handoffJsonBytes: 2 * 1024 * 1024,
			prTitleChars: 72,
			commentChars: 60_000,
			reasonChars: 10_000,
		});
	});
});

describe('artifact rejections', () => {
	const trust = {item: 'task:add-thing', rung: 'surface' as const};
	function writeSurface(dir: string): void {
		writeHandoff({
			dir,
			rung: 'surface',
			record: recordFor(rowNamed('surface')).record,
		});
	}

	it('rejects an over-limit handoff.json', () => {
		const dir = join(runnerTemp, 'h');
		mkdirSync(dir);
		const json = JSON.stringify(recordFor(rowNamed('surface')).record);
		writeFileSync(
			join(dir, HANDOFF_JSON),
			json + ' '.repeat(HANDOFF_LIMITS.handoffJsonBytes + 1 - json.length),
		);
		expectRejected(() => readHandoff({dir, runnerTemp, trust}), 'size');
	});

	it('rejects a handoff.json that is not JSON', () => {
		const dir = join(runnerTemp, 'h');
		mkdirSync(dir);
		writeFileSync(join(dir, HANDOFF_JSON), '{"schema": 1,');
		expectRejected(() => readHandoff({dir, runnerTemp, trust}), 'json');
	});

	it('rejects an unexpected file, directory or LFS entry', () => {
		for (const plant of [
			(d: string) => writeFileSync(join(d, 'extra.txt'), 'x'),
			(d: string) => mkdirSync(join(d, '.git')),
			(d: string) => {
				mkdirSync(join(d, 'lfs'));
				writeFileSync(join(d, 'lfs', 'not-an-oid'), 'x');
			},
			(d: string) => {
				mkdirSync(join(d, 'lfs', 'a'.repeat(64)), {recursive: true});
			},
			(d: string) => mkdirSync(join(d, HANDOFF_BUNDLE)),
		]) {
			const dir = mkdtempSync(join(runnerTemp, 'h-'));
			rmSync(dir, {recursive: true});
			writeSurface(dir);
			plant(dir);
			expectRejected(() => readHandoff({dir, runnerTemp, trust}), 'layout');
		}
	});

	it('rejects a missing handoff.json', () => {
		const dir = join(runnerTemp, 'h');
		mkdirSync(dir);
		expectRejected(() => readHandoff({dir, runnerTemp, trust}), 'layout');
	});

	it('rejects a symlink anywhere in the artifact', () => {
		const outside = join(root, 'secret');
		writeFileSync(
			outside,
			JSON.stringify(recordFor(rowNamed('surface')).record),
		);
		const cases: Array<(d: string) => void> = [
			(d) => {
				rmSync(join(d, HANDOFF_JSON));
				symlinkSync(outside, join(d, HANDOFF_JSON));
			},
			(d) => symlinkSync(outside, join(d, HANDOFF_BUNDLE)),
			(d) => symlinkSync(root, join(d, 'lfs')),
			(d) => {
				mkdirSync(join(d, 'lfs'));
				symlinkSync(outside, join(d, 'lfs', 'b'.repeat(64)));
			},
		];
		for (const plant of cases) {
			const dir = mkdtempSync(join(runnerTemp, 'h-'));
			rmSync(dir, {recursive: true});
			writeSurface(dir);
			plant(dir);
			expectRejected(() => readHandoff({dir, runnerTemp, trust}), 'symlink');
		}
		const real = join(runnerTemp, 'real');
		writeSurface(real);
		const link = join(runnerTemp, 'link');
		symlinkSync(real, link);
		expectRejected(
			() => readHandoff({dir: link, runnerTemp, trust}),
			'symlink',
		);
	});

	it('rejects a directory outside $RUNNER_TEMP', () => {
		const dir = join(root, 'elsewhere');
		writeSurface(dir);
		expectRejected(() => readHandoff({dir, runnerTemp, trust}), 'location');
		expectRejected(
			() => readHandoff({dir: runnerTemp, runnerTemp, trust}),
			'location',
		);
	});

	it('rejects a bundle the intent does not carry, and a missing required one', () => {
		const dir = join(runnerTemp, 'h');
		writeSurface(dir);
		writeFileSync(join(dir, HANDOFF_BUNDLE), '# v2 git bundle\n');
		expectRejected(
			() => readHandoff({dir, runnerTemp, trust}),
			'bundle-presence',
		);

		const build = recordFor(rowNamed('integrate-build'));
		const dir2 = join(runnerTemp, 'h2');
		mkdirSync(dir2);
		writeFileSync(join(dir2, HANDOFF_JSON), JSON.stringify(build.record));
		expectRejected(
			() =>
				readHandoff({
					dir: dir2,
					runnerTemp,
					trust: {item: build.record.item, rung: build.rung},
				}),
			'bundle-presence',
		);
		expectRejected(
			() =>
				writeHandoff({
					dir: join(runnerTemp, 'h3'),
					rung: build.rung,
					record: build.record,
				}),
			'bundle-presence',
		);
	});

	it('rejects LFS objects without a bundle', () => {
		const na = recordFor(rowNamed('needs-attention'));
		const dir = join(runnerTemp, 'h');
		writeHandoff({dir, rung: na.rung, record: na.record});
		mkdirSync(join(dir, 'lfs'));
		writeFileSync(join(dir, 'lfs', 'c'.repeat(64)), 'x');
		expectRejected(
			() =>
				readHandoff({
					dir,
					runnerTemp,
					trust: {item: na.record.item, rung: na.rung},
				}),
			'layout',
		);
	});

	it('lists well-named LFS objects next to a bundle', () => {
		const build = recordFor(rowNamed('integrate-build'));
		const {repo, baseSha} = makeRepo(root);
		const dir = join(runnerTemp, 'h');
		writeHandoff({
			dir,
			rung: build.rung,
			record: build.record,
			bundle: {repo, workBranch: 'work/task-add-thing', baseSha},
		});
		mkdirSync(join(dir, 'lfs'));
		writeFileSync(join(dir, 'lfs', 'd'.repeat(64)), 'abc');
		const read = readHandoff({
			dir,
			runnerTemp,
			trust: {item: build.record.item, rung: build.rung},
		});
		expect(read.lfsObjects).toEqual([
			{oid: 'd'.repeat(64), path: join(dir, 'lfs', 'd'.repeat(64)), size: 3},
		]);
	});

	it('rejects a bundle with more than one ref', () => {
		const build = recordFor(rowNamed('integrate-build'));
		const {repo, baseSha} = makeRepo(root);
		const dir = join(runnerTemp, 'h');
		mkdirSync(dir);
		writeFileSync(join(dir, HANDOFF_JSON), JSON.stringify(build.record));
		sh(repo, 'branch', 'other');
		sh(
			repo,
			'bundle',
			'create',
			join(dir, HANDOFF_BUNDLE),
			'other',
			'work/task-add-thing',
			`^${baseSha}`,
		);
		expectRejected(
			() =>
				readHandoff({
					dir,
					runnerTemp,
					trust: {item: build.record.item, rung: build.rung},
				}),
			'bundle-refs',
		);
	});

	it('rejects a malformed bundle header', () => {
		const oid = 'a'.repeat(40);
		for (const head of [
			'not a bundle\n\n',
			'# v2 git bundle\n' + oid + ' refs/heads/x',
			'# v2 git bundle\n@object-format=sha1\n' + oid + ' refs/heads/x\n\n',
			'# v3 git bundle\n@filter=blob:none\n' + oid + ' refs/heads/x\n\n',
			'# v2 git bundle\n' + oid + ' HEAD\n\n',
			'# v2 git bundle\n-zz\n' + oid + ' refs/heads/x\n\n',
		]) {
			expectRejected(
				() => parseBundleHeader(Buffer.from(head, 'latin1')),
				'bundle-format',
			);
		}
		expectRejected(
			() => parseBundleHeader(Buffer.from('# v2 git bundle\n\n')),
			'bundle-refs',
		);
		expect(
			parseBundleHeader(
				Buffer.from(
					`# v3 git bundle\n@object-format=sha1\n-${oid} base\n${oid} refs/heads/x\n\nPACK`,
				),
			),
		).toEqual({tip: oid, ref: 'refs/heads/x', prerequisites: [oid]});
	});

	it('refuses to write into a non-empty directory', () => {
		const dir = join(runnerTemp, 'h');
		mkdirSync(dir);
		writeFileSync(join(dir, 'x'), 'x');
		expectRejected(() => writeSurface(dir), 'layout');
	});
});

describe('handoffName', () => {
	const ARTIFACT_NAME_FORBIDDEN = /[":<>|*?\r\n\\/]/;

	it('is deterministic and differs between run attempts', () => {
		expect(handoffName('task:add-thing', 1)).toBe(
			handoffName('task:add-thing', '1'),
		);
		expect(handoffName('task:add-thing', 1)).toBe(
			'dorfl-handoff-task-add-thing-attempt-1',
		);
		expect(handoffName('task:add-thing', 2)).not.toBe(
			handoffName('task:add-thing', 1),
		);
	});

	it('is a valid artifact name for every legal item id, and distinct per item', () => {
		const ids = [
			'task:add-thing',
			'spec:add-thing',
			'observation:add-thing',
			'obs:odd',
			'issue:42',
			'issue:9999999',
			'bare-slug',
			'task:Mixed.Case_slug-2',
			`task:${'a'.repeat(120)}`,
		];
		const names = ids.map((id) => handoffName(id, 3));
		for (const name of names) {
			expect(name).not.toMatch(ARTIFACT_NAME_FORBIDDEN);
			expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
		}
		expect(new Set(names).size).toBe(names.length);
		expect(handoffName('obs:odd', 1)).toBe(handoffName('observation:odd', 1));
		expect(handoffName('bare-slug', 1)).toBe(handoffName('task:bare-slug', 1));
	});

	it('refuses an illegal item id or run attempt', () => {
		for (const id of [
			'Fix: the "thing" | now',
			'task:../x',
			'issue:0',
			'issue:4a',
			'',
		]) {
			expectRejected(() => handoffName(id, 1), 'item');
		}
		for (const attempt of [0, -1, 1.5, '1a', '']) {
			expectRejected(() => handoffName('task:x', attempt), 'name');
		}
	});

	it('canonicalises items as the rest of dorfl does', () => {
		expect(canonicalHandoffItem('x')).toBe('task:x');
		expect(canonicalHandoffItem('obs:x')).toBe('observation:x');
		expect(canonicalHandoffItem('spec:x')).toBe('spec:x');
		expect(canonicalHandoffItem('issue:7')).toBe('issue:7');
	});
});
