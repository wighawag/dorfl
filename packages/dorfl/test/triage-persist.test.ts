import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {
	autoDispositionObservation,
	promoteObservation,
} from '../src/triage-persist.js';
import {isTriagedKeep} from '../src/apply-persist.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {
	newSidecar,
	serialiseSidecar,
	type SidecarModel,
} from '../src/sidecar.js';
import {
	makeScratch,
	gitEnv,
	gitIn,
	seedRepoWithArbiter,
	raceClone,
	racerEnv,
	existsOnArbiterMain,
	pathOnArbiterMain,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `advance-rung-triage` task — the engine-owned TRIAGE PERSIST primitives over a
 * throwaway git repo (house CAS-seam style, the sibling of apply-persist.test.ts):
 *
 *   - {@link autoDispositionObservation}: the conservative auto-disposition WRITE
 *     (duplicate → recommend delete + triaged:duplicate; map → triaged:keep) — ONE
 *     commit, no lifecycle move, NEVER an auto-delete;
 *   - {@link promoteObservation}: promote → new-item creation through the CAS keyed
 *     on the new identity + resolve the observation; a same-slug race ⇒ the loser
 *     fails the CAS.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-triage-persist-');
});
afterEach(() => {
	scratch.cleanup();
});

function seedObs(repo: string, slug: string): string {
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
			'A signal.',
			'',
		].join('\n'),
	);
	return itemPath;
}

describe('autoDispositionObservation — the conservative no-question write', () => {
	it('duplicate → RECOMMENDS deletion + triaged:duplicate, NEVER deletes (one commit)', () => {
		const repo = join(scratch.root, 'p');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const itemPath = seedObs(repo, 'dup');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed'], repo);

		const before = gitIn(['rev-parse', 'HEAD'], repo).trim();
		const result = autoDispositionObservation({
			cwd: repo,
			item: 'observation:dup',
			itemPath,
			kind: 'duplicate',
			existing: 'observation:orig',
			reason: 'same signal',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('delete-recommended');
		// The file is NOT deleted (the human deletes per the capture-bucket contract).
		expect(existsSync(join(repo, itemPath))).toBe(true);
		const body = readFileSync(join(repo, itemPath), 'utf8');
		expect(body).toContain('observation:orig');
		expect(/^triaged:\s*duplicate/m.test(body)).toBe(true);
		// Exactly one new commit touching ONLY the observation.
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).not.toBe(before);
		const touched = gitIn(['show', '--name-only', '--format=', 'HEAD'], repo)
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		expect(touched).toEqual([itemPath]);
	});

	it('map → records the mapping + triaged:keep (drops out of the pool)', () => {
		const repo = join(scratch.root, 'p');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const itemPath = seedObs(repo, 'map');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed'], repo);

		const result = autoDispositionObservation({
			cwd: repo,
			item: 'observation:map',
			itemPath,
			kind: 'map',
			existing: 'task:home',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('kept');
		const body = readFileSync(join(repo, itemPath), 'utf8');
		expect(body).toContain('task:home');
		expect(isTriagedKeep(body)).toBe(true);
	});
});

/**
 * The distinctive mechanism/fix signal text the self-contained promotion must
 * carry into the spawned task body (NOT a back-pointer phrase).
 */
const MECHANISM_SIGNAL =
	'claim-cas.ts:270 exits 2 on a stale snapshot; add a --quiet-if-gone flag.';
const OPEN_QUESTION_SIGNAL =
	'Should --quiet-if-gone be the default, or opt-in behind a flag?';

/** Seed an answered-promote observation + sidecar in a repo (working tree). */
function seedAnsweredPromote(repo: string, slug: string): string {
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
			'## What was seen',
			'',
			`A signal awaiting triage. ${MECHANISM_SIGNAL}`,
			'',
			'## Open questions',
			'',
			`1. ${OPEN_QUESTION_SIGNAL}`,
			'',
		].join('\n'),
	);
	let model: SidecarModel = newSidecar(`observation:${slug}`, [
		{question: 'Promote?', disposition: 'promote-task'},
	]);
	model = {
		...model,
		entries: model.entries.map((e) => ({...e, answer: 'yes, promote'})),
	};
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(
		join(repo, `work/questions/observation-${slug}.md`),
		serialiseSidecar(model),
	);
	return itemPath;
}

describe('promoteObservation — new-item creation through the CAS', () => {
	it('creates a SELF-CONTAINED task on the arbiter + DELETES the observation + sidecar in the SAME commit (exit 0)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = seedAnsweredPromote(seeded.repo, 'prom');
		const sidecarPath = 'work/questions/observation-prom.md';
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:prom',
			itemPath,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('promoted');
		expect(result.exitCode).toBe(0);
		expect(result.newItemPath).toBe('work/tasks/ready/prom.md');
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'prom')).toBe(true);

		// The spawned task body carries the observation's REAL mechanism/fix signal
		// (self-contained, not a back-pointer phrase).
		const taskBody = gitIn(
			['show', 'arbiter/main:work/tasks/ready/prom.md'],
			seeded.repo,
		);
		expect(taskBody).toContain(MECHANISM_SIGNAL);
		expect(taskBody).not.toMatch(/Promoted from observation/i);
		// The observation's open questions are transcribed + needsAnswers reflects them.
		expect(taskBody).toContain('## Open questions');
		expect(taskBody).toContain(OPEN_QUESTION_SIGNAL);
		expect(parseFrontmatter(taskBody).needsAnswers).toBe(true);

		// The observation + its sidecar are DELETED on the arbiter (discharge by
		// deletion).
		expect(pathOnArbiterMain(seeded.repo, itemPath)).toBe(false);
		expect(pathOnArbiterMain(seeded.repo, sidecarPath)).toBe(false);

		// The create + the two deletions ride ONE atomic commit on arbiter/main
		// (`--no-renames` so git's similarity heuristic does not fold the
		// note→task content lift into an `R`ename — we want the literal A + D pair).
		const touched = gitIn(
			['show', '--name-status', '--no-renames', '--format=', 'arbiter/main'],
			seeded.repo,
		)
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		expect(touched).toContain(`A\twork/tasks/ready/prom.md`);
		expect(touched).toContain(`D\t${itemPath}`);
		expect(touched).toContain(`D\t${sidecarPath}`);
	});

	it('a promoted observation with NO open questions clears needsAnswers on the task', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = `work/notes/observations/noq.md`;
		mkdirSync(join(seeded.repo, 'work', 'notes', 'observations'), {
			recursive: true,
		});
		writeFileSync(
			join(seeded.repo, itemPath),
			[
				'---',
				'title: noq',
				'needsAnswers: true',
				'---',
				'',
				`Fully-scoped signal: ${MECHANISM_SIGNAL}`,
				'',
			].join('\n'),
		);
		let model: SidecarModel = newSidecar('observation:noq', [
			{question: 'Promote?', disposition: 'promote-task'},
		]);
		model = {
			...model,
			entries: model.entries.map((e) => ({...e, answer: 'yes'})),
		};
		mkdirSync(join(seeded.repo, 'work', 'questions'), {recursive: true});
		writeFileSync(
			join(seeded.repo, 'work/questions/observation-noq.md'),
			serialiseSidecar(model),
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:noq',
			itemPath,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('promoted');
		const taskBody = gitIn(
			['show', 'arbiter/main:work/tasks/ready/noq.md'],
			seeded.repo,
		);
		expect(taskBody).toContain(MECHANISM_SIGNAL);
		expect(taskBody).not.toContain('## Open questions');
		expect(parseFrontmatter(taskBody).needsAnswers).toBe(false);
	});

	it('honours an explicit newSlug (the promoted identity, keyed by the new path)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = seedAnsweredPromote(seeded.repo, 'src');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:src',
			itemPath,
			newSlug: 'renamed-target',
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('promoted');
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'renamed-target')).toBe(
			true,
		);
	});

	it('a same-slug new-item race ⇒ exactly one promotes, the loser fails CAS (no special case)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		// Distinct committer identity per racer (raceClone + racerEnv) so the two
		// create commits get DISTINCT shas — as two real machines would — and the
		// loser loses through the genuine path-exists/lease CAS, not a fixture
		// sha-collision. See racerEnv for the full why.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');
		for (const dir of [a, b]) {
			seedAnsweredPromote(dir, 'dup');
			gitIn(['add', '-A'], dir);
			gitIn(['commit', '-q', '-m', 'answered'], dir);
		}

		const [ra, rb] = await Promise.all([
			promoteObservation({
				cwd: a,
				item: 'observation:dup',
				itemPath: 'work/notes/observations/dup.md',
				arbiter: 'arbiter',
				env: racerEnv('a'),
			}),
			promoteObservation({
				cwd: b,
				item: 'observation:dup',
				itemPath: 'work/notes/observations/dup.md',
				arbiter: 'arbiter',
				env: racerEnv('b'),
			}),
		]);

		const won = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(won[0].outcome).toBe('promoted');
		expect(lost[0].outcome).toBe('lost');
	});

	it('a same-slug new-item race with IDENTICAL committer identity ⇒ STILL exactly one promotes (CAS serialises via the per-attempt nonce, not via sha-distinctness)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		// The product-layer INVERSE of the distinct-identity race above: both racers
		// promote under the SAME committer identity (the SAME gitEnv()), building the
		// SAME tree + message off the SAME base. WITHOUT the write seam's per-attempt
		// CAS-Nonce their create commits would be byte-identical (one sha) and the
		// loser's push would degrade to a no-op "Everything up-to-date" that the
		// post-push verify spuriously accepts → two winners. With the nonce the two
		// shas are DISTINCT, so the loser's --force-with-lease push is genuinely
		// rejected and the verify correctly fails for it — exactly one winner, with NO
		// identity distinctness.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');
		for (const dir of [a, b]) {
			seedAnsweredPromote(dir, 'dup');
			gitIn(['add', '-A'], dir);
			gitIn(['commit', '-q', '-m', 'answered'], dir);
		}

		const [ra, rb] = await Promise.all([
			promoteObservation({
				cwd: a,
				item: 'observation:dup',
				itemPath: 'work/notes/observations/dup.md',
				arbiter: 'arbiter',
				// IDENTICAL identity for BOTH racers (the SAME gitEnv()), NOT racerEnv.
				env: gitEnv(),
			}),
			promoteObservation({
				cwd: b,
				item: 'observation:dup',
				itemPath: 'work/notes/observations/dup.md',
				arbiter: 'arbiter',
				env: gitEnv(),
			}),
		]);

		const won = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(won[0].outcome).toBe('promoted');
		expect(lost[0].outcome).toBe('lost');
		expect(existsOnArbiterMain(seeded.repo, 'backlog', 'dup')).toBe(true);
	});

	it('a LOST race leaves the observation UNRESOLVED for a retry (the loser backs off)', async () => {
		// Pre-create the target path on the arbiter so the promote always loses.
		const seeded = seedRepoWithArbiter(scratch.root, ['taken']);
		const itemPath = seedAnsweredPromote(seeded.repo, 'taken');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:taken',
			itemPath,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('lost');
		expect(result.exitCode).toBe(2);
		// The loser DELETES nothing: the observation + its sidecar are STILL present
		// (left intact + unresolved for a retry).
		expect(existsSync(join(seeded.repo, itemPath))).toBe(true);
		expect(
			existsSync(join(seeded.repo, 'work/questions/observation-taken.md')),
		).toBe(true);
	});
});
