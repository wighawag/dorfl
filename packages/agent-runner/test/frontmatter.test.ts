import {describe, it, expect} from 'vitest';
import {parseFrontmatter, resolveClosingIssue} from '../src/frontmatter.js';

describe('parseFrontmatter', () => {
	it('extracts slug, humanOnly, needsAnswers and blockedBy from a full frontmatter block', () => {
		const md = [
			'---',
			'title: Some Title',
			'slug: my-task',
			'brief: my-brief',
			'humanOnly: true',
			'needsAnswers: true',
			'blockedBy: [foo, bar]',
			'---',
			'',
			'## What to build',
			'body text here',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('my-task');
		expect(fm.brief).toBe('my-brief');
		expect(fm.humanOnly).toBe(true);
		expect(fm.needsAnswers).toBe(true);
		expect(fm.blockedBy).toEqual(['foo', 'bar']);
	});

	it('treats humanOnly: true as the human-only gate', () => {
		const md = ['---', 'slug: a', 'humanOnly: true', '---'].join('\n');
		expect(parseFrontmatter(md).humanOnly).toBe(true);
	});

	it('treats omitted humanOnly as undefined (undeclared)', () => {
		const md = ['---', 'slug: a', 'blockedBy: []', '---'].join('\n');
		expect(parseFrontmatter(md).humanOnly).toBeUndefined();
	});

	it('parses needsAnswers: true as the discovered axis', () => {
		const md = ['---', 'slug: a', 'needsAnswers: true', '---'].join('\n');
		expect(parseFrontmatter(md).needsAnswers).toBe(true);
	});

	it('treats omitted needsAnswers as undefined (undeclared)', () => {
		const md = ['---', 'slug: a', '---'].join('\n');
		expect(parseFrontmatter(md).needsAnswers).toBeUndefined();
	});

	it('parses needsAnswers: false as false (not gated)', () => {
		const md = ['---', 'slug: a', 'needsAnswers: false', '---'].join('\n');
		expect(parseFrontmatter(md).needsAnswers).toBe(false);
	});

	it('returns empty blockedBy when blockedBy is omitted', () => {
		const md = ['---', 'slug: a', '---'].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual([]);
	});

	it('returns empty blockedBy for an empty inline list', () => {
		const md = ['---', 'slug: a', 'blockedBy: []', '---'].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual([]);
	});

	it('parses a block-style (multi-line) blockedBy list', () => {
		const md = [
			'---',
			'slug: a',
			'blockedBy:',
			'  - foo',
			'  - bar',
			'---',
		].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual(['foo', 'bar']);
	});

	it('does NOT match the legacy snake_case blocked_by key', () => {
		const md = ['---', 'slug: a', 'blocked_by: [foo, bar]', '---'].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual([]);
	});

	it('parses brief-level briefAfter (inline list)', () => {
		const md = [
			'---',
			'slug: my-brief',
			'briefAfter: [other-brief, third-brief]',
			'---',
		].join('\n');
		expect(parseFrontmatter(md).briefAfter).toEqual([
			'other-brief',
			'third-brief',
		]);
	});

	it('parses a block-style briefAfter list', () => {
		const md = [
			'---',
			'slug: my-brief',
			'briefAfter:',
			'  - other-brief',
			'  - third-brief',
			'---',
		].join('\n');
		expect(parseFrontmatter(md).briefAfter).toEqual([
			'other-brief',
			'third-brief',
		]);
	});

	it('returns empty briefAfter when omitted', () => {
		const md = ['---', 'slug: my-brief', '---'].join('\n');
		expect(parseFrontmatter(md).briefAfter).toEqual([]);
	});

	it('the HARD CUTOVER: the pre-rename `prd:` and `sliceAfter:` keys are NOT parsed (no old field name)', () => {
		const md = [
			'---',
			'slug: my-task',
			'prd: old-parent',
			'sliceAfter: [old-dep]',
			'---',
		].join('\n');
		const fm = parseFrontmatter(md);
		// The old keys are inert text now — neither maps to the new fields.
		expect(fm.brief).toBeUndefined();
		expect(fm.briefAfter).toEqual([]);
	});

	// ── Origin-trust PROVENANCE (slice untrusted-origin-forces-build-propose) ────
	// The stamp that survives the PRD/slice merge boundary: how the artifact was
	// born + the author-trust verdict at birth. UNSET ⇒ human/trusted (the normal
	// path, zero behaviour change).

	it('parses origin: issue + originTrust: untrusted (the stamped front-door path)', () => {
		const md = [
			'---',
			'title: From a public issue',
			'slug: from-issue',
			'origin: issue',
			'originTrust: untrusted',
			'---',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.origin).toBe('issue');
		expect(fm.originTrust).toBe('untrusted');
	});

	it('parses originTrust: trusted', () => {
		const md = [
			'---',
			'slug: a',
			'origin: issue',
			'originTrust: trusted',
			'---',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.origin).toBe('issue');
		expect(fm.originTrust).toBe('trusted');
	});

	it('treats OMITTED origin/originTrust as undefined (⇒ human/trusted, the unset default)', () => {
		// The normal human-authored / local path: NO stamp ⇒ both undefined, which the
		// build transition reads as trusted (zero behaviour change).
		const md = ['---', 'slug: a', 'blockedBy: []', '---'].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.origin).toBeUndefined();
		expect(fm.originTrust).toBeUndefined();
	});

	it('reads an UNKNOWN origin/originTrust value as undefined (fail-safe to the default)', () => {
		const md = [
			'---',
			'slug: a',
			'origin: nonsense',
			'originTrust: maybe',
			'---',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.origin).toBeUndefined();
		expect(fm.originTrust).toBeUndefined();
	});

	it('reads a full brief frontmatter block (humanOnly/needsAnswers/briefAfter)', () => {
		const md = [
			'---',
			'title: Historical Store',
			'slug: historical-store',
			'humanOnly: true',
			'needsAnswers: true',
			'briefAfter: [foundations]',
			'---',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('historical-store');
		expect(fm.humanOnly).toBe(true);
		expect(fm.needsAnswers).toBe(true);
		expect(fm.briefAfter).toEqual(['foundations']);
	});

	it('parses a brief-only `issue: N` link as a number (intake brief-emit)', () => {
		// `intake`'s brief outcome writes `issue: N` on `work/briefs/ready/<slug>.md` so the close
		// JOB can reach it via `task.brief: → brief issue:`. It must be machine-readable.
		const md = [
			'---',
			'title: Some Feature',
			'slug: some-feature',
			'issue: 42',
			'---',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.issue).toBe(42);
	});

	it('parses a lone-task `issue: N` link as a number (intake TASK-emit, no brief:)', () => {
		// `intake`'s TASK outcome writes `issue: N` on the lone `work/tasks/todo/<slug>.md`
		// (no `brief:`) as the provider-agnostic closure link a future CI close-job reads.
		const md = [
			'---',
			'title: Fix the thing',
			'slug: fix-the-thing',
			'issue: 7',
			'covers: []',
			'---',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.issue).toBe(7);
		expect(fm.brief).toBeUndefined();
	});

	it('treats omitted `issue:` as undefined (every non-intake brief and most tasks)', () => {
		const md = ['---', 'slug: a', 'brief: my-brief', '---'].join('\n');
		expect(parseFrontmatter(md).issue).toBeUndefined();
	});

	it('treats a non-integer / non-positive `issue:` value as undefined (absent, not malformed)', () => {
		for (const bad of ['issue: not-a-number', 'issue: 0', 'issue: -3']) {
			const md = ['---', 'slug: a', bad, '---'].join('\n');
			expect(parseFrontmatter(md).issue).toBeUndefined();
		}
	});

	it('ignores a stale `sliced:` line (the marker was removed in remove-sliced-marker-step-b)', () => {
		// `sliced:` is no longer a parsed frontmatter axis — sliced-ness is RESIDENCE in
		// `work/briefs/tasked/`. A leftover `sliced:` line is just inert text the parser
		// neither recognises nor trips over.
		const md = ['---', 'slug: my-prd', 'sliced: 2026-06-03', '---'].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('my-prd');
		expect('sliced' in fm).toBe(false);
	});

	it('strips quotes from quoted scalar values', () => {
		const md = ['---', "slug: 'quoted-slug'", 'humanOnly: "true"', '---'].join(
			'\n',
		);
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('quoted-slug');
		expect(fm.humanOnly).toBe(true);
	});

	it('strips quotes from items in inline lists', () => {
		const md = ['---', 'slug: a', 'blockedBy: [\'foo\', "bar"]', '---'].join(
			'\n',
		);
		expect(parseFrontmatter(md).blockedBy).toEqual(['foo', 'bar']);
	});

	it('returns undefined slug when there is no frontmatter block', () => {
		const md = '# just a heading\n\nno frontmatter';
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBeUndefined();
		expect(fm.humanOnly).toBeUndefined();
		expect(fm.needsAnswers).toBeUndefined();
		expect(fm.blockedBy).toEqual([]);
		expect(fm.briefAfter).toEqual([]);
	});

	it('ignores keys appearing after the frontmatter block', () => {
		const md = [
			'---',
			'slug: a',
			'---',
			'',
			'humanOnly: true',
			'blockedBy: [should-be-ignored]',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.humanOnly).toBeUndefined();
		expect(fm.blockedBy).toEqual([]);
	});

	it('handles CRLF line endings', () => {
		const md = ['---', 'slug: crlf', 'humanOnly: true', '---', 'body'].join(
			'\r\n',
		);
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('crlf');
		expect(fm.humanOnly).toBe(true);
	});
});

describe('resolveClosingIssue', () => {
	it('a fanned task (brief: only) closes via the `brief:` hop', () => {
		expect(resolveClosingIssue({brief: 'my-brief', issue: undefined})).toEqual({
			via: 'brief',
			brief: 'my-brief',
		});
	});

	it('a lone task (issue: only) closes via its own `issue:` field', () => {
		expect(resolveClosingIssue({brief: undefined, issue: 7})).toEqual({
			via: 'issue',
			issue: 7,
		});
	});

	it('when both are present (a hand-edit contradiction), `brief:` WINS and `issue:` is ignored', () => {
		// The one-closure-path invariant: intake never emits both; a human typo degrades
		// to "use the brief's number" rather than crashing (no throwing validator).
		expect(resolveClosingIssue({brief: 'my-brief', issue: 9})).toEqual({
			via: 'brief',
			brief: 'my-brief',
		});
	});

	it('neither present → no closure path (undefined)', () => {
		expect(
			resolveClosingIssue({brief: undefined, issue: undefined}),
		).toBeUndefined();
	});
});
