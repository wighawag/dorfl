import {describe, it, expect} from 'vitest';
import {
	classifyTick,
	isAdvanceable,
	type TickClassification,
	type TickRungKind,
} from '../src/advance-classify.js';
import {
	newSidecar,
	appendQuestions,
	allAnswered,
	pendingEntries,
	type SidecarModel,
	type SidecarType,
} from '../src/sidecar.js';

// --- Sidecar fixtures (built via the keystone — never hand-rolled) ---------

const IDENTITY_FOR: Record<SidecarType, string> = {
	slice: 'slice:foo',
	prd: 'prd:foo',
	observation: 'observation:foo',
};

/** A sidecar with `open` unanswered + `answered` answered entries (in that order). */
function sidecarWith(
	type: SidecarType,
	open: number,
	answered: number,
): SidecarModel {
	const total = open + answered;
	let model = newSidecar(
		IDENTITY_FOR[type],
		Array.from({length: total}, (_, i) => ({question: `Q${i + 1}?`})),
	);
	// Answer the LAST `answered` entries (leaving the first `open` pending).
	model = {
		...model,
		entries: model.entries.map((entry, i) =>
			i >= open ? {...entry, answer: 'an answer'} : entry,
		),
	};
	return model;
}

const ALL_TYPES: SidecarType[] = ['slice', 'prd', 'observation'];

/** The per-type ANALYSE rung (no open questions, no sidecar). */
const ANALYSE_RUNG: Record<SidecarType, TickRungKind> = {
	slice: 'build-slice',
	prd: 'slice-prd',
	observation: 'triage-observation',
};

// --- Sanity on the fixtures (the two signals are wired off the entries) ----

describe('sidecar fixtures (built via the keystone)', () => {
	it('a pure-open sidecar is pending (not all answered)', () => {
		const s = sidecarWith('prd', 2, 0);
		expect(allAnswered(s)).toBe(false);
		expect(pendingEntries(s)).toHaveLength(2);
	});

	it('a subset-answered sidecar is still pending', () => {
		const s = sidecarWith('prd', 1, 1);
		expect(allAnswered(s)).toBe(false);
		expect(pendingEntries(s)).toHaveLength(1);
	});

	it('a fully-answered sidecar is all answered', () => {
		const s = sidecarWith('prd', 0, 2);
		expect(allAnswered(s)).toBe(true);
		expect(pendingEntries(s)).toHaveLength(0);
	});
});

// --- The per-TYPE transition table (every cell) ----------------------------

interface Cell {
	label: string;
	needsAnswers: boolean | undefined;
	/** How to build the sidecar input for this cell, per type. */
	sidecar: (type: SidecarType) => SidecarModel | undefined;
	/** The expected rung kind (the per-type ANALYSE rung resolves per type). */
	expected: (type: SidecarType) => TickRungKind;
	reason?: TickClassification['reason'];
	advanceable: boolean;
}

const CELLS: Cell[] = [
	{
		// needsAnswers:false + no sidecar → ANALYSE (the per-type rung).
		label: 'no questions, no sidecar → ANALYSE (per-type rung)',
		needsAnswers: undefined,
		sidecar: () => undefined,
		expected: (type) => ANALYSE_RUNG[type],
		advanceable: true,
	},
	{
		// Explicit `needsAnswers:false` behaves exactly like undeclared.
		label: 'needsAnswers:false, no sidecar → ANALYSE (per-type rung)',
		needsAnswers: false,
		sidecar: () => undefined,
		expected: (type) => ANALYSE_RUNG[type],
		advanceable: true,
	},
	{
		// needsAnswers:true + no sidecar → surface (first-pass question gen).
		label: 'needsAnswers, no sidecar → surface',
		needsAnswers: true,
		sidecar: () => undefined,
		expected: () => 'surface',
		advanceable: true,
	},
	{
		// needsAnswers:true + pending (none answered) → NO-OP.
		label: 'needsAnswers, pending sidecar (none answered) → NO-OP',
		needsAnswers: true,
		sidecar: (type) => sidecarWith(type, 2, 0),
		expected: () => 'no-op',
		reason: 'pending-sidecar',
		advanceable: false,
	},
	{
		// needsAnswers:true + SUBSET answered → still pending → NO-OP (SKIP).
		label: 'needsAnswers, subset answered → NO-OP (SKIP)',
		needsAnswers: true,
		sidecar: (type) => sidecarWith(type, 1, 1),
		expected: () => 'no-op',
		reason: 'pending-sidecar',
		advanceable: false,
	},
	{
		// needsAnswers:true + ALL answered → apply (apply + advance).
		label: 'needsAnswers, all answered → apply',
		needsAnswers: true,
		sidecar: (type) => sidecarWith(type, 0, 2),
		expected: () => 'apply',
		advanceable: true,
	},
];

describe('classifyTick — the per-TYPE transition table (every cell)', () => {
	for (const type of ALL_TYPES) {
		describe(`type=${type}`, () => {
			for (const cell of CELLS) {
				it(`${cell.label}`, () => {
					const result = classifyTick({
						type,
						needsAnswers: cell.needsAnswers,
						sidecar: cell.sidecar(type),
					});
					expect(result.kind).toBe(cell.expected(type));
					expect(result.type).toBe(type);
					if (cell.reason !== undefined) {
						expect(result.reason).toBe(cell.reason);
					}
					expect(isAdvanceable(result)).toBe(cell.advanceable);
				});
			}
		});
	}
});

// --- The two invariants (asserted at the classifier boundary) --------------

describe('classifyTick — invariant 1: needsAnswers:false ⟺ no active sidecar', () => {
	for (const type of ALL_TYPES) {
		it(`type=${type}: a sidecar WITHOUT needsAnswers is refused (invariant-violation)`, () => {
			const result = classifyTick({
				type,
				needsAnswers: false,
				sidecar: sidecarWith(type, 1, 0),
			});
			expect(result.kind).toBe('invariant-violation');
			expect(result.reason).toBe('sidecar-without-needsAnswers');
			expect(isAdvanceable(result)).toBe(false);
		});

		it(`type=${type}: undeclared needsAnswers with a sidecar is ALSO refused`, () => {
			const result = classifyTick({
				type,
				needsAnswers: undefined,
				sidecar: sidecarWith(type, 0, 1),
			});
			expect(result.kind).toBe('invariant-violation');
			expect(result.reason).toBe('sidecar-without-needsAnswers');
		});

		it(`type=${type}: needsAnswers:false with NO sidecar is the clean (consistent) state`, () => {
			const result = classifyTick({
				type,
				needsAnswers: false,
				sidecar: undefined,
			});
			expect(result.kind).toBe(ANALYSE_RUNG[type]);
		});
	}
});

describe('classifyTick — invariant 2: a pending sidecar ⇒ NO-OP', () => {
	for (const type of ALL_TYPES) {
		it(`type=${type}: a fully-open sidecar is a clean NO-OP`, () => {
			const result = classifyTick({
				type,
				needsAnswers: true,
				sidecar: sidecarWith(type, 3, 0),
			});
			expect(result.kind).toBe('no-op');
			expect(result.reason).toBe('pending-sidecar');
		});

		it(`type=${type}: a one-short sidecar (all but one answered) is STILL a NO-OP`, () => {
			const result = classifyTick({
				type,
				needsAnswers: true,
				sidecar: sidecarWith(type, 1, 4),
			});
			expect(result.kind).toBe('no-op');
			expect(result.reason).toBe('pending-sidecar');
		});
	}
});

// --- Append-re-pause: an all-answered sidecar with appended Qs re-pauses ----

describe('classifyTick — append flips all-answered back to pending (re-pause)', () => {
	it('appending a new question to an all-answered sidecar re-NO-OPs the tick', () => {
		// All answered → apply.
		const answered = sidecarWith('prd', 0, 2);
		expect(
			classifyTick({type: 'prd', needsAnswers: true, sidecar: answered}).kind,
		).toBe('apply');
		// Apply appends a fresh (pending) question → re-pauses → NO-OP.
		const repaused = appendQuestions(answered, [{question: 'A follow-up?'}]);
		const result = classifyTick({
			type: 'prd',
			needsAnswers: true,
			sidecar: repaused,
		});
		expect(result.kind).toBe('no-op');
		expect(result.reason).toBe('pending-sidecar');
	});
});

// --- Clear+delete / terminal-cleanup: the post-resolution consistent state --

describe('classifyTick — clear+delete leaves the consistent terminal state', () => {
	for (const type of ALL_TYPES) {
		it(`type=${type}: after resolution (needsAnswers cleared + sidecar deleted) → ANALYSE`, () => {
			// The atomic clear+delete (the executor's step) leaves
			// needsAnswers:false + no sidecar — the consistent state that re-enters
			// the ANALYSE branch (the next lifecycle rung), never a stuck NO-OP.
			const result = classifyTick({
				type,
				needsAnswers: false,
				sidecar: undefined,
			});
			expect(result.kind).toBe(ANALYSE_RUNG[type]);
			expect(isAdvanceable(result)).toBe(true);
		});
	}
});

// --- Convergence: a pending pool is STABLE; it shrinks as answers arrive ----

describe('classifyTick — convergence (read-only, classifier level)', () => {
	it('a pending-sidecar pool is STABLE/NO-OP under repeated ticks (no thrash)', () => {
		const pool = ALL_TYPES.map((type) => ({
			type,
			needsAnswers: true as const,
			sidecar: sidecarWith(type, 2, 0),
		}));
		// Tick the whole pool twice — identical, all NO-OP, no churn.
		for (let pass = 0; pass < 2; pass++) {
			for (const item of pool) {
				const result = classifyTick(item);
				expect(result.kind).toBe('no-op');
				expect(isAdvanceable(result)).toBe(false);
			}
		}
	});

	it('the advanceable pool shrinks monotonically as answers arrive', () => {
		// Three PRD items, each with two open questions. As the human answers, an
		// item flips pending → (all answered) apply; the NO-OP count only falls.
		const sidecars = [
			sidecarWith('prd', 2, 0),
			sidecarWith('prd', 2, 0),
			sidecarWith('prd', 2, 0),
		];

		const noOpCount = () =>
			sidecars.filter(
				(sidecar) =>
					classifyTick({type: 'prd', needsAnswers: true, sidecar}).kind ===
					'no-op',
			).length;

		// Answer EVERY entry of one sidecar (the all-or-nothing apply gate).
		const answerAll = (idx: number) => {
			sidecars[idx] = {
				...sidecars[idx],
				entries: sidecars[idx].entries.map((e) => ({...e, answer: 'a'})),
			};
		};

		expect(noOpCount()).toBe(3);
		answerAll(0);
		expect(noOpCount()).toBe(2);
		answerAll(1);
		expect(noOpCount()).toBe(1);
		answerAll(2);
		expect(noOpCount()).toBe(0);
	});

	it('a SUBSET-answered item does NOT leave the NO-OP pool (no premature advance)', () => {
		// Answering only SOME entries keeps the item pending → still NO-OP (the
		// loop never thrashes on a half-answered item; the human answers all first).
		let sidecar = sidecarWith('prd', 2, 0);
		expect(classifyTick({type: 'prd', needsAnswers: true, sidecar}).kind).toBe(
			'no-op',
		);
		// Answer ONE of the two.
		sidecar = {
			...sidecar,
			entries: sidecar.entries.map((e, i) =>
				i === 0 ? {...e, answer: 'a'} : e,
			),
		};
		expect(classifyTick({type: 'prd', needsAnswers: true, sidecar}).kind).toBe(
			'no-op',
		);
	});
});
