import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {parseFrontmatter} from '../src/frontmatter.js';
import {performAdvanceAuto} from '../src/advance-drivers.js';
import type {ApplyDecider} from '../src/apply-decide.js';
import type {DecisionVerdict} from '../src/decision-engine.js';
import {mergeConfig} from '../src/config.js';
import {
	newSidecar,
	serialiseSidecar,
	type SidecarModel,
} from '../src/sidecar.js';
import {
	makeScratch,
	gitIn,
	seedRepoWithArbiter,
	pathOnArbiterMain,
	type Scratch,
} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * `followup-nits-route-answered-observation-sidecar-to-apply-pool` — the missing
 * end-to-end acceptance test (source task's acceptance criterion (c)) for the
 * full CLASSIFIER → APPLY → AGENTIC-DECIDE chain on an ANSWERED OBSERVATION.
 *
 * The classifier + mirror-gather parity tests (`lifecycle-pools.test.ts` +
 * `advance-autopick-lifecycle-mirror.test.ts`) already pin the routing rule
 * (an answered-sidecar observation → APPLY, ungated). This test proves the
 * downstream half: given only an answered-observation sidecar on disk (BOTH
 * create-gates off — the calm-at-rest interim), `performAdvanceAuto` MUST
 * auto-select the observation into the APPLY pool via `buildLifecyclePools`,
 * run the apply rung's agentic decision, and materialise the chosen artifact
 * while atomically removing the source + sidecar.
 *
 * House pattern: throwaway git repos + a real local arbiter (the only arbiter
 * race), an injected `applyDecide` for a deterministic verdict, and the SAME
 * assertion helpers the existing mint-task apply tests use
 * (`pathOnArbiterMain`) — end-to-end through the driver (`performAdvanceAuto`)
 * to prove the classifier feeds the apply rung, not just that the apply rung
 * works on an explicit `obs:<slug>` arg.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-answered-obs-apply-e2e-');
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
 * Seed an OBSERVATION at `work/notes/observations/<slug>.md` with `needsAnswers`
 * true, plus a FULLY-ANSWERED sidecar at `work/questions/observation-<slug>.md`.
 * The observation is committed onto the repo's `main` so the arbiter path can
 * observe it there. No `triaged:` marker — the normal path an answered
 * observation lands on in the field.
 */
function seedAnsweredObservationOnMain(
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
			'date: 2026-07-10',
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
		entries: model.entries.map((e) => ({...e, answer: 'mint a task for it'})),
	};
	const sidecarPath = `work/questions/observation-${slug}.md`;
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));
	return {itemPath, sidecarPath};
}

/** An apply-decider stub: returns the given canned verdict, records call count. */
function spyDecide(verdict: DecisionVerdict): {
	decide: ApplyDecider;
	calls: {count: number};
} {
	const box = {count: 0};
	const decide: ApplyDecider = async () => {
		box.count++;
		return verdict;
	};
	return {decide, calls: box};
}

describe('answered observation apply — end-to-end through the driver (classifier → apply → agentic-decide)', () => {
	it('mint-task: `performAdvanceAuto` auto-selects the answered observation via `buildLifecyclePools` (BOTH create-gates OFF), runs the apply rung, mints the task on arbiter/main, and DELETES the observation + sidecar in the same commit', async () => {
		// Seed an answered observation onto the repo (no other work — the observation
		// is the ONLY candidate the classifier can enumerate).
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const {itemPath, sidecarPath} = seedAnsweredObservationOnMain(
			seeded.repo,
			'e2e-mint',
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'seed answered observation'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const {decide, calls} = spyDecide({
			outcome: 'task',
			taskBody:
				'## What to build\n\nDISTINCT-E2E-MARKER carried from the human answer.\n',
		});

		const result = await performAdvanceAuto({
			cwd: seeded.repo,
			arbiter: 'arbiter',
			applyDecide: decide,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
			// BOTH create-gates OFF (the calm interim default); the answered
			// observation must STILL be selected — APPLY is CONSUME, always-on.
			lifecycleGates: {triage: false, surface: false},
			// A calm config: no build/task autonomy, no observationTriage — the ONLY
			// way the observation can be picked is via the apply sub-pool.
			config: mergeConfig({
				autoBuild: false,
				autoTask: false,
				observationTriage: 'off',
			}),
			count: 5,
		});

		expect(result.exitCode).toBe(0);
		expect(result.results).toHaveLength(1);
		const only = result.results[0];
		expect(only.exitCode).toBe(0);
		expect(only.outcome).toBe('advanced');
		expect(only.rung).toBe('apply');
		// The agentic decider was consulted exactly once — the apply rung DID reach
		// the agentic-decide seam (classifier → apply → decide, wired through).
		expect(calls.count).toBe(1);
		// The DECIDED ARTIFACT materialised on arbiter/main: a self-contained task
		// keyed on the observation's slug, carrying the drafted body.
		expect(pathOnArbiterMain(seeded.repo, 'work/tasks/ready/e2e-mint.md')).toBe(
			true,
		);
		const taskBody = gitIn(
			['show', 'arbiter/main:work/tasks/ready/e2e-mint.md'],
			seeded.repo,
		);
		expect(taskBody).toContain('DISTINCT-E2E-MARKER');
		// Source observation + sidecar are REMOVED — on arbiter/main (the create
		// commit) AND locally (the working checkout was refreshed to the new tip).
		expect(pathOnArbiterMain(seeded.repo, itemPath)).toBe(false);
		expect(pathOnArbiterMain(seeded.repo, sidecarPath)).toBe(false);
		expect(existsSync(join(seeded.repo, itemPath))).toBe(false);
		expect(existsSync(join(seeded.repo, sidecarPath))).toBe(false);
	});

	it('delete-source: `performAdvanceAuto` on an answered observation + a `delete` verdict discharges by deletion — source + sidecar removed in one revertible commit, no artifact on the work board', async () => {
		// The delete-source verdict is the local-only path (no arbiter mint), so it
		// exercises the classifier → apply → decide → `applyAnsweredQuestions`
		// discharge branch end-to-end without needing an arbiter round-trip.
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const {itemPath, sidecarPath} = seedAnsweredObservationOnMain(
			seeded.repo,
			'e2e-del',
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'seed answered observation'], seeded.repo);

		const {decide} = spyDecide({
			outcome: 'delete',
			deleteReason: 'DISTINCT-E2E-DELETE-REASON — the answer says drop it',
		});
		const result = await performAdvanceAuto({
			cwd: seeded.repo,
			arbiter: 'arbiter',
			applyDecide: decide,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
			lifecycleGates: {triage: false, surface: false},
			config: mergeConfig({
				autoBuild: false,
				autoTask: false,
				observationTriage: 'off',
			}),
			count: 5,
		});

		expect(result.exitCode).toBe(0);
		expect(result.results).toHaveLength(1);
		expect(result.results[0].outcome).toBe('advanced');
		expect(result.results[0].rung).toBe('apply');
		// Discharge-by-deletion: source + sidecar are gone locally, the reason
		// rides the commit message (git history = archive).
		expect(existsSync(join(seeded.repo, itemPath))).toBe(false);
		expect(existsSync(join(seeded.repo, sidecarPath))).toBe(false);
		expect(gitIn(['log', '-1', '--format=%B', 'HEAD'], seeded.repo)).toContain(
			'DISTINCT-E2E-DELETE-REASON',
		);
	});

	it('resolve: `performAdvanceAuto` on an answered observation + a `resolve` verdict settles the loop WITHOUT minting and RETAINS the note — answers harvested into the body, `needsAnswers` cleared, sidecar deleted, no task/spec/adr created, note file kept', async () => {
		// The resolve verdict is the local-only "mint nothing, keep the note" path
		// (task `apply-decide-resolve-verdict-mint-nothing`). It routes to the
		// EXISTING resolve-fully branch of `applyAnsweredQuestions`, so it needs no
		// arbiter round-trip — it exercises the classifier → apply → decide →
		// `applyAnsweredQuestions` resolve-fully chain end-to-end.
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const {itemPath, sidecarPath} = seedAnsweredObservationOnMain(
			seeded.repo,
			'e2e-resolve',
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'seed answered observation'], seeded.repo);

		const {decide, calls} = spyDecide({
			outcome: 'resolve',
			resolveReason: 'acknowledged; keep this on record, no artifact to mint',
		});
		const result = await performAdvanceAuto({
			cwd: seeded.repo,
			arbiter: 'arbiter',
			applyDecide: decide,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
			lifecycleGates: {triage: false, surface: false},
			config: mergeConfig({
				autoBuild: false,
				autoTask: false,
				observationTriage: 'off',
			}),
			count: 5,
		});

		expect(result.exitCode).toBe(0);
		expect(result.results).toHaveLength(1);
		expect(result.results[0].outcome).toBe('advanced');
		expect(result.results[0].rung).toBe('apply');
		// The agentic decider was consulted exactly once.
		expect(calls.count).toBe(1);

		// The NOTE is RETAINED (not deleted, unlike the `delete` sibling) and now
		// carries the harvested answers; the sidecar is GONE and the flag is cleared.
		expect(existsSync(join(seeded.repo, itemPath))).toBe(true);
		expect(existsSync(join(seeded.repo, sidecarPath))).toBe(false);
		const body = readFileSync(join(seeded.repo, itemPath), 'utf8');
		expect(body).toContain('## Applied answers');
		expect(body).toContain('mint a task for it');
		expect(parseFrontmatter(body).needsAnswers).toBe(false);

		// NOTHING was minted: no task, spec, or adr materialised for this slug.
		expect(
			existsSync(join(seeded.repo, 'work/tasks/ready/e2e-resolve.md')),
		).toBe(false);
		expect(
			existsSync(join(seeded.repo, 'work/specs/proposed/e2e-resolve.md')),
		).toBe(false);
		expect(existsSync(join(seeded.repo, 'docs/adr'))).toBe(false);
	});
});
