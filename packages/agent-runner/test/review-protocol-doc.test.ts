/**
 * Slice `review-protocol-doc-and-shared-machinery`: the keystone protocol-doc
 * + shared-machinery proof, end-to-end.
 *
 * This suite covers:
 *   - The setup mirror (the doc lands in `work/protocol/` byte-identical to the
 *     `skills/setup/protocol/` source-of-truth) and `work/protocol/VERSION` is
 *     bumped past the pre-slice value.
 *   - The vendored set ships `dist/protocol/REVIEW-PROTOCOL.md` alongside
 *     `dist/protocol/CLAIM-PROTOCOL.md` (the SET vendor, not the old
 *     single-file).
 *   - The per-discipline shape DRIFT GUARD: a canonical verdict fixture both
 *     PARSES via the unified `parseReviewVerdict` AND matches the prose shape
 *     `REVIEW-PROTOCOL.md` describes.
 *   - The four review-prompt builders REFERENCE `REVIEW-PROTOCOL.md` (in-band
 *     discipline) and the shared verdict-contract helper, and NONE re-inlines
 *     the lenses (the "lenses IN ORDER" tagline appears at most once \u2014 from
 *     the shared helper, never duplicated in the builder body).
 */
import {describe, it, expect} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseReviewVerdict, type ReviewVerdict} from '../src/review-verdict.js';
import {
	buildReviewPrompt,
	buildSliceAcceptancePrompt,
} from '../src/review-gate.js';
import {buildSliceReviewPrompt} from '../src/slicer-review-loop.js';
import {buildLoneSliceReviewPrompt} from '../src/intake.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SOURCE = resolve(REPO, 'skills', 'setup', 'protocol');
const MIRROR = resolve(REPO, 'work', 'protocol');
const VENDORED = resolve(HERE, '..', 'dist', 'protocol');

describe('REVIEW-PROTOCOL.md \u2014 the new in-band review discipline doc', () => {
	it('exists at the SOURCE-of-truth location (`skills/setup/protocol/`)', () => {
		expect(existsSync(resolve(SOURCE, 'REVIEW-PROTOCOL.md'))).toBe(true);
	});

	it('is mirrored BYTE-IDENTICAL into `work/protocol/` (the propagated copy)', () => {
		const src = readFileSync(resolve(SOURCE, 'REVIEW-PROTOCOL.md'), 'utf8');
		const mirror = readFileSync(resolve(MIRROR, 'REVIEW-PROTOCOL.md'), 'utf8');
		expect(mirror).toBe(src);
	});

	it('carries the full review discipline content (lenses + destination check + verdict shape prose)', () => {
		const doc = readFileSync(resolve(SOURCE, 'REVIEW-PROTOCOL.md'), 'utf8');
		// The five lenses + the destination check (the protocol body).
		expect(doc).toMatch(/claim-vs-reality/i);
		expect(doc).toMatch(/cleanup-vs-behaviour/i);
		expect(doc).toMatch(/cross-artifact composition/i);
		expect(doc).toMatch(/conceptual coherence/i);
		expect(doc).toMatch(/destination check/i);
		// The prose-description of the emitted verdict shape (D2).
		expect(doc).toMatch(/verdict/);
		expect(doc).toMatch(/findings/);
		expect(doc).toMatch(/blocking.*non-blocking|non-blocking.*blocking/s);
	});

	it('`setup` propagation: `work/protocol/VERSION` is bumped (set propagated through `setup`)', () => {
		// The setup contract: when the protocol-doc set grows / changes, VERSION
		// bumps. We assert against the pre-slice value (2026-06-09) to prove the
		// bump happened; the exact post value is left to the slice that ships it.
		const version = readFileSync(resolve(MIRROR, 'VERSION'), 'utf8');
		expect(version).toMatch(/protocol-version:\s*\d{4}-\d{2}-\d{2}/);
		const match = /protocol-version:\s*(\d{4}-\d{2}-\d{2})/.exec(version);
		expect(match).toBeTruthy();
		expect(match![1] > '2026-06-09').toBe(true);
	});
});

describe('vendor-protocol.mjs \u2014 ships the SET (CLAIM + REVIEW), not a single file', () => {
	it('vendors `dist/protocol/CLAIM-PROTOCOL.md` (the keep-existing case)', () => {
		expect(existsSync(resolve(VENDORED, 'CLAIM-PROTOCOL.md'))).toBe(true);
	});

	it('vendors `dist/protocol/REVIEW-PROTOCOL.md` (the new set-vendor proof)', () => {
		expect(existsSync(resolve(VENDORED, 'REVIEW-PROTOCOL.md'))).toBe(true);
		const vendored = readFileSync(
			resolve(VENDORED, 'REVIEW-PROTOCOL.md'),
			'utf8',
		);
		expect(vendored).toMatch(/destination check/i);
	});

	it('the vendored REVIEW-PROTOCOL.md is BYTE-IDENTICAL to the source-of-truth', () => {
		const src = readFileSync(resolve(SOURCE, 'REVIEW-PROTOCOL.md'), 'utf8');
		const vendored = readFileSync(
			resolve(VENDORED, 'REVIEW-PROTOCOL.md'),
			'utf8',
		);
		expect(vendored).toBe(src);
	});
});

describe('Per-discipline shape DRIFT GUARD \u2014 canonical fixture parses AND matches the doc', () => {
	const fixture = {
		verdict: 'block',
		findings: [
			{
				severity: 'blocking',
				question: 'the diff misses the destination-check element X',
				context: 'src/foo.ts:42',
			},
			{
				severity: 'non-blocking',
				question: 'the name `bar` could be tighter',
			},
		],
		review:
			'Blocked. Lens 1 finds X is unaddressed; the destination check fails.',
		edits: [
			{path: 'work/tasks/backlog/a.md', content: '## What to build\n\n\u2026'},
		],
		edit: '## What to build\n\nthe tightened body',
		questions: ['what should X do when Y?'],
		uncertainSlices: [
			{
				path: 'work/tasks/backlog/b.md',
				questions: ['can this be made buildable?'],
			},
		],
		decompositionUnclear: {questions: ['is the whole shape right?']},
	};

	it('the unified parser accepts a canonical verdict carrying ALL channels', () => {
		const parsed = parseReviewVerdict(JSON.stringify(fixture));
		expect(parsed.verdict).toBe('block');
		expect(parsed.findings).toHaveLength(2);
		expect(parsed.findings[0].severity).toBe('blocking');
		expect(parsed.review).toMatch(/Blocked/);
		expect(parsed.edits?.[0].path).toBe('work/tasks/backlog/a.md');
		expect(parsed.edit).toMatch(/tightened body/);
		expect(parsed.questions).toEqual(['what should X do when Y?']);
		expect(parsed.uncertainSlices?.[0].path).toBe('work/tasks/backlog/b.md');
		expect(parsed.decompositionUnclear?.questions).toHaveLength(1);
	});

	it('every channel the fixture exercises is DESCRIBED in REVIEW-PROTOCOL.md (the doc mirrors the parser; D2)', () => {
		const doc = readFileSync(resolve(SOURCE, 'REVIEW-PROTOCOL.md'), 'utf8');
		// The required fields.
		expect(doc).toMatch(/\bverdict\b/);
		expect(doc).toMatch(/\bfindings\b/);
		expect(doc).toMatch(/\bseverity\b/);
		expect(doc).toMatch(/\bquestion\b/);
		expect(doc).toMatch(/\bcontext\b/);
		// The optional channels each have a prose description in the doc.
		expect(doc).toMatch(/\breview\b/);
		expect(doc).toMatch(/\bedits\b/);
		expect(doc).toMatch(/\bedit\b/);
		expect(doc).toMatch(/\bquestions\b/);
		expect(doc).toMatch(/\buncertainSlices\b/);
		expect(doc).toMatch(/\bdecompositionUnclear\b/);
	});

	it('typed access on the unified verdict compiles for every channel (single type, one parser)', () => {
		const v: ReviewVerdict = parseReviewVerdict(JSON.stringify(fixture));
		// Touching each typed channel proves the type unifies them.
		const _check: [string, number, string?, number?, string?, number?] = [
			v.verdict,
			v.findings.length,
			v.review,
			v.edits?.length,
			v.edit,
			v.uncertainSlices?.length,
		];
		expect(_check[0]).toBe('block');
	});
});

describe('The four review-prompt builders \u2014 in-band reference + no re-inlined discipline prose', () => {
	const prompts = [
		{name: 'buildReviewPrompt', text: buildReviewPrompt('alpha')},
		{
			name: 'buildSliceAcceptancePrompt',
			text: buildSliceAcceptancePrompt('alpha'),
		},
		{
			name: 'buildSliceReviewPrompt',
			text: buildSliceReviewPrompt({
				slug: 'alpha',
				cwd: '/tmp/x',
				candidateSlices: ['work/tasks/backlog/a.md'],
				pass: 1,
				execution: 1,
			}),
		},
		{
			name: 'buildLoneSliceReviewPrompt',
			text: buildLoneSliceReviewPrompt({
				slug: 'add-quiet-flag',
				issueNumber: 42,
				title: 'Add a --quiet flag',
				body: '## What to build\n\nA --quiet flag.',
				round: 1,
				cwd: '/tmp/x',
			}),
		},
	];

	for (const {name, text} of prompts) {
		it(`${name} REFERENCES \`work/protocol/REVIEW-PROTOCOL.md\` (the in-band discipline)`, () => {
			expect(text).toMatch(/work\/protocol\/REVIEW-PROTOCOL\.md/);
		});

		it(`${name} demands a single JSON verdict (via the shared verdict-contract helper)`, () => {
			expect(text).toMatch(/single JSON object/i);
			expect(text).toMatch(/"verdict"/);
			expect(text).toMatch(/"findings"/);
		});

		it(`${name} does NOT re-inline the discipline lenses verbatim`, () => {
			// The "lenses IN ORDER" tagline is the discipline's hallmark prose; it
			// appears ONCE in the shared discipline-prompt helper. A builder that
			// re-inlines it would show it more than once.
			const matches = text.match(/lenses IN ORDER/g) ?? [];
			expect(matches.length).toBeLessThanOrEqual(1);
		});
	}
});
