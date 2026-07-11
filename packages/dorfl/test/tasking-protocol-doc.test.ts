/**
 * The tasking discipline, relocated in-band as `TASKING-PROTOCOL.md`, on the
 * shared machinery built by the keystone task
 * (`review-protocol-doc-and-shared-machinery`) and extended by the surface
 * task. The third + last runner-invoked discipline.
 *
 * This suite covers:
 *   - The setup mirror (the doc lands in `work/protocol/` byte-identical to
 *     the `skills/setup/protocol/` source-of-truth) and
 *     `work/protocol/VERSION` is bumped past the pre-task value.
 *   - The vendored set ships `dist/protocol/TASKING-PROTOCOL.md` alongside the
 *     other runtime-read docs (the SET vendor, not a special case).
 *   - The per-discipline shape DRIFT GUARD (D2): a canonical task fixture
 *     both PARSES via the frontmatter parser AND matches the prose
 *     shape `TASKING-PROTOCOL.md` describes.
 *   - The tasking prompt builder REFERENCES `TASKING-PROTOCOL.md` (in-band
 *     discipline), does NOT re-inline the confidence-check / `humanOnly` rules
 *     (the prompt-snapshot guard against re-emerging duplication), AND no
 *     longer carries the stale pre-rename vocabulary (`to-tasks`,
 *     `work/backlog/`, `work/prd/`) the prd calls out as a bonus bug.
 *   - `skills/to-task/SKILL.md` is a thin human-facing pointer at the
 *     protocol doc, still USER-invoked (`disable-model-invocation: true` \u2014
 *     the to-task skill is reached for, never spawned by the runner).
 */
import {describe, it, expect} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseFrontmatter} from '../src/frontmatter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SOURCE = resolve(REPO, 'skills', 'setup', 'protocol');
const MIRROR = resolve(REPO, 'work', 'protocol');
const VENDORED = resolve(HERE, '..', 'dist', 'protocol');
const SKILL = resolve(REPO, 'skills', 'to-task', 'SKILL.md');
const TASKING_SRC = resolve(REPO, 'packages', 'dorfl', 'src', 'tasking.ts');

describe('TASKING-PROTOCOL.md \u2014 the in-band tasking discipline doc', () => {
	it('exists at the SOURCE-of-truth location (`skills/setup/protocol/`)', () => {
		expect(existsSync(resolve(SOURCE, 'TASKING-PROTOCOL.md'))).toBe(true);
	});

	it('is mirrored BYTE-IDENTICAL into `work/protocol/` (the propagated copy)', () => {
		const src = readFileSync(resolve(SOURCE, 'TASKING-PROTOCOL.md'), 'utf8');
		const mirror = readFileSync(resolve(MIRROR, 'TASKING-PROTOCOL.md'), 'utf8');
		expect(mirror).toBe(src);
	});

	it('carries the full tasking discipline (tracer-bullet rules + two-axis gate + confidence check + file-orthogonality)', () => {
		const doc = readFileSync(resolve(SOURCE, 'TASKING-PROTOCOL.md'), 'utf8');
		// The tracer-bullet rule (verbatim from the source skill).
		expect(doc).toMatch(/tracer bullet/i);
		expect(doc).toMatch(/vertical/i);
		// The two-axis gate guidance.
		expect(doc).toMatch(/humanOnly/);
		expect(doc).toMatch(/needsAnswers/);
		expect(doc).toMatch(/NARROW/);
		// The confidence check that replaces the human-quiz step.
		expect(doc).toMatch(/confidence check/i);
		// File-orthogonality \u2014 the merge-conflict-minimisation rule.
		expect(doc).toMatch(/file-orthogonal/i);
		// The spec-vs-task gate disjointness.
		expect(doc).toMatch(/DISJOINT/);
		expect(doc).toMatch(/taskedAfter/);
		// The prose-description of the emitted task shape (D2).
		expect(doc).toMatch(/emitted task shape/i);
		expect(doc).toMatch(/\btitle\b/);
		expect(doc).toMatch(/\bslug\b/);
		expect(doc).toMatch(/\bspec\b/);
		expect(doc).toMatch(/\bblockedBy\b/);
		expect(doc).toMatch(/\bcovers\b/);
		// The placement rule \u2014 staging vs pool.
		expect(doc).toMatch(/work\/tasks\/backlog/);
		expect(doc).toMatch(/work\/tasks\/ready/);
	});

	it('`setup` propagation: `work/protocol/VERSION` is bumped past the pre-task value', () => {
		// The pre-task value (set by the surface task) is 2026-06-23 \u2014 this
		// task's bump must exceed it.
		const version = readFileSync(resolve(MIRROR, 'VERSION'), 'utf8');
		expect(version).toMatch(/protocol-version:\s*\d{4}-\d{2}-\d{2}/);
		const match = /protocol-version:\s*(\d{4}-\d{2}-\d{2})/.exec(version);
		expect(match).toBeTruthy();
		expect(match![1] > '2026-06-23').toBe(true);
	});
});

describe('vendor-protocol.mjs \u2014 the SET now ships TASKING-PROTOCOL.md too', () => {
	it('keeps vendoring the prior set (CLAIM / REVIEW / SURFACE)', () => {
		expect(existsSync(resolve(VENDORED, 'CLAIM-PROTOCOL.md'))).toBe(true);
		expect(existsSync(resolve(VENDORED, 'REVIEW-PROTOCOL.md'))).toBe(true);
		expect(existsSync(resolve(VENDORED, 'SURFACE-PROTOCOL.md'))).toBe(true);
	});

	it('vendors `dist/protocol/TASKING-PROTOCOL.md` (the new set member)', () => {
		expect(existsSync(resolve(VENDORED, 'TASKING-PROTOCOL.md'))).toBe(true);
		const vendored = readFileSync(
			resolve(VENDORED, 'TASKING-PROTOCOL.md'),
			'utf8',
		);
		expect(vendored).toMatch(/tracer bullet/i);
	});

	it('the vendored TASKING-PROTOCOL.md is BYTE-IDENTICAL to the source-of-truth', () => {
		const src = readFileSync(resolve(SOURCE, 'TASKING-PROTOCOL.md'), 'utf8');
		const vendored = readFileSync(
			resolve(VENDORED, 'TASKING-PROTOCOL.md'),
			'utf8',
		);
		expect(vendored).toBe(src);
	});
});

describe('Per-discipline shape DRIFT GUARD \u2014 a canonical task fixture parses AND matches the doc', () => {
	// A canonical emitted task FILE: the shape the runner reads. Mirrors
	// `work/protocol/task-template.md` plus the live `parseFrontmatter` reader.
	const fixture = [
		'---',
		'title: A canonical task',
		'slug: canonical-task',
		'spec: example-spec',
		'blockedBy: [other-task]',
		'covers: [1, 2]',
		'needsAnswers: true',
		'---',
		'',
		'## What to build',
		'',
		'A thin vertical path through every layer.',
		'',
		'## Acceptance criteria',
		'',
		'- [ ] It works',
		'',
		'## Open questions',
		'',
		'1. Is the seam X already shaped right?',
		'',
		'## Prompt',
		'',
		'> Self-contained instructions for a fresh agent context.',
		'',
	].join('\n');

	it('the frontmatter parser accepts the canonical fixture (every field reads back as the doc describes)', () => {
		const fm = parseFrontmatter(fixture);
		expect(fm.slug).toBe('canonical-task');
		expect(fm.spec).toBe('example-spec');
		expect(fm.blockedBy).toEqual(['other-task']);
		expect(fm.needsAnswers).toBe(true);
		expect(fm.humanOnly).toBeUndefined();
	});

	it('every authoring field the fixture exercises is DESCRIBED in TASKING-PROTOCOL.md (the doc mirrors the parser; D2)', () => {
		const doc = readFileSync(resolve(SOURCE, 'TASKING-PROTOCOL.md'), 'utf8');
		// Required frontmatter (the parser reads these).
		expect(doc).toMatch(/\btitle\b/);
		expect(doc).toMatch(/\bslug\b/);
		expect(doc).toMatch(/\bspec\b/);
		expect(doc).toMatch(/\bblockedBy\b/);
		// Optional axes the fixture exercises.
		expect(doc).toMatch(/\bcovers\b/);
		expect(doc).toMatch(/\bneedsAnswers\b/);
		expect(doc).toMatch(/\bhumanOnly\b/);
		// The body sections the template enforces.
		expect(doc).toMatch(/## What to build/);
		expect(doc).toMatch(/## Acceptance criteria/);
		expect(doc).toMatch(/## Prompt/);
		expect(doc).toMatch(/## Open questions/);
		// The placement rule \u2014 the agent ALWAYS writes to the staging folder.
		expect(doc).toMatch(/STAGING/);
	});
});

describe('buildTaskingSpec \u2014 in-band reference + no re-inlined discipline prose + current vocabulary', () => {
	// `buildTaskingSpec` is module-private; read its assembled output for
	// `slug: 'example-prd'` from the source file so this test is hermetic and
	// does not require exporting the builder. (The same indirect-read pattern
	// the surface task's prompt assertions use.)
	const TASKING = readFileSync(TASKING_SRC, 'utf8');
	// The literal lines the builder emits; we assert against the SOURCE text of
	// the builder, which is the assembled prompt prose (modulo the `${slug}`
	// interpolation).
	const builderBody = (() => {
		const match =
			/function buildTaskingSpec\([^]*?return \[([^]*?)\]\.join\('\\n'\);/m.exec(
				TASKING,
			);
		expect(match).toBeTruthy();
		return match![1];
	})();

	// The builder resolves its folder paths through `workFolderRel('specs-*')`
	// (so a folder-VALUE flip never re-drifts the prompt string) and
	// interpolates them as `${specReady}` / `${specTasked}`. Capture the whole
	// function (the `workFolderRel(...)` binding lines sit ABOVE the returned
	// array) so the current-vocabulary assertions can see them.
	const builderFn = (() => {
		const match = /function buildTaskingSpec\([^]*?\n}/m.exec(TASKING);
		expect(match).toBeTruthy();
		return match![0];
	})();

	it('REFERENCES `work/protocol/TASKING-PROTOCOL.md` (the in-band discipline)', () => {
		expect(builderBody).toMatch(/work\/protocol\/TASKING-PROTOCOL\.md/);
	});

	it('points the agent at the HELD spec in `work/specs/ready/` via `workFolderRel` (current vocabulary, cannot re-drift)', () => {
		// The builder binds the two spec folders through the folder-key indirection
		// (`workFolderRel('specs-ready'/'specs-tasked')`), so the prompt always points
		// at the EXISTING migrated path \u2014 not a hard-coded `work/prds/*` literal.
		expect(builderFn).toMatch(/workFolderRel\('specs-ready'\)/);
		// The spec moves to `work/specs/tasked/` on success \u2014 the prompt
		// mentions the runner-owned destination so the agent does NOT do it.
		expect(builderFn).toMatch(/workFolderRel\('specs-tasked'\)/);
		// And the prose interpolates those bindings (no bare `work/prds/*` literal).
		expect(builderBody).toMatch(/\$\{specReady\}/);
		expect(builderBody).toMatch(/\$\{specTasked\}/);
	});

	it('does NOT re-inline the confidence-check rules / humanOnly NARROW prose (lives in the protocol doc now)', () => {
		// The previous builder restated the confidence-check + the `humanOnly`
		// NARROW guidance verbatim. Those passages belong to the doc; the prompt
		// should reference them, not duplicate them.
		expect(builderBody).not.toMatch(/never-for-agents BY NATURE/);
		expect(builderBody).not.toMatch(/TASK `humanOnly` IS NARROW/);
		expect(builderBody).not.toMatch(
			/overloaded "stamp `humanOnly` for review"/,
		);
		// The "Use the to-tasks skill" framing is gone.
		expect(builderBody).not.toMatch(/Use the \*\*to-tasks\*\* skill/);
	});

	it('VOCABULARY REGRESSION: NONE of `to-tasks`, `work/backlog/`, `work/prd/`, `work/prds/` remain (the spec\u2019s bonus bug + the prd\u2192spec word cutover)', () => {
		expect(builderBody).not.toMatch(/to-tasks/);
		// `work/backlog/` is the PRE-RENAME pool name (now `work/tasks/ready/`);
		// guard the bare token without matching the current `work/tasks/backlog/`
		// staging spelling.
		expect(builderBody).not.toMatch(/(?<!\/tasks\/)work\/backlog\//);
		// `work/prd/` is the pre-rename spec folder and `work/prds/` is the
		// pre-cutover plural \u2014 both are GONE (the builder emits `work/specs/*`).
		expect(builderBody).not.toMatch(/work\/prd\//);
		expect(builderBody).not.toMatch(/work\/prds\//);
	});

	it('uses the CURRENT staged + pool vocabulary (`work/tasks/backlog/` + `work/tasks/ready/`)', () => {
		expect(builderBody).toMatch(/work\/tasks\/backlog/);
		expect(builderBody).toMatch(/work\/tasks\/ready/);
		// Points the agent at the to-task skill as the user-invoked pointer.
		expect(builderBody).toMatch(/skills\/to-task\/SKILL\.md/);
	});
});

describe('skills/to-task/SKILL.md \u2014 a thin USER-invoked human-facing pointer', () => {
	const skill = readFileSync(SKILL, 'utf8');

	it('keeps the user-invoked frontmatter (`disable-model-invocation: true`)', () => {
		expect(skill).toMatch(/^---/);
		expect(skill).toMatch(/name:\s*to-task/);
		// CRITICAL: to-task is USER-invoked, unlike review / surface-questions.
		// The runner never spawns it by name; a human reaches for it.
		expect(skill).toMatch(/disable-model-invocation:\s*true/);
		expect(skill).toMatch(/description:/);
	});

	it('points at the protocol doc as the source of truth (not duplicating the discipline)', () => {
		expect(skill).toMatch(/work\/protocol\/TASKING-PROTOCOL\.md/);
		expect(skill).toMatch(/skills\/setup\/protocol\/TASKING-PROTOCOL\.md/);
	});

	it('is THIN \u2014 the full discipline body no longer lives here', () => {
		// The skill used to carry the whole discipline (several KB). After
		// thinning it is a short human-facing pointer; size is a coarse but
		// effective guard against re-inlining the discipline.
		expect(skill.length).toBeLessThan(2500);
		// And the load-bearing discipline prose has moved OUT.
		expect(skill).not.toMatch(/tracer bullet/i);
		expect(skill).not.toMatch(/TASK `humanOnly` IS NARROW/);
		expect(skill).not.toMatch(/file-orthogonal/i);
		expect(skill).not.toMatch(/`taskedAfter` \(cross-prd order\)/);
	});
});
