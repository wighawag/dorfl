import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {performAdvance} from '../src/advance.js';
import type {SurfaceGate, SurfaceEmit} from '../src/surface-gate.js';
import type {ApplyDecider} from '../src/apply-decide.js';
import type {DecisionVerdict} from '../src/decision-engine.js';
import {
	newSidecar,
	serialiseSidecar,
	type SidecarModel,
} from '../src/sidecar.js';
import {
	makeScratch,
	gitIn,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	type Scratch,
} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * `advance-surface-limbo-observation-loudly-instead-of-silent-no-op` task.
 *
 * The trap: an observation whose human triage answer is written into an in-BODY
 * "Applied answers" block instead of the sidecar/frontmatter channels the
 * engine reads is INVISIBLE to the runner:
 *
 *   - `ledger-read.ts` reads triage-vs-settled only from `triaged:` frontmatter;
 *   - `triage-persist.ts`'s promote path only fires on an answered sidecar; and
 *   - the surfacer sees the body already reads as settled ⇒ emits EMPTY.
 *
 * Net: untriaged (re-enumerated forever) + un-surfaceable + un-promotable, a
 * silent exit-0 no-op on every propose tick. This task makes that limbo shape
 * EXIT NON-ZERO with a diagnostic naming the two valid channels (the sidecar
 * path + `triaged:` frontmatter) so it becomes red instead of a silent stall.
 * The engine does NOT (and will not) honour in-body disposition prose.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-advance-limbo-');
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

/**
 * The LIMBO shape: an observation with `needsAnswers:false` (or unset), NO
 * `triaged:` marker, an in-body "## Applied answers" block containing an
 * in-prose triage decision, and NO sidecar file. Exactly the trap the source
 * observation names.
 */
function seedLimboObservation(
	repo: string,
	slug: string,
	opts: {triaged?: string; needsAnswers?: boolean} = {},
): {itemPath: string} {
	const itemPath = `work/notes/observations/${slug}.md`;
	mkdirSync(join(repo, 'work', 'notes', 'observations'), {recursive: true});
	const fm: string[] = ['---', `title: ${slug}`, 'date: 2026-06-21'];
	if (opts.needsAnswers !== undefined) {
		fm.push(`needsAnswers: ${opts.needsAnswers}`);
	}
	if (opts.triaged !== undefined) {
		fm.push(`triaged: ${opts.triaged}`);
	}
	fm.push('---');
	writeFileSync(
		join(repo, itemPath),
		[
			...fm,
			'',
			'Noticed a thing worth capturing.',
			'',
			'## Applied answers 2026-06-22',
			'',
			'- q1: promote-slice — this signal should become its own task.',
			'',
		].join('\n'),
	);
	return {itemPath};
}

/** A throwaway repo with one seeded LIMBO observation. */
function seedRepoWithLimbo(slug = 'stuck'): {repo: string; itemPath: string} {
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	const {itemPath} = seedLimboObservation(repo, slug);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed limbo observation'], repo);
	return {repo, itemPath};
}

/** A gate stub returning a canned emit (default: EMPTY — the "no open judgement" honest result). */
function spySurface(emit: SurfaceEmit = {item: '', questions: []}): {
	gate: SurfaceGate;
	spawns: string[];
} {
	const spawns: string[] = [];
	const gate: SurfaceGate = async (input) => {
		spawns.push(input.item);
		return {...emit, item: input.item};
	};
	return {gate, spawns};
}

/** An apply-decider stub returning a canned verdict (for the happy-path regression). */
function spyDecide(verdict: DecisionVerdict): ApplyDecider {
	return async () => verdict;
}

describe('advance — an untriaged observation in the in-body limbo exits LOUDLY', () => {
	it('REPRO: no triaged: + no sidecar + surfacer emits EMPTY ⇒ exit NON-ZERO with a diagnostic naming both valid channels', async () => {
		const {repo} = seedRepoWithLimbo('stuck');
		const {gate, spawns} = spySurface();

		const notes: string[] = [];
		const result = await performAdvance({
			arg: 'obs:stuck',
			cwd: repo,
			surfaceGate: gate,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
			note: (m) => notes.push(m),
		});

		// The surfacer WAS asked (only an empty emit trips the limbo path).
		expect(spawns).toEqual(['observation:stuck']);
		// Loudly non-zero (a usage-error a human must reconcile), NOT the old silent no-op.
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.rung).toBe('triage-observation');
		// The diagnostic names BOTH valid channels + calls out the in-body trap.
		expect(result.message).toContain('limbo');
		expect(result.message).toContain('work/questions/observation-stuck.md');
		expect(result.message).toContain('triaged:');
		expect(result.message).toContain('BODY');
		expect(result.message).toContain('INVISIBLE');
		// And it is echoed to the note sink so a CI log surfaces it.
		expect(notes.join('\n')).toContain('limbo');
		// The engine did NOT invent a sidecar (one channel — the human authors it).
		expect(
			existsSync(join(repo, 'work', 'questions', 'observation-stuck.md')),
		).toBe(false);
	});

	it('NON-REPRO: same body shape but WITH an answered `disposition: promote` sidecar ⇒ promote fires as today (no regression)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		// Same in-body Applied-answers shape as the limbo repro…
		seedLimboObservation(seeded.repo, 'happy', {needsAnswers: true});
		// …but PLUS the answered sidecar (the channel the engine reads). An
		// answered observation is the AGENTIC apply path: the agent's verdict
		// picks the artifact (task here) — the disposition token is retired.
		let model: SidecarModel = newSidecar('observation:happy', [
			{question: 'What becomes of this signal?'},
		]);
		model = {
			...model,
			entries: model.entries.map((e) => ({...e, answer: 'promote-slice'})),
		};
		mkdirSync(join(seeded.repo, 'work', 'questions'), {recursive: true});
		writeFileSync(
			join(seeded.repo, 'work', 'questions', 'observation-happy.md'),
			serialiseSidecar(model),
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'seed answered observation'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await performAdvance({
			arg: 'obs:happy',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			applyDecide: spyDecide({outcome: 'task'}),
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('apply');
		// Promote fired — a new backlog task landed on the arbiter.
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'happy')).toBe(true);
	});

	it('NON-REPRO: same body shape but WITH `triaged: keep` in frontmatter ⇒ treated as settled, no loud-limbo exit', async () => {
		const repo = join(scratch.root, 'project');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		seedLimboObservation(repo, 'settled', {triaged: 'keep'});
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed settled observation'], repo);

		const {gate, spawns} = spySurface();
		const result = await performAdvance({
			arg: 'obs:settled',
			cwd: repo,
			surfaceGate: gate,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		// Empty emit + `triaged:` set ⇒ the calm no-op the engine has always given.
		expect(spawns).toEqual(['observation:settled']);
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('no-op');
	});

	it('NON-REPRO: an untriaged observation the surfacer DOES have a question for ⇒ sidecar written as today, no loud-limbo exit', async () => {
		const {repo} = seedRepoWithLimbo('asked');
		const {gate, spawns} = spySurface({
			item: 'observation:asked',
			questions: [{question: 'What becomes of this signal?'}],
		});

		const result = await performAdvance({
			arg: 'obs:asked',
			cwd: repo,
			surfaceGate: gate,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(spawns).toEqual(['observation:asked']);
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		// The sidecar WAS written — the normal question-gated path.
		expect(
			existsSync(join(repo, 'work', 'questions', 'observation-asked.md')),
		).toBe(true);
	});
});
