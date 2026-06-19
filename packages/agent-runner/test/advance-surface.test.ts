import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {performAdvance} from '../src/advance.js';
import type {SurfaceGate, SurfaceEmit} from '../src/surface-gate.js';
import {parseSidecar} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * `advance-rung-surface` slice (PRD `advance-loop`, US #32/33) — the SURFACE rung
 * WIRING through the engine tick: on `classify=surface`, under the `advancing`
 * lock, the engine spawns the (stubbed) `surface-questions` gate, collects the
 * emitted questions, and ITSELF persists them to the sidecar CAS-atomically +
 * sets `needsAnswers:true`. The slice's acceptance criteria pinned here:
 *
 *   - a surface tick writes the expected sidecar entries (stubbed emit);
 *   - surfacing is ALWAYS allowed (no gate) — proven with no autonomy flags;
 *   - the engine owns ALL persistence (the gate/skill writes nothing);
 *   - the expensive agent work is POST-lock, winner-only (a CAS loser never
 *     spawns the agent).
 *
 * House stubbed-harness style: the gate is injected as a canned emit so NO real
 * agent/model runs. The lock acquire/release are injected too (the CAS itself is
 * exercised in `advancing-lock.test.ts`).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-advance-surface-');
});
afterEach(() => {
	scratch.cleanup();
});

const ACQUIRED: AcquireAdvancingLockResult = {
	exitCode: 0,
	outcome: 'acquired',
	message: 'locked',
};
const LOST: AcquireAdvancingLockResult = {
	exitCode: 2,
	outcome: 'lost',
	message: 'someone holds the borrow',
};
const RELEASED: ReleaseAdvancingLockResult = {
	exitCode: 0,
	outcome: 'released',
	message: 'released',
};

/**
 * A throwaway repo with one backlog slice carrying `needsAnswers:true` and NO
 * sidecar — exactly the `classify=surface` cell (gated, no sidecar yet).
 */
function seedGatedItem(slug = 'foo'): {repo: string; itemPath: string} {
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	const itemPath = `work/tasks/todo/${slug}.md`;
	mkdirSync(join(repo, 'work', 'tasks', 'todo'), {recursive: true});
	writeFileSync(
		join(repo, itemPath),
		[
			'---',
			`title: ${slug}`,
			`slug: ${slug}`,
			'needsAnswers: true',
			'blockedBy: []',
			'---',
			'',
			'## What to build',
			'',
			'a thing',
			'',
		].join('\n'),
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed gated item'], repo);
	return {repo, itemPath};
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

describe('advance — the SURFACE rung writes the sidecar (engine persists, skill judges)', () => {
	it('classify=surface → spawn the gate, ENGINE writes the sidecar + sets needsAnswers, ONE commit', async () => {
		const {repo, itemPath} = seedGatedItem();
		const {gate, spawns} = spyGate({
			item: 'task:foo',
			questions: [
				{question: 'A?', context: 'ctx-a'},
				{question: 'B?', default: 'maybe', disposition: undefined},
			],
		});

		const result = await performAdvance({
			arg: 'foo',
			cwd: repo,
			arbiter: 'origin',
			surfaceGate: gate,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
			// Read the real signals off disk (the seeded gated item) — proving the
			// classifier routes to `surface` from the on-disk state.
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('surface');
		// The gate WAS spawned (winner) for the right identity.
		expect(spawns).toEqual(['task:foo']);

		// The ENGINE wrote the sidecar (the skill stub wrote nothing).
		const sidecarPath = join(repo, 'work', 'questions', 'task-foo.md');
		expect(existsSync(sidecarPath)).toBe(true);
		const model = parseSidecar(readFileSync(sidecarPath, 'utf8'));
		expect(model.entries.map((e) => e.id)).toEqual(['q1', 'q2']);
		expect(model.entries[0].context).toBe('ctx-a');

		// needsAnswers stays true; the sidecar landed in ONE engine-owned commit. (The
		// item here was ALREADY gated, so the idempotent needsAnswers:true flip leaves
		// the body byte-identical — the body+flag ONE-commit atomicity over an UNGATED
		// item is pinned directly in surface-persist.test.ts.)
		expect(
			parseFrontmatter(readFileSync(join(repo, itemPath), 'utf8')).needsAnswers,
		).toBe(true);
		const touched = gitIn(['show', '--name-only', '--format=', 'HEAD'], repo)
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		expect(touched).toContain('work/questions/task-foo.md');
	});

	it('surfacing is ALWAYS allowed — no gate, proven with NO autonomy flags threaded', async () => {
		// No doOptions / autoSlice / autoBuild / observationTriage anywhere — surface still
		// runs. (Surfacing + applying are the always-allowed rungs, US #23.)
		const {repo} = seedGatedItem('bar');
		const {gate, spawns} = spyGate({
			item: 'task:bar',
			questions: [{question: 'open?'}],
		});
		const result = await performAdvance({
			arg: 'bar',
			cwd: repo,
			surfaceGate: gate,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('surface');
		expect(spawns).toEqual(['task:bar']);
		expect(existsSync(join(repo, 'work', 'questions', 'task-bar.md'))).toBe(
			true,
		);
	});

	it('the expensive agent work is POST-lock, winner-only — a CAS LOSER never spawns the gate', async () => {
		const {repo} = seedGatedItem();
		const {gate, spawns} = spyGate({
			item: 'task:foo',
			questions: [{question: 'A?'}],
		});
		let released = false;
		const result = await performAdvance({
			arg: 'foo',
			cwd: repo,
			surfaceGate: gate,
			acquireLock: async () => LOST,
			releaseLock: async () => {
				released = true;
				return RELEASED;
			},
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
		expect(result.rung).toBe('surface'); // it DID classify (free, read-only)
		// …but the loser NEVER spawned the agent and NEVER wrote the sidecar.
		expect(spawns).toEqual([]);
		expect(existsSync(join(repo, 'work', 'questions', 'task-foo.md'))).toBe(
			false,
		);
		expect(released).toBe(false);
	});

	it('an EMPTY emit (no open judgement) surfaces nothing — no sidecar, a clean no-op', async () => {
		const {repo, itemPath} = seedGatedItem('empty');
		const before = readFileSync(join(repo, itemPath), 'utf8');
		const {gate, spawns} = spyGate({item: 'task:empty', questions: []});
		const result = await performAdvance({
			arg: 'empty',
			cwd: repo,
			surfaceGate: gate,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		// The gate WAS spawned (we had to ask), but it surfaced nothing.
		expect(spawns).toEqual(['task:empty']);
		expect(result.outcome).toBe('no-op');
		expect(existsSync(join(repo, 'work', 'questions', 'task-empty.md'))).toBe(
			false,
		);
		// The item body is untouched (no needsAnswers churn).
		expect(readFileSync(join(repo, itemPath), 'utf8')).toBe(before);
	});

	it('the gate failing routes a clean usage-error (never a silent surface) + releases the lock', async () => {
		const {repo} = seedGatedItem('boom');
		let released = false;
		const failingGate: SurfaceGate = async () => {
			throw new Error('agent produced no parseable emit');
		};
		const result = await performAdvance({
			arg: 'boom',
			cwd: repo,
			surfaceGate: failingGate,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => {
				released = true;
				return RELEASED;
			},
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		// No sidecar written; the lock WAS released (the borrow is short, always freed).
		expect(existsSync(join(repo, 'work', 'questions', 'task-boom.md'))).toBe(
			false,
		);
		expect(released).toBe(true);
	});
});
