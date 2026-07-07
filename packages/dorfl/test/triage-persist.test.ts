import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {
	autoDispositionObservation,
	promoteObservation,
} from '../src/triage-persist.js';
import {run} from '../src/git.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {extractPromptSection, resolveTask} from '../src/prompt.js';
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
 *     — BOTH no-question cases DISCHARGE the redundant note BY DELETION (git rm-ed
 *     in a standalone commit with the relationship + reason in the message; there
 *     is no resting triaged:keep state any more) — ONE commit, NEVER an
 *     auto-delete of a NON-redundant signal;
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
	it('duplicate → DISCHARGED BY DELETION (the redundant note is git rm-ed in a standalone commit, reason + duplicated-of in the message, no residue)', () => {
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
		expect(result.outcome).toBe('deleted');
		// A duplicate is a redundant copy — it leaves the inbox by being DELETED. No
		// `## Recommended: delete (duplicate)` marker and no `triaged:duplicate` stamp
		// linger; the note is simply gone, both on disk and in the tree.
		expect(existsSync(join(repo, itemPath))).toBe(false);
		expect(
			run('git', ['cat-file', '-e', `HEAD:${itemPath}`], repo, {env: gitEnv()})
				.status,
		).not.toBe(0);
		// Exactly one new commit, a STANDALONE delete touching ONLY the observation.
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).not.toBe(before);
		const touched = gitIn(['show', '--name-status', '--format=', 'HEAD'], repo)
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		expect(touched).toEqual([`D\t${itemPath}`]);
		// The duplicated-of identity + reason ride the commit MESSAGE (git history
		// is the archive).
		const commitMessage = gitIn(['log', '-1', '--format=%B', 'HEAD'], repo);
		expect(commitMessage).toContain('observation:orig');
		expect(commitMessage).toContain('same signal');
	});

	it('map → DISCHARGED BY DELETION (no more triaged:keep; the note git rm-ed in a standalone commit, the mapped-onto + reason in the message)', () => {
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
			reason: 'already covered there',
			env: gitEnv(),
		});
		// There is no resting `triaged:keep` note any more: a `map` is already covered
		// by the item it maps onto, so it is DISCHARGED BY DELETION (mirroring
		// `duplicate`). The note is gone, both on disk and in the tree.
		expect(result.outcome).toBe('deleted');
		expect(existsSync(join(repo, itemPath))).toBe(false);
		const touched = gitIn(['show', '--name-status', '--format=', 'HEAD'], repo)
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		expect(touched).toEqual([`D\t${itemPath}`]);
		// The mapped-onto identity + reason ride the commit MESSAGE (git history is
		// the archive).
		const commitMessage = gitIn(['log', '-1', '--format=%B', 'HEAD'], repo);
		expect(commitMessage).toContain('task:home');
		expect(commitMessage).toContain('already covered there');
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
		// FENCE SPACING (byte-for-byte): exactly ONE blank line separates the closing
		// frontmatter fence from the first body heading (`---\n\n## What to build`).
		// The renderer rewire once collapsed this to a single newline; assert it here
		// (the shared renderer starts at its heading with no leading blank, so the
		// separator is owned by the frontmatter writer).
		expect(taskBody).toContain('---\n\n## What to build');
		expect(taskBody).not.toMatch(/---\n## What to build/);
		// The observation's open questions are transcribed + needsAnswers reflects them.
		expect(taskBody).toContain('## Open questions');
		expect(taskBody).toContain(OPEN_QUESTION_SIGNAL);
		expect(parseFrontmatter(taskBody).needsAnswers).toBe(true);

		// DISPATCHABILITY (US #1 residual): the spawned task carries a real
		// `## Prompt` section the dispatch validator (`extractPromptSection`,
		// reused by `resolveTask`/the prompt assembly) accepts WITHOUT throwing
		// "has no '## Prompt' section". The prompt is SEEDED from the observation's
		// mechanism prose (the real signal), not an empty/placeholder-only prompt.
		expect(taskBody).toContain('## Prompt');
		const prompt = extractPromptSection(taskBody);
		expect(prompt).toBeDefined();
		expect(prompt).toContain(MECHANISM_SIGNAL);

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

	it('the spawned task is DISPATCHABLE: resolveTask accepts it without the missing-`## Prompt` throw', async () => {
		// End-to-end check that promotion produces a body the build path's validator
		// (`resolveTask` → `extractPromptSection`) accepts: a promptless promoted body
		// is exactly the bug this task removes, so resolving the promoted task on its
		// own checkout must NOT throw.
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = seedAnsweredPromote(seeded.repo, 'dispatchable');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:dispatchable',
			itemPath,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('promoted');

		// Bring the freshly-created task body into the working tree (it was written
		// straight onto arbiter/main via the CAS) so `resolveTask` can read it from
		// `work/tasks/ready/`, the pool it resolves.
		gitIn(['fetch', '-q', 'arbiter'], seeded.repo);
		gitIn(['checkout', '-q', '-B', 'main', 'arbiter/main'], seeded.repo);
		expect(() => resolveTask(seeded.repo, 'dispatchable')).not.toThrow();
		const resolved = resolveTask(seeded.repo, 'dispatchable');
		expect(resolved.taskPrompt).toContain(MECHANISM_SIGNAL);
	});

	it('an AGENT-DRAFTED body (stubContent) with NO `## Prompt` is made dispatchable (a `## Prompt` is appended)', async () => {
		// Regression: the agentic apply path passes the agent's drafted `taskBody` as
		// `stubContent`, which is written AS-IS (bypassing `buildPromotedBody`'s
		// renderer). Agents routinely omit `## Prompt` (drafting `## Context` /
		// `## Definition of done` instead), so the minted task landed non-dispatchable
		// and its `advance --propose` build leg failed with `has no '## Prompt'
		// section`. The promote writer must backstop this: append a seeded `## Prompt`.
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = seedAnsweredPromote(seeded.repo, 'agent-drafted');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const promptlessBody = [
			'## Context',
			'',
			MECHANISM_SIGNAL,
			'',
			'## Definition of done',
			'',
			'- [ ] it works',
			'',
		].join('\n');
		expect(promptlessBody).not.toContain('## Prompt');

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:agent-drafted',
			itemPath,
			artifact: 'task',
			stubContent: promptlessBody,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('promoted');

		gitIn(['fetch', '-q', 'arbiter'], seeded.repo);
		gitIn(['checkout', '-q', '-B', 'main', 'arbiter/main'], seeded.repo);
		// The backstop appended a `## Prompt`, so the build validator accepts it, and
		// the agent's own drafted content (Context/DoD) is preserved.
		expect(() => resolveTask(seeded.repo, 'agent-drafted')).not.toThrow();
		const body = readFileSync(
			join(seeded.repo, 'work', 'tasks', 'ready', 'agent-drafted.md'),
			'utf8',
		);
		expect(body).toContain('## Prompt');
		expect(body).toContain('## Context');
		expect(body).toContain('## Definition of done');
	});

	it('an agent-drafted body that ALREADY has a `## Prompt` is left byte-for-byte (no double prompt)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = seedAnsweredPromote(seeded.repo, 'already-prompt');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const withPrompt = [
			'## What to build',
			'',
			MECHANISM_SIGNAL,
			'',
			'## Prompt',
			'',
			'> Do the thing described above.',
			'',
		].join('\n');

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:already-prompt',
			itemPath,
			artifact: 'task',
			stubContent: withPrompt,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('promoted');

		gitIn(['fetch', '-q', 'arbiter'], seeded.repo);
		gitIn(['checkout', '-q', '-B', 'main', 'arbiter/main'], seeded.repo);
		const body = readFileSync(
			join(seeded.repo, 'work', 'tasks', 'ready', 'already-prompt.md'),
			'utf8',
		);
		// Exactly one `## Prompt` (the backstop did not add a second).
		expect(body.match(/^##\s+Prompt\b/gim)?.length).toBe(1);
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
		// Still dispatchable even with no open-questions block: the `## Prompt` is
		// seeded from the mechanism prose, so the validator accepts it.
		expect(extractPromptSection(taskBody)).toContain(MECHANISM_SIGNAL);
	});

	it('the EMPTY-MECHANISM case keeps the slug-bearing `## Prompt` seed byte-for-byte (not the shared renderer default)', async () => {
		// The shared `renderTaskBody` default empty-prompt seed is `Build the task
		// described above.`, but promotion has always seeded the empty-mechanism case
		// with the SLUG (`Build the task '<slug>', described above.`). The rewire must
		// pass that slug-bearing seed in EXPLICITLY so promotion's output is
		// unchanged (keystone Gate-2 forward-note, PR #247). Seed an observation whose
		// body carries ONLY a `## Open questions` heading — no mechanism prose before
		// it — so the empty-mechanism branch fires.
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = `work/notes/observations/empty-mech.md`;
		mkdirSync(join(seeded.repo, 'work', 'notes', 'observations'), {
			recursive: true,
		});
		writeFileSync(
			join(seeded.repo, itemPath),
			[
				'---',
				'title: empty-mech',
				'needsAnswers: true',
				'---',
				'',
				'## Open questions',
				'',
				`1. ${OPEN_QUESTION_SIGNAL}`,
				'',
			].join('\n'),
		);
		let model: SidecarModel = newSidecar('observation:empty-mech', [
			{question: 'Promote?', disposition: 'promote-task'},
		]);
		model = {
			...model,
			entries: model.entries.map((e) => ({...e, answer: 'yes'})),
		};
		mkdirSync(join(seeded.repo, 'work', 'questions'), {recursive: true});
		writeFileSync(
			join(seeded.repo, 'work/questions/observation-empty-mech.md'),
			serialiseSidecar(model),
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:empty-mech',
			itemPath,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('promoted');
		const taskBody = gitIn(
			['show', 'arbiter/main:work/tasks/ready/empty-mech.md'],
			seeded.repo,
		);
		// The slug-bearing seed survives byte-for-byte — NOT the renderer's generic
		// `Build the task described above.` default.
		expect(extractPromptSection(taskBody)).toBe(
			"Build the task 'empty-mech', described above.",
		);
		expect(taskBody).not.toContain('Build the task described above.');
		// Still dispatchable: the body carries a non-empty `## Prompt` the validator
		// accepts (no missing-`## Prompt` throw).
		expect(extractPromptSection(taskBody)).toBeDefined();
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

/**
 * Seed an answered-`promote-prd` observation + sidecar (working tree). The TWIN of
 * {@link seedAnsweredPromote}, only the sidecar disposition differs (`promote-prd`
 * not `promote-task`) — so the PRD-route tests below assert the SAME body/delete
 * shape against a `prds/proposed/` target instead of a `tasks/ready/` one.
 */
function seedAnsweredPromotePrd(repo: string, slug: string): string {
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
			`A PRD-sized signal awaiting triage. ${MECHANISM_SIGNAL}`,
			'',
			'## Open questions',
			'',
			`1. ${OPEN_QUESTION_SIGNAL}`,
			'',
		].join('\n'),
	);
	let model: SidecarModel = newSidecar(`observation:${slug}`, [
		{question: 'Promote?', disposition: 'promote-prd'},
	]);
	model = {
		...model,
		entries: model.entries.map((e) => ({
			...e,
			answer: 'yes, promote as a PRD',
		})),
	};
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(
		join(repo, `work/questions/observation-${slug}.md`),
		serialiseSidecar(model),
	);
	return itemPath;
}

describe('promoteObservation — the PRD route (artifact: prd → prds/proposed)', () => {
	it('a promote-prd mints prds/proposed/<slug>.md via the SAME CAS writer + DELETES the observation + sidecar in the SAME commit', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = seedAnsweredPromotePrd(seeded.repo, 'prdprom');
		const sidecarPath = 'work/questions/observation-prdprom.md';
		const prdPath = 'work/prds/proposed/prdprom.md';
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:prdprom',
			itemPath,
			artifact: 'prd',
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('promoted');
		expect(result.exitCode).toBe(0);
		// The PRD lands in `proposed/` (staging) — NOT `tasks/ready/`.
		expect(result.newItemPath).toBe(prdPath);
		expect(pathOnArbiterMain(seeded.repo, prdPath)).toBe(true);
		expect(pathOnArbiterMain(seeded.repo, 'work/tasks/ready/prdprom.md')).toBe(
			false,
		);

		// The minted PRD body is self-contained: it carries the observation's REAL
		// mechanism/fix signal (not a back-pointer) under the PRD lead heading.
		const prdBody = gitIn(['show', `arbiter/main:${prdPath}`], seeded.repo);
		expect(prdBody).toContain(MECHANISM_SIGNAL);
		expect(prdBody).toContain('## Problem Statement');
		expect(prdBody).not.toMatch(/Promoted from observation/i);
		// FENCE SPACING (byte-for-byte): one blank line between the frontmatter fence
		// and the PRD lead heading (`---\n\n## Problem Statement`), same as the task path.
		expect(prdBody).toContain('---\n\n## Problem Statement');
		expect(prdBody).not.toMatch(/---\n## Problem Statement/);
		// Open questions transcribed + needsAnswers reflects them.
		expect(prdBody).toContain('## Open questions');
		expect(prdBody).toContain(OPEN_QUESTION_SIGNAL);
		expect(parseFrontmatter(prdBody).needsAnswers).toBe(true);
		// A PRD is NOT dispatched by `do`/`run`, so it carries NO `## Prompt` (that
		// section is the task-only dispatchability schema).
		expect(prdBody).not.toContain('## Prompt');

		// The observation + its sidecar are DELETED on the arbiter (discharge by
		// deletion), riding the SAME atomic commit as the PRD create.
		expect(pathOnArbiterMain(seeded.repo, itemPath)).toBe(false);
		expect(pathOnArbiterMain(seeded.repo, sidecarPath)).toBe(false);
		const touched = gitIn(
			['show', '--name-status', '--no-renames', '--format=', 'arbiter/main'],
			seeded.repo,
		)
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		expect(touched).toContain(`A\t${prdPath}`);
		expect(touched).toContain(`D\t${itemPath}`);
		expect(touched).toContain(`D\t${sidecarPath}`);
	});

	it('a same-slug CAS race on the PRD target leaves the observation INTACT for a retry (the loser backs off)', async () => {
		// Pre-create the PRD target on the arbiter so the promote always loses the CAS.
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const dest = join(seeded.repo, 'work', 'prds', 'proposed');
		mkdirSync(dest, {recursive: true});
		writeFileSync(join(dest, 'taken.md'), '---\ntitle: taken\n---\n\ntaken.\n');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'pre-occupy prd target'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const itemPath = seedAnsweredPromotePrd(seeded.repo, 'taken');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:taken',
			itemPath,
			artifact: 'prd',
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('lost');
		expect(result.exitCode).toBe(2);
		// The loser DELETES nothing: observation + sidecar STILL present for a retry.
		expect(existsSync(join(seeded.repo, itemPath))).toBe(true);
		expect(
			existsSync(join(seeded.repo, 'work/questions/observation-taken.md')),
		).toBe(true);
	});

	it('a promote-prd with NO open questions clears needsAnswers on the minted PRD', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = `work/notes/observations/prdnoq.md`;
		mkdirSync(join(seeded.repo, 'work', 'notes', 'observations'), {
			recursive: true,
		});
		writeFileSync(
			join(seeded.repo, itemPath),
			[
				'---',
				'title: prdnoq',
				'needsAnswers: true',
				'---',
				'',
				`Fully-scoped PRD-sized signal: ${MECHANISM_SIGNAL}`,
				'',
			].join('\n'),
		);
		let model: SidecarModel = newSidecar('observation:prdnoq', [
			{question: 'Promote?', disposition: 'promote-prd'},
		]);
		model = {
			...model,
			entries: model.entries.map((e) => ({...e, answer: 'yes'})),
		};
		mkdirSync(join(seeded.repo, 'work', 'questions'), {recursive: true});
		writeFileSync(
			join(seeded.repo, 'work/questions/observation-prdnoq.md'),
			serialiseSidecar(model),
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await promoteObservation({
			cwd: seeded.repo,
			item: 'observation:prdnoq',
			itemPath,
			artifact: 'prd',
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('promoted');
		const prdBody = gitIn(
			['show', 'arbiter/main:work/prds/proposed/prdnoq.md'],
			seeded.repo,
		);
		expect(prdBody).toContain(MECHANISM_SIGNAL);
		expect(prdBody).not.toContain('## Open questions');
		expect(parseFrontmatter(prdBody).needsAnswers).toBe(false);
	});
});
