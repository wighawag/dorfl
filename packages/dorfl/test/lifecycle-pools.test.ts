import {describe, it, expect} from 'vitest';
import {
	buildLifecyclePools,
	type NeedsAnswersCandidate,
} from '../src/lifecycle-pools.js';
import type {LedgerObservationItem} from '../src/ledger-read.js';
import {newSidecar, type SidecarModel} from '../src/sidecar.js';

/**
 * `advance-autopick-lifecycle-pools` — the PURE shared enumeration of the THREE
 * lifecycle sub-pools (triage / surface / apply). It is fed CALLER-SIDE (the
 * substrate I/O is `lifecycle-gather.ts`); this file pins the pure routing +
 * gating + create-vs-consume invariant in isolation.
 *
 * Proves: an untriaged observation → triage (gated); a SETTLED (`triaged:`)
 * observation drops out; a `needsAnswers` item with NO all-answered sidecar →
 * surface (gated); an answered sidecar → apply (ALWAYS on, even with both
 * create-gates off); a PENDING sidecar is enumerated into NEITHER pool; and the
 * INTERIM born-OFF default contributes only apply.
 */

function obs(slug: string, triaged?: string): LedgerObservationItem {
	return {file: `${slug}.md`, slug, triaged};
}

/** A sidecar with one PENDING (unanswered) question. */
function pendingSidecar(item: string): SidecarModel {
	return newSidecar(item, [{question: 'pick one?'}]);
}

/** A sidecar with one ANSWERED question (all-answered). */
function answeredSidecar(item: string): SidecarModel {
	const model = newSidecar(item, [{question: 'pick one?'}]);
	model.entries[0].answer = 'yes';
	return model;
}

function blocked(
	namespace: 'task' | 'prd',
	slug: string,
	sidecar: SidecarModel | undefined,
): NeedsAnswersCandidate {
	return {repoPath: '/repo', namespace, slug, sidecar};
}

describe('buildLifecyclePools — triage sub-pool (untriaged observations)', () => {
	it('enumerates UNTRIAGED observations when the triage gate is ON', () => {
		const pools = buildLifecyclePools({
			repoPath: '/repo',
			observations: [obs('alpha'), obs('beta')],
			needsAnswers: [],
			gates: {triage: true},
		});
		expect(pools.triage).toEqual([
			{repoPath: '/repo', slug: 'alpha', namespace: 'observation'},
			{repoPath: '/repo', slug: 'beta', namespace: 'observation'},
		]);
	});

	it('DROPS a SETTLED observation (`triaged:` non-empty) from the pool', () => {
		const pools = buildLifecyclePools({
			repoPath: '/repo',
			observations: [obs('kept', 'keep'), obs('dup', 'duplicate'), obs('open')],
			needsAnswers: [],
			gates: {triage: true},
		});
		// Only the untriaged one survives; settled ones never re-enumerated.
		expect(pools.triage.map((s) => s.slug)).toEqual(['open']);
	});

	it('with the triage gate OFF (default), enumerates NO observation', () => {
		const pools = buildLifecyclePools({
			repoPath: '/repo',
			observations: [obs('open')],
			needsAnswers: [],
		});
		expect(pools.triage).toEqual([]);
	});
});

describe('buildLifecyclePools — surface sub-pool (needsAnswers, no all-answered sidecar)', () => {
	it('enumerates a blocked item with NO sidecar when the surface gate is ON', () => {
		const pools = buildLifecyclePools({
			repoPath: '/repo',
			observations: [],
			needsAnswers: [blocked('task', 'blocked-one', undefined)],
			gates: {surface: true},
		});
		expect(pools.surface).toEqual([
			{repoPath: '/repo', slug: 'blocked-one', namespace: 'task'},
		]);
	});

	it('with the surface gate OFF (default), enumerates NO surface item', () => {
		const pools = buildLifecyclePools({
			repoPath: '/repo',
			observations: [],
			needsAnswers: [blocked('prd', 'blocked-prd', undefined)],
		});
		expect(pools.surface).toEqual([]);
	});

	it('a PENDING sidecar is enumerated into NEITHER surface NOR apply (keeps the pool calm)', () => {
		const pools = buildLifecyclePools({
			repoPath: '/repo',
			observations: [],
			needsAnswers: [blocked('task', 'half', pendingSidecar('task:half'))],
			// even with BOTH create-gates ON, a pending sidecar is not a surface/apply.
			gates: {surface: true, triage: true},
		});
		expect(pools.surface).toEqual([]);
		expect(pools.apply).toEqual([]);
	});
});

describe('buildLifecyclePools — apply sub-pool (answered sidecar; CONSUME, ALWAYS on)', () => {
	it('enumerates an answered-sidecar item to APPLY even with BOTH create-gates OFF', () => {
		const pools = buildLifecyclePools({
			repoPath: '/repo',
			observations: [obs('open')],
			needsAnswers: [
				blocked('task', 'answered-task', answeredSidecar('task:answered-task')),
				blocked('prd', 'answered-prd', answeredSidecar('prd:answered-prd')),
			],
			// create-side gates OFF (the default/interim) — apply is NOT gated.
			gates: {},
		});
		expect(pools.apply).toEqual([
			{repoPath: '/repo', slug: 'answered-task', namespace: 'task'},
			{repoPath: '/repo', slug: 'answered-prd', namespace: 'prd'},
		]);
		// create-side pools stay empty (gates off).
		expect(pools.surface).toEqual([]);
		expect(pools.triage).toEqual([]);
	});
});

describe('buildLifecyclePools — INTERIM born-OFF default is calm (apply-only)', () => {
	it('with NO gates supplied, only apply (consume) is non-empty', () => {
		const pools = buildLifecyclePools({
			repoPath: '/repo',
			observations: [obs('open'), obs('settled', 'keep')],
			needsAnswers: [
				blocked('task', 'a', undefined), // would-be surface, but gate off
				blocked('task', 'b', pendingSidecar('task:b')), // pending → neither
				blocked('task', 'c', answeredSidecar('task:c')), // apply (always on)
			],
		});
		expect(pools.triage).toEqual([]);
		expect(pools.surface).toEqual([]);
		expect(pools.apply.map((s) => s.slug)).toEqual(['c']);
	});
});
