import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
import {applyAnsweredQuestions} from '../src/apply-persist.js';
import {
	parseSidecar,
	serialiseSidecar,
	sidecarPathFor,
} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	isolatePiAgentDir,
	sidecarSurfacedOnArbiterMain,
	pathOnArbiterMain,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Bug (dorfl 0.16.0, rocketh-playground): a kept branch could never be
 * continued once its question was answered.
 *
 *   1. The gate fails on the rebased tip. The kept branch already holds the
 *      completion commit that moves `ready/<slug>.md` to `done/<slug>.md`.
 *   2. The surface edits `ready/<slug>.md` on `main` (`needsAnswers: true`).
 *   3. The answer is applied on `main`: the same file again
 *      (`needsAnswers: false` + `## Applied answers`).
 *   4. The next continue rebase replays the branch's done-move onto that main
 *      and conflicts on `done/<slug>.md` ("aborted, never auto-resolved").
 *
 * Both sides of that conflict are dorfl's own writes to the item's lifecycle
 * file, so the continue rebase resolves it: main's body (the answer record)
 * plus the branch's `## Decisions` block, at the branch's done path.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-applied-answer-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

async function completeWith(
	repo: string,
	slug: string,
	verify: string,
	decision?: string,
) {
	return performComplete({
		cwd: repo,
		slug,
		arbiter: ARBITER,
		integration: 'merge',
		verify,
		// The builder's final report: the runner transcribes its Decisions block
		// into the done record on the branch.
		body: decision ? `Built it.\n\n## Decisions\n\n- ${decision}\n` : undefined,
		freshWorktreeGate: true,
		surfaceArbiter: ARBITER,
		env: gitEnv(),
	});
}

/** Answer the surfaced question on main and apply it (what `advance` does). */
async function answerAndApplyOnMain(
	clone: string,
	slug: string,
	answer: string,
) {
	const item = `task:${slug}`;
	const abs = join(clone, sidecarPathFor(item));
	const model = parseSidecar(readFileSync(abs, 'utf8'));
	writeFileSync(
		abs,
		serialiseSidecar({
			...model,
			entries: model.entries.map((e) => ({...e, answer})),
		}),
	);
	gitIn(['add', '-A'], clone);
	gitIn(['commit', '-q', '-m', `answer ${item}`], clone);
	const applied = await applyAnsweredQuestions({
		cwd: clone,
		item,
		itemPath: `work/tasks/ready/${slug}.md`,
		env: gitEnv(),
	});
	expect(applied.outcome).toBe('resolved');
	gitIn(['push', '-q', ARBITER, 'HEAD:main'], clone);
}

describe('continue a kept branch after its answer was applied on main', () => {
	it('the continue rebase resolves the lifecycle-file conflict and the task lands', async () => {
		const slug = 'alpha';
		const seeded = seedRepoWithArbiter(scratch.root, [slug]);
		const repo = seeded.repo;

		expect(
			(await performClaim({slug, cwd: repo, arbiter: ARBITER, env: gitEnv()}))
				.exitCode,
		).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'first.txt'), 'first attempt\n');
		expect(
			(await completeWith(repo, slug, 'exit 1', 'chose the simple approach'))
				.outcome,
		).toBe('gate-failed');
		expect(sidecarSurfacedOnArbiterMain(repo, slug)).toBe(true);

		// A human answers; advance applies it on main.
		const answering = seeded.clone('answer');
		await answerAndApplyOnMain(answering, slug, 'ports were busy, retry');
		expect(sidecarSurfacedOnArbiterMain(answering, slug)).toBe(false);

		// Continue from the kept branch: 0.16.0 aborted on done/<slug>.md here.
		const clone = seeded.clone('continue');
		const notes: string[] = [];
		const started = await performStart({
			slug,
			cwd: clone,
			arbiter: ARBITER,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(started.reason).toBeUndefined();
		expect(started.outcome).toBe('started');
		expect(notes.join('\n')).toMatch(/lifecycle/i);

		// The continued branch carries ONE copy of the task, at its done path,
		// with main's answer record AND the branch's Decisions.
		expect(
			run(
				'git',
				['cat-file', '-e', `HEAD:work/tasks/ready/${slug}.md`],
				clone,
				{
					env: gitEnv(),
				},
			).status,
		).not.toBe(0);
		const done = readFileSync(
			join(clone, 'work', 'tasks', 'done', `${slug}.md`),
			'utf8',
		);
		expect(done).toContain('## Applied answers');
		expect(done).toContain('ports were busy, retry');
		expect(done).toContain('## Decisions');
		expect(done).toContain('chose the simple approach');
		expect(done).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
		expect(parseFrontmatter(done).needsAnswers).not.toBe(true);

		// A second bounce on the continued branch, answered again: the third
		// continue replays two commits that touch the done record.
		writeFileSync(join(clone, 'second.txt'), 'second attempt\n');
		expect(
			(await completeWith(clone, slug, 'exit 1', 'kept the retry small'))
				.outcome,
		).toBe('gate-failed');
		expect(sidecarSurfacedOnArbiterMain(clone, slug)).toBe(true);
		await answerAndApplyOnMain(seeded.clone('answer2'), slug, 'try once more');

		const third = seeded.clone('third');
		const restarted = await performStart({
			slug,
			cwd: third,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(restarted.message).toMatch(/continued/);
		expect(restarted.outcome).toBe('started');
		writeFileSync(join(third, 'third.txt'), 'third attempt\n');
		expect((await completeWith(third, slug, 'exit 0')).outcome).toBe(
			'completed',
		);
		for (const f of ['first.txt', 'second.txt', 'third.txt']) {
			expect(pathOnArbiterMain(third, f)).toBe(true);
		}
		expect(pathOnArbiterMain(third, `work/tasks/ready/${slug}.md`)).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(third, slug)).toBe(false);
		const record = run(
			'git',
			['show', `${ARBITER}/main:work/tasks/done/${slug}.md`],
			third,
			{env: gitEnv()},
		).stdout;
		expect(record).toContain('try once more');
		expect(record).toContain('chose the simple approach');
		expect(record).toContain('kept the retry small');
		expect(record).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
		expect(record.match(/^- chose the simple approach$/gm)).toHaveLength(1);
		expect(parseFrontmatter(record).needsAnswers).not.toBe(true);
		// The copied question heading (and everything else dorfl wrote) carries
		// no em dash: some repositories forbid the character.
		expect(record).toMatch(
			/^### q1: 'task:alpha' was bounced\. How should we proceed\?$/m,
		);
		expect(record).not.toContain('\u2014');
		const subjects = gitIn(['log', '--format=%B', `${ARBITER}/main`], third);
		expect(subjects).not.toContain('\u2014');
	}, 60_000);
});
