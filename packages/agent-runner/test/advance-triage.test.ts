import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {performAdvance} from '../src/advance.js';
import type {TriageGate, TriageEmit} from '../src/triage-gate.js';
import type {SurfaceGate, SurfaceEmit} from '../src/surface-gate.js';
import type {
	AutoDispositionOptions,
	AutoDispositionResult,
	PromoteObservationOptions,
	PromoteObservationResult,
} from '../src/triage-persist.js';
import {
	newSidecar,
	serialiseSidecar,
	type SidecarModel,
	type SidecarDisposition,
} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {isTriagedKeep} from '../src/apply-persist.js';
import {
	makeScratch,
	gitEnv,
	gitIn,
	seedRepoWithArbiter,
	raceClone,
	existsOnArbiterMain,
	type Scratch,
} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * `advance-rung-triage` slice — the observation TRIAGE rung + the
 * `observationTriage` gate, WIRED through the engine tick. Acceptance criteria
 * pinned at the engine
 * seam:
 *
 *   - QUESTION-GATED by DEFAULT: an untriaged observation surfaces a promote/keep/
 *     delete question and WAITS (no autonomous "worth building?" decision);
 *   - `observationTriage: 'auto'` gates a CONSERVATIVE auto-disposition — only
 *     duplicate→suggest-delete / unambiguous-map; NEVER auto-deletes a
 *     non-duplicate, NEVER auto-promotes a judgement call (an `auto:false` falls
 *     back to the question);
 *   - an answered "promote" CAS-creates a new backlog item keyed on the new
 *     identity; a same-slug new-item race ⇒ the loser fails CAS;
 *   - "keep" → `triaged:keep` marker, drops out of the pool; "delete" → recommends
 *     deletion (the human deletes — never the agent);
 *   - surface + apply remain ALWAYS allowed even with `observationTriage` in the
 *     question-gated `ask`/`off` modes.
 *
 * House CAS-seam + throwaway-repo style: the gates + the lock are injected; the
 * promote-via-CAS race runs against a REAL local arbiter (the only arbiter race).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-advance-triage-');
});
afterEach(() => {
	scratch.cleanup();
});

const ACQUIRED: AcquireAdvancingLockResult = {
	exitCode: 0,
	outcome: 'acquired',
	message: 'locked',
};
const RELEASED: ReleaseAdvancingLockResult = {
	exitCode: 0,
	outcome: 'released',
	message: 'released',
};

/** A throwaway repo with one UNTRIAGED observation (no needsAnswers, no sidecar). */
function seedObservation(slug = 'obs'): {repo: string; itemPath: string} {
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	const itemPath = `work/notes/observations/${slug}.md`;
	mkdirSync(join(repo, 'work', 'notes', 'observations'), {recursive: true});
	writeFileSync(
		join(repo, itemPath),
		[
			'---',
			`title: ${slug}`,
			'date: 2026-06-11',
			'---',
			'',
			'Noticed a thing worth capturing.',
			'',
		].join('\n'),
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed observation'], repo);
	return {repo, itemPath};
}

/** A triage-gate stub recording the spawn + returning a canned decision. */
function spyTriage(emit: TriageEmit): {gate: TriageGate; spawns: string[]} {
	const spawns: string[] = [];
	const gate: TriageGate = async (input) => {
		spawns.push(input.item);
		return emit;
	};
	return {gate, spawns};
}

/** A surface-gate stub recording the spawn + returning a canned emit. */
function spySurface(emit: SurfaceEmit): {gate: SurfaceGate; spawns: string[]} {
	const spawns: string[] = [];
	const gate: SurfaceGate = async (input) => {
		spawns.push(input.item);
		return emit;
	};
	return {gate, spawns};
}

describe('advance — the TRIAGE rung is QUESTION-GATED by default', () => {
	it('an untriaged observation surfaces a promote/keep/delete question and WAITS (observationTriage ask)', async () => {
		const {repo, itemPath} = seedObservation('foo');
		const {gate: surface, spawns} = spySurface({
			item: 'observation:foo',
			questions: [
				{
					question: 'Promote, keep, or delete?',
					context: 'a captured signal',
					disposition: 'keep',
				},
			],
		});
		// A triage gate is provided but MUST NOT be consulted (not in `auto` mode).
		const {gate: triage, spawns: triageSpawns} = spyTriage({auto: false});

		const result = await performAdvance({
			arg: 'obs:foo',
			cwd: repo,
			surfaceGate: surface,
			triageGate: triage,
			// observationTriage NOT set ⇒ the question-gated default (like `ask`/`off`).
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('triage-observation');
		// The triage gate was NEVER asked (no autonomous "worth building?" judgement).
		expect(triageSpawns).toEqual([]);
		// The surface question WAS surfaced (engine persisted the sidecar).
		expect(spawns).toEqual(['observation:foo']);
		const sidecar = join(repo, 'work', 'questions', 'observation-foo.md');
		expect(existsSync(sidecar)).toBe(true);
		expect(
			parseFrontmatter(readFileSync(join(repo, itemPath), 'utf8')).needsAnswers,
		).toBe(true);
	});

	it('surface stays ALWAYS allowed in the question-gated ask mode (the question loop with zero autonomy)', async () => {
		const {repo} = seedObservation('bar');
		const {gate: surface, spawns} = spySurface({
			item: 'observation:bar',
			questions: [{question: 'promote/keep/delete?', disposition: 'keep'}],
		});
		const result = await performAdvance({
			arg: 'obs:bar',
			cwd: repo,
			surfaceGate: surface,
			observationTriage: 'ask',
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(spawns).toEqual(['observation:bar']);
		expect(
			existsSync(join(repo, 'work', 'questions', 'observation-bar.md')),
		).toBe(true);
	});
});

describe('advance — the observationTriage:auto exception bounds (high bar)', () => {
	it('observationTriage auto + a DUPLICATE → auto-disposition WITHOUT a question (recommend delete, never auto-delete)', async () => {
		const {repo, itemPath} = seedObservation('dup');
		const {gate: triage, spawns} = spyTriage({
			auto: true,
			kind: 'duplicate',
			existing: 'observation:original',
			reason: 'same signal already captured',
		});
		// A surface gate is provided but MUST NOT be consulted on the auto path.
		const {gate: surface, spawns: surfaceSpawns} = spySurface({
			item: 'observation:dup',
			questions: [{question: 'q?'}],
		});

		const result = await performAdvance({
			arg: 'obs:dup',
			cwd: repo,
			observationTriage: 'auto',
			triageGate: triage,
			surfaceGate: surface,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(spawns).toEqual(['observation:dup']);
		// NO question surfaced (auto path) — the surface gate was never asked.
		expect(surfaceSpawns).toEqual([]);
		expect(
			existsSync(join(repo, 'work', 'questions', 'observation-dup.md')),
		).toBe(false);
		// The observation is NOT deleted by the agent (the human deletes) — it stays,
		// with a delete RECOMMENDATION + a triaged:duplicate marker (drops out of pool).
		expect(existsSync(join(repo, itemPath))).toBe(true);
		const body = readFileSync(join(repo, itemPath), 'utf8');
		expect(body).toContain('Recommended: delete (duplicate)');
		expect(body).toContain('observation:original');
		expect(/^triaged:\s*duplicate/m.test(body)).toBe(true);
	});

	it('observationTriage auto + a MAP → record the mapping + triaged:keep (drops out of the pool)', async () => {
		const {repo, itemPath} = seedObservation('map');
		const {gate: triage} = spyTriage({
			auto: true,
			kind: 'map',
			existing: 'task:existing',
			reason: 'already covered there',
		});
		const result = await performAdvance({
			arg: 'obs:map',
			cwd: repo,
			observationTriage: 'auto',
			triageGate: triage,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		const body = readFileSync(join(repo, itemPath), 'utf8');
		expect(body).toContain('maps onto an existing item');
		expect(body).toContain('task:existing');
		expect(isTriagedKeep(body)).toBe(true);
	});

	it('observationTriage auto but the gate says auto:false (a judgement call) → falls back to the QUESTION (no auto-promote)', async () => {
		const {repo} = seedObservation('judge');
		// The gate refuses to auto-dispose (it is a promote/judgement call).
		const {gate: triage, spawns: triageSpawns} = spyTriage({
			auto: false,
			reason: 'needs a human promote decision',
		});
		const {gate: surface, spawns: surfaceSpawns} = spySurface({
			item: 'observation:judge',
			questions: [{question: 'promote/keep/delete?', disposition: 'keep'}],
		});
		const result = await performAdvance({
			arg: 'obs:judge',
			cwd: repo,
			observationTriage: 'auto',
			triageGate: triage,
			surfaceGate: surface,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		// The gate WAS asked (observationTriage auto) but said no — so we surfaced the question.
		expect(triageSpawns).toEqual(['observation:judge']);
		expect(surfaceSpawns).toEqual(['observation:judge']);
		expect(
			existsSync(join(repo, 'work', 'questions', 'observation-judge.md')),
		).toBe(true);
	});

	it('a duplicate auto-disposition is delegated through the injected seam (no auto-delete of a non-duplicate)', async () => {
		const {repo} = seedObservation('seam');
		const {gate: triage} = spyTriage({
			auto: true,
			kind: 'duplicate',
			existing: 'observation:o',
		});
		const calls: AutoDispositionOptions[] = [];
		const dispose = (o: AutoDispositionOptions): AutoDispositionResult => {
			calls.push(o);
			return {
				outcome: 'delete-recommended',
				commit: 'deadbeef',
				itemPath: o.itemPath,
				message: 'recommended',
			};
		};
		await performAdvance({
			arg: 'obs:seam',
			cwd: repo,
			observationTriage: 'auto',
			triageGate: triage,
			autoDisposition: dispose,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(calls).toHaveLength(1);
		// The seam is handed a duplicate (never a delete of a non-duplicate signal).
		expect(calls[0].kind).toBe('duplicate');
		expect(calls[0].item).toBe('observation:seam');
	});
});

/**
 * Seed an observation that is needsAnswers:true with a FULLY-answered sidecar
 * carrying a single disposition — exactly the `classify=apply` cell for an
 * answered triage. Used for the promote / keep / delete apply-path tests.
 */
function seedAnsweredObservation(
	repo: string,
	slug: string,
	disposition: SidecarDisposition,
): {itemPath: string; sidecarPath: string} {
	const itemPath = `work/notes/observations/${slug}.md`;
	mkdirSync(join(repo, 'work', 'notes', 'observations'), {recursive: true});
	writeFileSync(
		join(repo, itemPath),
		[
			'---',
			`title: ${slug}`,
			'date: 2026-06-11',
			'needsAnswers: true',
			'---',
			'',
			'A captured signal awaiting triage.',
			'',
		].join('\n'),
	);
	let model: SidecarModel = newSidecar(`observation:${slug}`, [
		{question: 'Promote, keep, or delete?', disposition},
	]);
	model = {
		...model,
		entries: model.entries.map((e) => ({...e, answer: 'answered'})),
	};
	const sidecarPath = `work/questions/observation-${slug}.md`;
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));
	return {itemPath, sidecarPath};
}

describe('advance — answered triage dispositions flow through the apply path', () => {
	it('answered "promote" → CAS-creates a new backlog item keyed on the new identity, resolves the observation', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const {itemPath, sidecarPath} = seedAnsweredObservation(
			seeded.repo,
			'prom',
			'promote-task',
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'seed answered promote'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await performAdvance({
			arg: 'obs:prom',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('apply');
		// A NEW backlog item was CAS-created on the arbiter keyed on the promoted
		// identity (the observation's slug by default) — the CAS publishes to
		// arbiter/main, not the local working tree.
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'prom')).toBe(true);
		// The observation was RESOLVED (sidecar deleted + needsAnswers cleared) and
		// records the promotion; it stays in observations/ (no lifecycle move).
		expect(existsSync(join(seeded.repo, sidecarPath))).toBe(false);
		const body = readFileSync(join(seeded.repo, itemPath), 'utf8');
		expect(parseFrontmatter(body).needsAnswers).toBe(false);
		expect(body).toContain('Triaged: promoted');
	});

	it('a same-slug new-item race ⇒ exactly one promote creates, the loser fails CAS', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		// Two clones each carrying the SAME answered observation, racing the same
		// promoted backlog slug through the create CAS. Each clone gets a DISTINCT
		// committer identity (raceClone) so the two create commits get DISTINCT shas
		// (as two real machines would) and the loser loses through the genuine
		// path-exists/lease CAS — NOT via a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');
		for (const dir of [a, b]) {
			seedAnsweredObservation(dir, 'dupprom', 'promote-task');
			gitIn(['add', '-A'], dir);
			gitIn(['commit', '-q', '-m', 'answered promote'], dir);
		}

		const [ra, rb] = await Promise.all([
			performAdvance({
				arg: 'obs:dupprom',
				cwd: a,
				arbiter: 'arbiter',
				acquireLock: async () => ACQUIRED,
				releaseLock: async () => RELEASED,
			}),
			performAdvance({
				arg: 'obs:dupprom',
				cwd: b,
				arbiter: 'arbiter',
				acquireLock: async () => ACQUIRED,
				releaseLock: async () => RELEASED,
			}),
		]);

		const won = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(lost[0].outcome).toBe('lost');
	});

	it('a same-slug new-item race with IDENTICAL committer identity ⇒ STILL exactly one promote creates (CAS serialises via the per-attempt nonce, not via sha-distinctness)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		// The INVERSE of the distinct-identity race above and the product-layer
		// regression: both racers commit under the SAME committer identity (same
		// user.name/user.email), build the SAME tree + message off the SAME base, so
		// WITHOUT the seam's per-attempt CAS-Nonce their create commits would be
		// byte-identical (one sha) and BOTH would spuriously verify as won. The nonce
		// makes the two shas DISTINCT, so the loser's lease is genuinely rejected.
		const a = seeded.clone('same-id-a');
		const b = seeded.clone('same-id-b');
		for (const dir of [a, b]) {
			// IDENTICAL identity in both clones (NOT raceClone's distinct identities).
			gitIn(['config', 'user.name', 'One Bot'], dir);
			gitIn(['config', 'user.email', 'one-bot@example.com'], dir);
			seedAnsweredObservation(dir, 'dupprom', 'promote-task');
			gitIn(['add', '-A'], dir);
			gitIn(['commit', '-q', '-m', 'answered promote'], dir);
		}

		const [ra, rb] = await Promise.all([
			performAdvance({
				arg: 'obs:dupprom',
				cwd: a,
				arbiter: 'arbiter',
				acquireLock: async () => ACQUIRED,
				releaseLock: async () => RELEASED,
			}),
			performAdvance({
				arg: 'obs:dupprom',
				cwd: b,
				arbiter: 'arbiter',
				acquireLock: async () => ACQUIRED,
				releaseLock: async () => RELEASED,
			}),
		]);

		const won = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(lost[0].outcome).toBe('lost');
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'dupprom')).toBe(true);
	});

	it('the promote new-item creation is routed THROUGH the injected CAS seam, keyed on the new identity', async () => {
		const {repo} = seedObservation('seamprom');
		seedAnsweredObservation(repo, 'seamprom', 'promote-task');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'answered promote'], repo);

		const calls: PromoteObservationOptions[] = [];
		const promote = async (
			o: PromoteObservationOptions,
		): Promise<PromoteObservationResult> => {
			calls.push(o);
			return {
				outcome: 'promoted',
				exitCode: 0,
				newItemPath: 'work/tasks/todo/seamprom.md',
				message: 'promoted',
			};
		};
		const result = await performAdvance({
			arg: 'obs:seamprom',
			cwd: repo,
			promote,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].item).toBe('observation:seamprom');
	});

	it('answered "keep" → triaged:keep marker, the item drops out of the pool', async () => {
		const {repo} = seedObservation('keep');
		const {itemPath, sidecarPath} = seedAnsweredObservation(
			repo,
			'keep',
			'keep',
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'answered keep'], repo);
		const result = await performAdvance({
			arg: 'obs:keep',
			cwd: repo,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		// Sidecar resolved + the keep marker stamped (drops out of the pool).
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		const body = readFileSync(join(repo, itemPath), 'utf8');
		expect(isTriagedKeep(body)).toBe(true);
	});

	it('answered "delete" → recommends deletion (the human deletes — agent never auto-deletes)', async () => {
		const {repo} = seedObservation('del');
		const {itemPath, sidecarPath} = seedAnsweredObservation(
			repo,
			'del',
			'delete',
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'answered delete'], repo);
		const result = await performAdvance({
			arg: 'obs:del',
			cwd: repo,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		// The file is NOT deleted by the agent — it stays with a delete recommendation.
		expect(existsSync(join(repo, itemPath))).toBe(true);
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(readFileSync(join(repo, itemPath), 'utf8')).toContain(
			'Recommended: delete',
		);
	});
});
