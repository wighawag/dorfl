/**
 * Slice `surface-protocol-doc-and-prompt`: the surface-questions discipline,
 * relocated in-band as `SURFACE-PROTOCOL.md`, on the shared machinery built by
 * the keystone slice (`review-protocol-doc-and-shared-machinery`).
 *
 * This suite covers:
 *   - The setup mirror (the doc lands in `work/protocol/` byte-identical to the
 *     `skills/setup/protocol/` source-of-truth) and `work/protocol/VERSION` is
 *     bumped past the pre-slice value.
 *   - The vendored set ships `dist/protocol/SURFACE-PROTOCOL.md` alongside
 *     `CLAIM-PROTOCOL.md` + `REVIEW-PROTOCOL.md` (the SET vendor, not a
 *     special-case).
 *   - The per-discipline shape DRIFT GUARD (D2): a canonical surface-emit
 *     fixture both PARSES via `parseSurfaceEmit` AND matches the prose shape
 *     `SURFACE-PROTOCOL.md` describes.
 *   - `buildSurfacePrompt` REFERENCES `SURFACE-PROTOCOL.md` (in-band
 *     discipline) and does NOT re-inline the laws / humility rule (the
 *     prompt-snapshot guard against re-emerging duplication).
 *   - `skills/surface-questions/SKILL.md` is a thin human-facing pointer at
 *     the protocol doc (the operator entry point; the standard lives in the
 *     protocol doc, not the skill).
 */
import {describe, it, expect} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	buildSurfacePrompt,
	parseSurfaceEmit,
	type SurfaceEmit,
} from '../src/surface-gate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SOURCE = resolve(REPO, 'skills', 'setup', 'protocol');
const MIRROR = resolve(REPO, 'work', 'protocol');
const VENDORED = resolve(HERE, '..', 'dist', 'protocol');
const SKILL = resolve(REPO, 'skills', 'surface-questions', 'SKILL.md');

describe('SURFACE-PROTOCOL.md \u2014 the new in-band surface-questions discipline doc', () => {
	it('exists at the SOURCE-of-truth location (`skills/setup/protocol/`)', () => {
		expect(existsSync(resolve(SOURCE, 'SURFACE-PROTOCOL.md'))).toBe(true);
	});

	it('is mirrored BYTE-IDENTICAL into `work/protocol/` (the propagated copy)', () => {
		const src = readFileSync(resolve(SOURCE, 'SURFACE-PROTOCOL.md'), 'utf8');
		const mirror = readFileSync(resolve(MIRROR, 'SURFACE-PROTOCOL.md'), 'utf8');
		expect(mirror).toBe(src);
	});

	it('carries the full surface-questions discipline (two laws + humility + composed sources + shape)', () => {
		const doc = readFileSync(resolve(SOURCE, 'SURFACE-PROTOCOL.md'), 'utf8');
		// The two laws (verbatim from the source skill).
		expect(doc).toMatch(/GATHER-only/);
		expect(doc).toMatch(/PERSIST-NEVER/);
		// The humility rule \u2014 the heart of the discipline.
		expect(doc).toMatch(/NEVER invent an answer/i);
		expect(doc).toMatch(/humility rule/i);
		// What you compose (the three single sources).
		expect(doc).toMatch(/review/);
		expect(doc).toMatch(/observation-triage/i);
		expect(doc).toMatch(/pre-existing/i);
		// The prose-description of the emitted-question shape (D2).
		expect(doc).toMatch(/\bitem\b/);
		expect(doc).toMatch(/\bquestions\b/);
		expect(doc).toMatch(/\bquestion\b/);
		expect(doc).toMatch(/\bcontext\b/);
		expect(doc).toMatch(/\bdefault\b/);
		expect(doc).toMatch(/\bdisposition\b/);
		// The disposition vocabulary (the live sidecar values, verbatim).
		expect(doc).toMatch(/promote-slice/);
		expect(doc).toMatch(/promote-adr/);
		expect(doc).toMatch(/needs-attention/);
		expect(doc).toMatch(/dropped/);
	});

	it('`setup` propagation: `work/protocol/VERSION` is bumped past the pre-slice value', () => {
		// The setup contract: when the protocol-doc set grows / changes, VERSION
		// bumps. The pre-slice value (set by the keystone) is 2026-06-22 \u2014 this
		// slice's bump must exceed it.
		const version = readFileSync(resolve(MIRROR, 'VERSION'), 'utf8');
		expect(version).toMatch(/protocol-version:\s*\d{4}-\d{2}-\d{2}/);
		const match = /protocol-version:\s*(\d{4}-\d{2}-\d{2})/.exec(version);
		expect(match).toBeTruthy();
		expect(match![1] > '2026-06-22').toBe(true);
	});
});

describe('vendor-protocol.mjs \u2014 the SET now ships SURFACE-PROTOCOL.md too', () => {
	it('keeps vendoring `dist/protocol/CLAIM-PROTOCOL.md` and `REVIEW-PROTOCOL.md`', () => {
		expect(existsSync(resolve(VENDORED, 'CLAIM-PROTOCOL.md'))).toBe(true);
		expect(existsSync(resolve(VENDORED, 'REVIEW-PROTOCOL.md'))).toBe(true);
	});

	it('vendors `dist/protocol/SURFACE-PROTOCOL.md` (the new set member)', () => {
		expect(existsSync(resolve(VENDORED, 'SURFACE-PROTOCOL.md'))).toBe(true);
		const vendored = readFileSync(
			resolve(VENDORED, 'SURFACE-PROTOCOL.md'),
			'utf8',
		);
		expect(vendored).toMatch(/humility rule/i);
	});

	it('the vendored SURFACE-PROTOCOL.md is BYTE-IDENTICAL to the source-of-truth', () => {
		const src = readFileSync(resolve(SOURCE, 'SURFACE-PROTOCOL.md'), 'utf8');
		const vendored = readFileSync(
			resolve(VENDORED, 'SURFACE-PROTOCOL.md'),
			'utf8',
		);
		expect(vendored).toBe(src);
	});
});

describe('Per-discipline shape DRIFT GUARD \u2014 canonical fixture parses AND matches the doc', () => {
	const fixture = {
		item: 'task:foo',
		questions: [
			{
				question: 'which default applies?',
				context: 'src/foo.ts:42',
				default: 'use A',
			},
			{
				question: 'what becomes of this signal?',
				context: 'an exact duplicate of bar',
				default: 'keep',
				disposition: 'keep',
			},
		],
	};

	it('the parser accepts a canonical emit (item + a mix of plain + triage questions)', () => {
		const parsed: SurfaceEmit = parseSurfaceEmit(JSON.stringify(fixture));
		expect(parsed.item).toBe('task:foo');
		expect(parsed.questions).toHaveLength(2);
		expect(parsed.questions[0].context).toBe('src/foo.ts:42');
		expect(parsed.questions[0].default).toBe('use A');
		expect(parsed.questions[1].disposition).toBe('keep');
	});

	it('every field the fixture exercises is DESCRIBED in SURFACE-PROTOCOL.md (the doc mirrors the parser; D2)', () => {
		const doc = readFileSync(resolve(SOURCE, 'SURFACE-PROTOCOL.md'), 'utf8');
		// Each authoring field the parser reads must appear in the doc's prose.
		expect(doc).toMatch(/\bquestion\b/);
		expect(doc).toMatch(/\bcontext\b/);
		expect(doc).toMatch(/\bdefault\b/);
		expect(doc).toMatch(/\bdisposition\b/);
		expect(doc).toMatch(/\bitem\b/);
		// An EMPTY questions array is the honest "no open judgement" result \u2014 the
		// doc must say so (the parser accepts it, the doc explains it).
		expect(doc).toMatch(/empty/i);
	});

	it('an EMPTY questions array is VALID per both parser AND doc (no silent surface)', () => {
		const empty = parseSurfaceEmit('{"item":"task:foo","questions":[]}');
		expect(empty.questions).toEqual([]);
		const doc = readFileSync(resolve(SOURCE, 'SURFACE-PROTOCOL.md'), 'utf8');
		expect(doc).toMatch(/empty[\s\S]{0,80}valid|valid[\s\S]{0,80}empty/i);
	});
});

describe('buildSurfacePrompt \u2014 in-band reference + no re-inlined discipline prose', () => {
	const prompt = buildSurfacePrompt('task:foo');

	it('REFERENCES `work/protocol/SURFACE-PROTOCOL.md` (the in-band discipline)', () => {
		expect(prompt).toMatch(/work\/protocol\/SURFACE-PROTOCOL\.md/);
	});

	it('demands the single JSON {item, questions} emit', () => {
		expect(prompt).toMatch(/single JSON object/i);
		expect(prompt).toMatch(/"item"/);
		expect(prompt).toMatch(/"questions"/);
	});

	it('does NOT re-inline the two laws / humility rule (lives in the protocol doc now)', () => {
		expect(prompt).not.toMatch(/GATHER-only/);
		expect(prompt).not.toMatch(/PERSIST-NEVER/);
		expect(prompt).not.toMatch(/NEVER invent an answer/i);
		expect(prompt).not.toMatch(/HUMILITY RULE/i);
		// The "Run the surface-questions skill" framing is gone too \u2014 we reference
		// the protocol DOC the skill points at, not the host-installed skill.
		expect(prompt).not.toMatch(/Run the `surface-questions` skill/);
	});
});

describe('skills/surface-questions/SKILL.md \u2014 a thin human-facing pointer', () => {
	const skill = readFileSync(SKILL, 'utf8');

	it('preserves the model-invoked frontmatter description', () => {
		expect(skill).toMatch(/^---/);
		expect(skill).toMatch(/name:\s*surface-questions/);
		expect(skill).toMatch(/description:/);
		expect(skill).toMatch(/GATHER the open-judgement residue/);
	});

	it('points at the protocol doc as the source of truth (not duplicating the discipline)', () => {
		expect(skill).toMatch(/work\/protocol\/SURFACE-PROTOCOL\.md/);
		expect(skill).toMatch(/skills\/setup\/protocol\/SURFACE-PROTOCOL\.md/);
	});

	it('is THIN \u2014 the full discipline body no longer lives here', () => {
		// The skill used to carry the whole discipline (~9KB+). After thinning it
		// is a short human-facing pointer; size is a coarse but effective guard.
		expect(skill.length).toBeLessThan(2500);
		// And the two laws / humility prose have moved OUT.
		expect(skill).not.toMatch(/GATHER-only\.\s+Your job/);
		expect(skill).not.toMatch(/PERSIST-NEVER\.\s+You EMIT/);
		expect(skill).not.toMatch(/The humility rule/i);
	});
});
