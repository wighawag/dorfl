import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {performAdvance} from '../src/advance.js';
import type {SurfaceGate, SurfaceEmit} from '../src/surface-gate.js';
import {parseSidecar} from '../src/sidecar.js';
import {makeScratch, gitIn, type Scratch} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * Task
 * `surface-short-circuit-already-triaged-observations-and-harden-skill-empty-emit`
 * (source observation
 * `surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10`).
 *
 * The surface rung's dispatch to the flaky `surface-questions` agent is
 * short-circuited to a deterministic `{questions: []}` for an OBSERVATION that
 * provably has nothing to surface (frontmatter `needsAnswers` NOT true, no
 * non-empty `## Open questions` section, no pending sidecar) — the typical shape
 * of a decision-record / already-triaged note. The load-bearing test: the agent
 * gate is NEVER invoked on that shape. (The loud-error contract for observations
 * that DO reach the agent is unchanged — pinned by
 * `advance-triage-always-asks.test.ts` / `advance-surface.test.ts`.)
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-advance-surface-short-circuit-');
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

/** A gate stub that fails the test if ever invoked. */
function neverGate(): {gate: SurfaceGate; spawns: string[]} {
	const spawns: string[] = [];
	const gate: SurfaceGate = async (input) => {
		spawns.push(input.item);
		throw new Error(
			`surface-questions agent MUST NOT be invoked for ${input.item} ` +
				'(the engine short-circuit should have handled it deterministically)',
		);
	};
	return {gate, spawns};
}

/** A gate stub that records the spawn + returns a canned emit. */
function spyGate(emit: SurfaceEmit): {gate: SurfaceGate; spawns: string[]} {
	const spawns: string[] = [];
	const gate: SurfaceGate = async (input) => {
		spawns.push(input.item);
		return emit;
	};
	return {gate, spawns};
}

/**
 * Seed a decision-record observation — the exact reproducer shape from the source
 * observation: a `Decision (PROCEED…)` line and an `Alternatives considered`
 * section, no `## Open questions`, `needsAnswers` unset.
 */
function seedDecisionRecordObservation(slug = 'decision-record-obs'): {
	repo: string;
	itemPath: string;
} {
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	const itemPath = `work/notes/observations/${slug}.md`;
	mkdirSync(join(repo, 'work', 'notes', 'observations'), {recursive: true});
	writeFileSync(
		join(repo, itemPath),
		[
			'---',
			'type: observation',
			'status: spotted',
			'spotted: 2026-07-12',
			'---',
			'',
			`# ${slug}`,
			'',
			'Decision (PROCEED, 2026-07-10): pursue BOTH angles; the engine',
			'short-circuit is the load-bearing half, the skill hardening is',
			'defence-in-depth.',
			'',
			'## Alternatives considered',
			'',
			'- Only harden the skill prompt — rejected: the agent still flakes.',
			'- Only short-circuit — rejected: the agent still runs for observations',
			'  that DO have open judgement, and can still flake there.',
			'',
		].join('\n'),
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed decision-record observation'], repo);
	return {repo, itemPath};
}

describe('advance surface — short-circuit for already-triaged / decision-record observations', () => {
	it('a decision-record observation returns {questions: []} WITHOUT invoking the surface-questions agent', async () => {
		const {repo} = seedDecisionRecordObservation();
		const {gate, spawns} = neverGate();
		const notes: string[] = [];

		const result = await performAdvance({
			arg: 'obs:decision-record-obs',
			cwd: repo,
			surfaceGate: gate,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
			note: (m) => notes.push(m),
		});

		// The gate was NEVER invoked (the load-bearing assertion).
		expect(spawns).toEqual([]);
		// The rung still lands cleanly: the deterministic triage question is the
		// engine-owned q1 (the "no limbo" contract) — surface's empty emit is not a
		// dead end for an observation.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('triage-observation');
		const sidecarPath = join(
			repo,
			'work',
			'questions',
			'observation-decision-record-obs.md',
		);
		expect(existsSync(sidecarPath)).toBe(true);
		const sc = parseSidecar(readFileSync(sidecarPath, 'utf8'));
		expect(sc.entries.length).toBe(1);
		expect(sc.entries[0].question.toLowerCase()).toContain('become');
		// A one-liner is logged so CI shows why the agent was skipped.
		expect(notes.join('\n').toLowerCase()).toContain('auto-triaged');
		expect(notes.join('\n').toLowerCase()).toContain('skipped agent');
	});

	it('an observation with a non-empty `## Open questions` section STILL reaches the agent (short-circuit is conservative)', async () => {
		const repo = join(scratch.root, 'project');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const itemPath = 'work/notes/observations/has-open-qs.md';
		mkdirSync(join(repo, 'work', 'notes', 'observations'), {recursive: true});
		writeFileSync(
			join(repo, itemPath),
			[
				'---',
				'type: observation',
				'status: spotted',
				'---',
				'',
				'# has-open-qs',
				'',
				'A note.',
				'',
				'## Open questions',
				'',
				'- Is this the right layer?',
				'',
			].join('\n'),
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed'], repo);

		const {gate, spawns} = spyGate({questions: []});

		const result = await performAdvance({
			arg: 'obs:has-open-qs',
			cwd: repo,
			surfaceGate: gate,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		// The agent WAS invoked (an open question is present — we still ask).
		expect(spawns).toEqual(['observation:has-open-qs']);
		expect(result.exitCode).toBe(0);
	});

	it('an observation with `needsAnswers: true` STILL reaches the agent (short-circuit is conservative)', async () => {
		const repo = join(scratch.root, 'project');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const itemPath = 'work/notes/observations/gated-obs.md';
		mkdirSync(join(repo, 'work', 'notes', 'observations'), {recursive: true});
		writeFileSync(
			join(repo, itemPath),
			[
				'---',
				'type: observation',
				'status: spotted',
				'needsAnswers: true',
				'---',
				'',
				'# gated-obs',
				'',
				'The author explicitly wants the agent to run here.',
				'',
			].join('\n'),
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed gated obs'], repo);

		const {gate, spawns} = spyGate({
			item: 'observation:gated-obs',
			questions: [{question: 'A?'}],
		});

		const result = await performAdvance({
			arg: 'obs:gated-obs',
			cwd: repo,
			surfaceGate: gate,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(spawns).toEqual(['observation:gated-obs']);
		expect(result.exitCode).toBe(0);
	});
});
