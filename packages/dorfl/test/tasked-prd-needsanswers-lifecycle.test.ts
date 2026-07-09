import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {gatherLifecycleInPlace} from '../src/lifecycle-gather.js';
import {newSidecar, serialiseSidecar, sidecarPathFor} from '../src/sidecar.js';

/**
 * A `needsAnswers:true` PRD that drifted AFTER it was tasked rests IN PLACE in
 * `work/specs/tasked/` (WORK-CONTRACT "A PRD that has drifted AFTER it was
 * TASKED"). Before this fix the lifecycle GATHER read only `prds/ready/` (pool) +
 * `prds/proposed/` (staging), so a tasked PRD's ANSWERED sidecar was enumerated
 * by NO pool and the human's answer was STRANDED (apply never ran on it).
 * Observation: `tasked-prd-needsanswers-sidecar-stranded-no-apply-pool-2026-06-26`.
 *
 * These tests assert the gather now enumerates `prds/tasked/` UNCONDITIONALLY
 * (not behind `surfaceStaging` — a tasked prd is a durable resting state, like
 * the pool), and that routing still respects the gates:
 *   - an ANSWERED sidecar → the always-on APPLY pool (answer never stranded);
 *   - a NO-sidecar tasked prd → SURFACE, still gated by `surfaceBlockers`.
 */

let root: string;
let repo: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-tasked-prd-needsanswers-'));
	repo = join(root, 'project');
	mkdirSync(repo, {recursive: true});
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

function seedTaskedPrd(slug: string, fm: {needsAnswers?: boolean} = {}): void {
	const dir = join(repo, 'work', 'specs', 'tasked');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	lines.push('---', '', '# tasked prd');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

function seedSidecar(slug: string, answered: boolean): void {
	const item = `prd:${slug}`;
	const model = newSidecar(item, [{question: 'pick one?'}]);
	if (answered) {
		model.entries[0].answer = 'yes';
	}
	const abs = join(repo, sidecarPathFor(item));
	mkdirSync(join(abs, '..'), {recursive: true});
	writeFileSync(abs, serialiseSidecar(model));
}

describe('a needsAnswers PRD in prds/tasked/ is enumerated by the lifecycle gather', () => {
	it('ANSWERED sidecar → APPLY pool (always-on; the answer is never stranded), even with create-gates OFF', () => {
		seedTaskedPrd('drifted-tasked-prd', {needsAnswers: true});
		seedSidecar('drifted-tasked-prd', true);

		// BOTH create-gates OFF — apply is the CONSUME phase and must still fire.
		const pools = gatherLifecycleInPlace({
			repoPath: repo,
			gates: {surface: false, surfaceStaging: false},
		});

		expect(pools.apply.map((i) => `${i.namespace}:${i.slug}`)).toContain(
			'prd:drifted-tasked-prd',
		);
		expect(pools.surface).toEqual([]);
	});

	it('NO sidecar yet → SURFACE pool when surfaceBlockers is ON', () => {
		seedTaskedPrd('drifted-tasked-prd', {needsAnswers: true});

		const pools = gatherLifecycleInPlace({
			repoPath: repo,
			gates: {surface: true, surfaceStaging: false},
		});

		expect(pools.surface.map((i) => `${i.namespace}:${i.slug}`)).toContain(
			'prd:drifted-tasked-prd',
		);
		expect(pools.apply).toEqual([]);
	});

	it('tasked-prd enumeration is UNCONDITIONAL (not behind surfaceStaging) — an answered sidecar applies even with surfaceStaging OFF', () => {
		seedTaskedPrd('drifted-tasked-prd', {needsAnswers: true});
		seedSidecar('drifted-tasked-prd', true);

		const pools = gatherLifecycleInPlace({
			repoPath: repo,
			// surfaceStaging OFF must NOT hide a tasked prd's answered sidecar.
			gates: {surface: true, surfaceStaging: false},
		});

		expect(pools.apply.map((i) => `${i.namespace}:${i.slug}`)).toContain(
			'prd:drifted-tasked-prd',
		);
	});

	it('a tasked prd WITHOUT needsAnswers is NOT enumerated (no spurious surface/apply)', () => {
		seedTaskedPrd('settled-tasked-prd', {needsAnswers: false});

		const pools = gatherLifecycleInPlace({
			repoPath: repo,
			gates: {surface: true, surfaceStaging: true},
		});

		expect(pools.surface).toEqual([]);
		expect(pools.apply).toEqual([]);
	});
});
