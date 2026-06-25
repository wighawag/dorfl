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
import type {MintAdrOptions, MintAdrResult} from '../src/mint-adr.js';
import {
	newSidecar,
	serialiseSidecar,
	type SidecarModel,
} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import type {ApplyDecider} from '../src/apply-decide.js';
import type {DecisionVerdict} from '../src/decision-engine.js';
import {
	makeScratch,
	gitEnv,
	gitIn,
	seedRepoWithArbiter,
	raceClone,
	existsOnArbiterMain,
	pathOnArbiterMain,
	type Scratch,
} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * `advance-rung-triage` task — the observation TRIAGE rung + the
 * `observationTriage` gate, WIRED through the engine tick. Acceptance criteria
 * pinned at the engine
 * seam:
 *
 *   - QUESTION-GATED by DEFAULT: an untriaged observation surfaces a promote/keep/
 *     delete question and WAITS (no autonomous "worth building?" decision);
 *   - `observationTriage: 'auto'` gates a CONSERVATIVE auto-disposition — only
 *     duplicate→discharge-by-deletion / unambiguous-map; NEVER auto-deletes a
 *     NON-duplicate, NEVER auto-promotes a judgement call (an `auto:false` falls
 *     back to the question);
 *   - an answered "promote" CAS-creates a new backlog item keyed on the new
 *     identity; a same-slug new-item race ⇒ the loser fails CAS;
 *   - an answered observation flows through the AGENTIC apply decision (the
 *     subsumed triage): the agent's VERDICT chooses mint-task / mint-prd /
 *     delete-source / ask-follow-up (NO disposition token, NO resting `triaged:keep`
 *     state); a `delete` verdict DISCHARGES BY DELETION (the note is git rm-ed);
 *   - surface + apply remain ALWAYS allowed even with `observationTriage` in the
 *     question-gated `ask`/`off` modes.
 *
 * House CAS-seam + throwaway-repo style: the gates + the lock are injected; the
 * promote-via-CAS race runs against a REAL local arbiter (the only arbiter race).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-advance-triage-');
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
			questions: [{question: 'promote/keep/delete?'}],
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
	it('observationTriage auto + a DUPLICATE → auto-disposition WITHOUT a question (DISCHARGE the redundant note BY DELETION)', async () => {
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
		// A duplicate is a redundant copy of an already-captured signal — it is
		// DISCHARGED BY DELETION (the note is git rm-ed; no `Recommended: delete`
		// marker and no `triaged:duplicate` stamp linger).
		expect(existsSync(join(repo, itemPath))).toBe(false);
	});

	it('observationTriage auto + a MAP → DISCHARGED BY DELETION (no more triaged:keep; the mapping rides the commit message)', async () => {
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
		// There is no resting `triaged:keep` note any more: a `map` is settled onto its
		// existing home, so it is DISCHARGED BY DELETION (mirroring `duplicate`). The
		// note is gone; the mapped-onto identity + reason ride the commit message.
		expect(existsSync(join(repo, itemPath))).toBe(false);
		const commitMessage = gitIn(['log', '-1', '--format=%B', 'HEAD'], repo);
		expect(commitMessage).toContain('task:existing');
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
			questions: [{question: 'promote/keep/delete?'}],
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
				outcome: 'deleted',
				commit: 'deadbeef',
				itemPath: o.itemPath,
				message: 'deleted',
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
 * Seed an observation that is needsAnswers:true with a FULLY-answered sidecar —
 * exactly the `classify=apply` cell for an answered triage. The sidecar entry is
 * BINARY (no disposition token any more); what to DO with the answer is decided by
 * the AGENTIC apply decision (the injected {@link ApplyDecider}). Used for the
 * mint / delete / ask apply-path tests.
 */
function seedAnsweredObservation(
	repo: string,
	slug: string,
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
		{question: 'What becomes of this signal?'},
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

/** An apply-decider stub: ignores its input + returns the given canned verdict. */
function spyDecide(verdict: DecisionVerdict): {
	decide: ApplyDecider;
	calls: number;
} {
	const box = {calls: 0};
	const decide: ApplyDecider = async () => {
		box.calls++;
		return verdict;
	};
	return {
		decide,
		get calls() {
			return box.calls;
		},
	};
}

describe('advance — an answered observation flows through the AGENTIC apply decision', () => {
	it('verdict task → mint-task: CAS-creates a SELF-CONTAINED task + DELETES the observation+sidecar in the same commit (artifact type from the VERDICT, not a promote field)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const {itemPath, sidecarPath} = seedAnsweredObservation(
			seeded.repo,
			'prom',
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'seed answered observation'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const {decide} = spyDecide({outcome: 'task'});
		const result = await performAdvance({
			arg: 'obs:prom',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			applyDecide: decide,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('apply');
		// A NEW task was CAS-created on the arbiter keyed on the observation's slug.
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'prom')).toBe(true);
		// SELF-CONTAINMENT (decision 10): the spawned task carries the observation's
		// signal (not a back-pointer) so it is buildable on its own.
		const taskBody = gitIn(
			['show', 'arbiter/main:work/tasks/ready/prom.md'],
			seeded.repo,
		);
		expect(taskBody).toContain('A captured signal awaiting triage.');
		// The observation + its sidecar are DELETED on arbiter/main in the SAME
		// commit as the create (delete-on-promote).
		expect(pathOnArbiterMain(seeded.repo, itemPath)).toBe(false);
		expect(pathOnArbiterMain(seeded.repo, sidecarPath)).toBe(false);
	});

	it('verdict prd → mint-prd: the artifact type comes from the VERDICT (a PRD into prds/proposed)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		seedAnsweredObservation(seeded.repo, 'prdprom');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'seed answered observation'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const {decide} = spyDecide({outcome: 'prd'});
		const result = await performAdvance({
			arg: 'obs:prdprom',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			applyDecide: decide,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		// A `prd` verdict mints into prds/proposed (NOT tasks/ready) — the verdict
		// chose the artifact type.
		expect(
			pathOnArbiterMain(seeded.repo, 'work/prds/proposed/prdprom.md'),
		).toBe(true);
		expect(pathOnArbiterMain(seeded.repo, 'work/tasks/ready/prdprom.md')).toBe(
			false,
		);
	});

	it('SELF-CONTAINMENT regression: a verdict with a drafted body carries the answer(s) into the spawned artifact, source deleted in the same commit', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const {itemPath, sidecarPath} = seedAnsweredObservation(
			seeded.repo,
			'selfc',
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'seed answered observation'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const {decide} = spyDecide({
			outcome: 'task',
			taskBody:
				'## What to build\n\nDISTINCT-SELF-CONTAINED-MARKER carried from the answer.\n',
		});
		const result = await performAdvance({
			arg: 'obs:selfc',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			applyDecide: decide,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		// The drafted, self-contained body landed in the spawned task…
		const taskBody = gitIn(
			['show', 'arbiter/main:work/tasks/ready/selfc.md'],
			seeded.repo,
		);
		expect(taskBody).toContain('DISTINCT-SELF-CONTAINED-MARKER');
		// …and the source + sidecar were deleted in the SAME commit as the create.
		expect(pathOnArbiterMain(seeded.repo, itemPath)).toBe(false);
		expect(pathOnArbiterMain(seeded.repo, sidecarPath)).toBe(false);
	});

	it('a same-slug new-item race ⇒ exactly one mint creates, the loser fails CAS', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');
		for (const dir of [a, b]) {
			seedAnsweredObservation(dir, 'dupprom');
			gitIn(['add', '-A'], dir);
			gitIn(['commit', '-q', '-m', 'answered observation'], dir);
		}
		const {decide} = spyDecide({outcome: 'task'});
		const [ra, rb] = await Promise.all([
			performAdvance({
				arg: 'obs:dupprom',
				cwd: a,
				arbiter: 'arbiter',
				applyDecide: decide,
				acquireLock: async () => ACQUIRED,
				releaseLock: async () => RELEASED,
			}),
			performAdvance({
				arg: 'obs:dupprom',
				cwd: b,
				arbiter: 'arbiter',
				applyDecide: decide,
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

	it('the mint is routed THROUGH the injected promote/CAS seam, keyed on the new identity, artifact from the verdict', async () => {
		const {repo} = seedObservation('seamprom');
		seedAnsweredObservation(repo, 'seamprom');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'answered observation'], repo);

		const calls: PromoteObservationOptions[] = [];
		const promote = async (
			o: PromoteObservationOptions,
		): Promise<PromoteObservationResult> => {
			calls.push(o);
			return {
				outcome: 'promoted',
				exitCode: 0,
				newItemPath: 'work/tasks/ready/seamprom.md',
				message: 'promoted',
			};
		};
		const {decide} = spyDecide({outcome: 'task'});
		const result = await performAdvance({
			arg: 'obs:seamprom',
			cwd: repo,
			applyDecide: decide,
			promote,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].item).toBe('observation:seamprom');
		expect(calls[0].artifact).toBe('task');
	});

	it('verdict ask → ask-follow-up: appends qN+1 + re-pauses (needsAnswers stays true, prior answer preserved, one batch)', async () => {
		const {repo} = seedObservation('askmore');
		const {itemPath, sidecarPath} = seedAnsweredObservation(repo, 'askmore');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'answered observation'], repo);

		const {decide} = spyDecide({
			outcome: 'ask',
			question: 'Which subsystem does this touch?',
		});
		const result = await performAdvance({
			arg: 'obs:askmore',
			cwd: repo,
			applyDecide: decide,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		// A re-pause idles the item (awaiting the human's new answer).
		expect(result.outcome).toBe('no-op');
		// The sidecar STILL exists; needsAnswers stays true (re-paused).
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
		expect(
			parseFrontmatter(readFileSync(join(repo, itemPath), 'utf8')).needsAnswers,
		).toBe(true);
		// q1 preserved (answer intact), q2 appended (the follow-up, pending).
		const sidecarText = readFileSync(join(repo, sidecarPath), 'utf8');
		expect(sidecarText).toContain('Which subsystem does this touch?');
		expect(sidecarText).toMatch(/allAnswered=false/);
	});

	it('verdict delete → delete-source: DISCHARGED BY DELETION (the note + sidecar git rm-ed, the reason in the commit message; DIRECT, no confirm)', async () => {
		const {repo} = seedObservation('del');
		const {itemPath, sidecarPath} = seedAnsweredObservation(repo, 'del');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'answered observation'], repo);

		const {decide} = spyDecide({
			outcome: 'delete',
			deleteReason: 'the answer says drop it — DISTINCT-DELETE-REASON',
		});
		const result = await performAdvance({
			arg: 'obs:del',
			cwd: repo,
			applyDecide: decide,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		// The note AND its sidecar leave the inbox by DELETION — no resting marker.
		expect(existsSync(join(repo, itemPath))).toBe(false);
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		// The reason rides the commit message (git history is the archive).
		const commitMessage = gitIn(['log', '-1', '--format=%B', 'HEAD'], repo);
		expect(commitMessage).toContain('DISTINCT-DELETE-REASON');
	});

	it('verdict adr → mint-adr: CAS-creates a SELF-CONTAINED ADR in docs/adr/ + DELETES the observation+sidecar in the same commit (the off-board sibling route)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const {itemPath, sidecarPath} = seedAnsweredObservation(
			seeded.repo,
			'adrx',
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'seed answered observation'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const {decide} = spyDecide({
			outcome: 'adr',
			adrTitle: 'Record the settled decision',
		});
		const result = await performAdvance({
			arg: 'obs:adrx',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			applyDecide: decide,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('apply');
		// The ADR landed in docs/adr/ on arbiter/main (NOT in work/).
		expect(pathOnArbiterMain(seeded.repo, 'docs/adr/adrx.md')).toBe(true);
		const adrBody = gitIn(
			['show', 'arbiter/main:docs/adr/adrx.md'],
			seeded.repo,
		);
		// SELF-CONTAINMENT: the ADR carries the decision's WHY (the answer) + the
		// source context, so it reads alone (the precondition for the source delete).
		expect(adrBody).toContain('# ADR: Record the settled decision');
		expect(adrBody).toContain('A captured signal awaiting triage.');
		expect(adrBody).toContain('answered');
		// The observation + its sidecar are DELETED on arbiter/main in the SAME commit
		// as the ADR create (delete-on-promote).
		expect(pathOnArbiterMain(seeded.repo, itemPath)).toBe(false);
		expect(pathOnArbiterMain(seeded.repo, sidecarPath)).toBe(false);
	});

	it('mint-adr is routed THROUGH the injected mintAdr seam (the sibling of promote), keyed on the new ADR identity', async () => {
		const {repo} = seedObservation('adrseam');
		seedAnsweredObservation(repo, 'adrseam');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'answered observation'], repo);

		const calls: MintAdrOptions[] = [];
		const mintAdr = async (o: MintAdrOptions): Promise<MintAdrResult> => {
			calls.push(o);
			return {
				outcome: 'minted',
				exitCode: 0,
				adrPath: 'docs/adr/adrseam.md',
				message: 'minted',
			};
		};
		const {decide} = spyDecide({outcome: 'adr', adrTitle: 'seam'});
		const result = await performAdvance({
			arg: 'obs:adrseam',
			cwd: repo,
			applyDecide: decide,
			mintAdr,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(calls).toHaveLength(1);
		expect(calls[0].item).toBe('observation:adrseam');
		// The answered question(s) are threaded so the built body is self-contained.
		expect(calls[0].answers?.length).toBeGreaterThan(0);
	});
});
