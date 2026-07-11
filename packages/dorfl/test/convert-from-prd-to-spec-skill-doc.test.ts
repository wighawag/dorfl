/**
 * Conformance drift-guard for `skills/convert-from-prd-to-spec/SKILL.md` — the
 * operator skill that drives the `prd → spec` vocabulary cutover end-to-end
 * (authored by `author-convert-from-prd-to-spec-skill`).
 *
 * Modelled on `tasking-protocol-doc.test.ts`: `readFileSync` the doc and assert
 * a per-element `toMatch(...)` on each piece of LOAD-BEARING prose, so a doc
 * that silently drifts or ships half-written FAILS. This is a static doc-shape
 * guard — no model, no network, no `dorfl` invocation. The seam is the file
 * content.
 *
 * The elements this guards (from the spec `vocabulary-cutover-prose-sweep-skill`):
 *   - Frontmatter identity (`name: convert-from-prd-to-spec`,
 *     `disable-model-invocation: true`).
 *   - It NAMES the deterministic command it drives (`dorfl prd-to-spec`) AND
 *     states it CALLS the command rather than re-implementing it.
 *   - The two-half orchestration (command → prose sweep → bi-word leak-scan gate).
 *   - The runner-agnostic fallback (works with `dorfl` absent).
 *   - The reusable-pattern toolkit: the `''…''` provenance marker, the bi-word
 *     (`prd` + `brief`) scan, the provenance-vs-living split, the identity
 *     allow-list.
 *   - The pointer to the two REFERENCE scans
 *     (`prd-src-prose-leak-scan` / `prd-word-cutover-leak-scan`) rather than
 *     forking their logic.
 *   - It does NOT re-introduce a stale live-back-compat claim (no "`prd:` still
 *     accepted" phrasing).
 *
 * NOTE on this test's OWN prose: `packages/dorfl/test/**` is walked by NEITHER
 * the WORD scan (`prd-word-cutover-leak-scan`, which walks `skills/**`/`docs/**`/
 * `work/**` but not the test tree) NOR the src-prose scan (`prd-src-prose-leak-scan`,
 * which walks `packages/dorfl/src` only), so a retired-word mention here is not a
 * leak — the mentions are kept in backtick spans regardless.
 */
import {describe, it, expect} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SKILL = resolve(REPO, 'skills', 'convert-from-prd-to-spec', 'SKILL.md');

describe('skills/convert-from-prd-to-spec/SKILL.md — the vocabulary-cutover operator skill doc', () => {
	it('exists at the operator-skill location (`skills/convert-from-prd-to-spec/`)', () => {
		expect(existsSync(SKILL)).toBe(true);
	});

	const doc = readFileSync(SKILL, 'utf8');

	it('carries the expected frontmatter identity (`name` + user-invoked flag)', () => {
		// Skill frontmatter keys (`name`/`disable-model-invocation`) are NOT part of
		// the item `Frontmatter` interface, so assert them on the raw text exactly as
		// `tasking-protocol-doc.test.ts` does for `skills/to-task/SKILL.md`.
		expect(doc).toMatch(/^---/);
		expect(doc).toMatch(/name:\s*convert-from-prd-to-spec/);
		// CRITICAL: this is a human-invoked OPERATOR skill (like `to-spec`/`to-task`),
		// never spawned by the runner — the frontmatter must disable model invocation.
		expect(doc).toMatch(/disable-model-invocation:\s*true/);
		expect(doc).toMatch(/description:/);
	});

	it('NAMES the deterministic command (`dorfl prd-to-spec`) and states it CALLS it (does NOT re-implement it)', () => {
		expect(doc).toMatch(/dorfl prd-to-spec/);
		// The skill CALLS the command; it does not re-implement its layers.
		expect(doc).toMatch(
			/CALLS? `?dorfl prd-to-spec`?|CALL `dorfl prd-to-spec`/,
		);
		expect(doc).toMatch(/do NOT re-implement|not re-implement/i);
	});

	it('states the TWO-HALF orchestration (command → prose sweep → bi-word leak-scan gate)', () => {
		expect(doc).toMatch(/two-half orchestration/i);
		// Half 1 — the deterministic command call.
		expect(doc).toMatch(/Half 1/);
		expect(doc).toMatch(/deterministic/i);
		// Half 2 — the judgement prose sweep the command SKIPS.
		expect(doc).toMatch(/Half 2/);
		expect(doc).toMatch(/sweep the prose/i);
		expect(doc).toMatch(/judgement/i);
		// Half 3 — the acceptance gate is the bi-word leak scan over BOTH halves.
		expect(doc).toMatch(/Half 3/);
		expect(doc).toMatch(/bi-word/i);
		expect(doc).toMatch(/leak scan/i);
		expect(doc).toMatch(/acceptance/i);
	});

	it('states the RUNNER-AGNOSTIC fallback (completes the cutover with `dorfl` ABSENT)', () => {
		expect(doc).toMatch(/runner-agnostic/i);
		expect(doc).toMatch(/ABSENT|not installed/i);
		// The by-hand path follows the SAME layers the command exposes.
		expect(doc).toMatch(/BY HAND|by-hand/i);
		expect(doc).toMatch(/prd-to-spec\.ts/);
	});

	it("teaches the `''…''` provenance MARKER (uniquely greppable, stripped like a backtick span)", () => {
		expect(doc).toMatch(/provenance marker/i);
		// The literal double-single-quote marker form.
		expect(doc).toMatch(/''prd''/);
		expect(doc).toMatch(/greppable/i);
		expect(doc).toMatch(/STRIPS?|strip/);
	});

	it('teaches the BI-WORD scan (fail on the retired word OR the reverted-away word)', () => {
		expect(doc).toMatch(/BI-WORD scan/i);
		// The revert in history that forces the two-word lens.
		expect(doc).toMatch(/REVERT|thrash/i);
		// Both words named as the two lenses.
		expect(doc).toMatch(/`prd`/);
		expect(doc).toMatch(/`brief`/);
	});

	it('teaches the coined-vs-real-word English asymmetry (allow-list only on the real word)', () => {
		expect(doc).toMatch(/coined/i);
		expect(doc).toMatch(/English/);
		expect(doc).toMatch(/allow-list/i);
	});

	it('teaches the PROVENANCE-vs-LIVING per-tree split (concrete scoping, NOT a blanket exemption)', () => {
		expect(doc).toMatch(/provenance-vs-living|provenance.{0,30}living/i);
		expect(doc).toMatch(/per-tree/i);
		// GATE the current-guidance surface; EXEMPT the provenance trees.
		expect(doc).toMatch(/GATE/);
		expect(doc).toMatch(/EXEMPT/);
		expect(doc).toMatch(/terminal-history|terminal history/i);
	});

	it('teaches the concrete IDENTITY allow-list (never rewrite a file identity / proper noun)', () => {
		expect(doc).toMatch(/IDENTITY allow-list/i);
		expect(doc).toMatch(/NEVER rewrite/i);
		// The concrete identity classes the sweep must not touch.
		expect(doc).toMatch(/slug/);
		expect(doc).toMatch(/camelCase/);
		// The list must be non-vacuous (concrete, not a blanket wildcard).
		expect(doc).toMatch(/non-vacuous/i);
	});

	it('POINTS at the two REFERENCE scans (does NOT fork their detector logic)', () => {
		expect(doc).toMatch(/prd-src-prose-leak-scan/);
		expect(doc).toMatch(/prd-word-cutover-leak-scan/);
		// It reuses them as the REFERENCE IMPLEMENTATION rather than re-deriving.
		expect(doc).toMatch(/REFERENCE IMPLEMENTATION/i);
		expect(doc).toMatch(/do NOT fork|not.{0,10}fork/i);
	});

	it('does NOT re-introduce a stale live-back-compat claim (no "`prd:` still accepted" phrasing)', () => {
		// The hard cutover removed the `prd:` field read + the `do prd:`/`advance prd:`
		// verb from live code; the doc must not claim the retired key is still a live
		// alias. (A PROVENANCE mention in backticks/marker is fine; a "still accepted"
		// back-compat CLAIM is the drift this guards against.)
		expect(doc).not.toMatch(/`prd:`\s+is\s+still\s+accepted/i);
		expect(doc).not.toMatch(/still\s+accept(s|ed)?\s+`?prd:?`?/i);
		expect(doc).not.toMatch(/back-compat.{0,20}`?prd:?`?\s+(alias|key|still)/i);
	});
});
