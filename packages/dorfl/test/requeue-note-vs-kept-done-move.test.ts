import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {
	returnToBacklog,
	insertRequeueNoteText,
} from '../src/needs-attention.js';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
import {markStuckItemLock} from '../src/item-lock.js';
import {
	buildAgentPrompt,
	extractRequeueNotes,
	resolveContinueContext,
	resolveTask,
} from '../src/prompt.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

// Task `requeue-handoff-note-does-not-conflict-with-the-kept-done-move`: a
// `requeue -m` note used to be APPENDED to the END of the body on main, while the
// kept work branch had already done-moved that body (`ready/ → done/`) AND
// appended its `## Decisions` block at the END. The next claim's continue rebase
// then conflicted on the file tail and bounced the item, so the requested fix
// could never be built from the kept branch.

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-requeue-note-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Drive `slug` to a kept work branch whose prior attempt DONE-MOVED the body and
 * APPENDED a `## Decisions` block to it (the runner's completion shape), pushed
 * to a bare arbiter, with the per-item lock stuck (e.g. a Gate-3 block).
 */
async function keptDoneMovedBranch(slug: string): Promise<SeededRepo> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	const readyRel = join('work', 'tasks', 'ready', `${slug}.md`);
	const doneRel = join('work', 'tasks', 'done', `${slug}.md`);
	mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
	gitIn(['mv', readyRel, doneRel], repo);
	const done = readFileSync(join(repo, doneRel), 'utf8');
	writeFileSync(
		join(repo, doneRel),
		`${done}\n## Decisions\n\n- chose the prior approach\n`,
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `feat(${slug}): prior attempt; done`], repo);
	gitIn(['push', '-q', ARBITER, `work/task-${slug}:work/task-${slug}`], repo);
	await markStuckItemLock({
		item: `task:${slug}`,
		reason: 'gate 3 blocked',
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	return seeded;
}

function arbiterReadyBody(seeded: SeededRepo, slug: string, tag: string) {
	const reader = seeded.clone(`read-${tag}`);
	return readFileSync(
		join(reader, 'work', 'tasks', 'ready', `${slug}.md`),
		'utf8',
	);
}

describe('requeue -m on a kept branch that done-moved + appended to the body', () => {
	it('continues and rebases CLEANLY, and the note reaches the continuing prompt', async () => {
		const slug = 'alpha';
		const seeded = await keptDoneMovedBranch(slug);
		const result = await returnToBacklog({
			cwd: seeded.repo,
			slug,
			arbiter: ARBITER,
			message: 'fix the gate-3 finding: rename the helper',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The next claim (a different machine) continues from the kept branch.
		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug,
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.outcome).not.toBe('needs-attention');
		expect(started.exitCode).toBe(0);
		expect(started.branch).toBe(`work/task-${slug}`);
		expect(existsSync(join(fresh, 'prior.txt'))).toBe(true);

		// The rebased done record carries BOTH the requeue note and the Decisions
		// block (no conflict markers).
		const donePath = join(fresh, 'work', 'tasks', 'done', `${slug}.md`);
		const doneBody = readFileSync(donePath, 'utf8');
		expect(doneBody).toMatch(/## Requeue \d{4}-\d{2}-\d{2}/);
		expect(doneBody).toMatch(/fix the gate-3 finding: rename the helper/);
		expect(doneBody).toMatch(/## Decisions\n\n- chose the prior approach/);
		expect(doneBody).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);

		// Through the prompt builder, exactly as the in-place `do` path assembles it.
		const gate = {
			cwd: fresh,
			branchRef: `${ARBITER}/work/task-${slug}`,
			mainRef: `${ARBITER}/main`,
			env: gitEnv(),
		};
		const task = resolveTask(fresh, slug, gate);
		expect(task.folder).toBe('done');
		const continueContext = resolveContinueContext({
			cwd: fresh,
			slug,
			arbiter: ARBITER,
			branchRef: gate.branchRef,
			mainRef: gate.mainRef,
			content: readFileSync(task.path, 'utf8'),
			env: gitEnv(),
		});
		expect(continueContext).toBeDefined();
		const prompt = buildAgentPrompt(task.slug, task.spec, task.taskPrompt, {
			cwd: fresh,
			continueContext,
		});
		expect(prompt).toContain('### Handoff note(s) from the requeue');
		expect(prompt).toContain('fix the gate-3 finding: rename the helper');
	});

	it('requeue WITHOUT -m leaves the body byte-identical (and still continues)', async () => {
		const slug = 'beta';
		const seeded = await keptDoneMovedBranch(slug);
		const before = arbiterReadyBody(seeded, slug, 'before');
		const result = await returnToBacklog({
			cwd: seeded.repo,
			slug,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(arbiterReadyBody(seeded, slug, 'after')).toBe(before);

		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug,
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
	});
});

describe('insertRequeueNoteText — placement away from the done-move tail', () => {
	const BODY = [
		'---',
		'title: x',
		'---',
		'',
		'## What to build',
		'',
		'thing',
		'',
		'## Acceptance criteria',
		'',
		'- [ ] works',
		'',
		'## Prompt',
		'',
		'> do it',
		'',
	].join('\n');

	it('inserts the dated section immediately BEFORE `## Acceptance criteria`', () => {
		const out = insertRequeueNoteText(BODY, 'steer one');
		const note = out.search(/## Requeue \d{4}-\d{2}-\d{2}\n\nsteer one\n\n/);
		expect(note).toBeGreaterThan(out.indexOf('thing'));
		expect(note).toBeLessThan(out.indexOf('## Acceptance criteria'));
		// The tail (where a done-move appends its Decisions block) is untouched.
		expect(out.endsWith('## Prompt\n\n> do it\n')).toBe(true);
		expect(extractRequeueNotes(out)).toEqual(['steer one']);
	});

	it('accumulates repeated notes oldest-first, all before the acceptance criteria', () => {
		const out = insertRequeueNoteText(
			insertRequeueNoteText(BODY, 'first'),
			'second',
		);
		expect(extractRequeueNotes(out)).toEqual(['first', 'second']);
		expect(out.lastIndexOf('## Requeue')).toBeLessThan(
			out.indexOf('## Acceptance criteria'),
		);
	});

	it('falls back to appending at the end when the body has no `## Acceptance criteria`', () => {
		const out = insertRequeueNoteText('## What to build\n\nthing\n', 'steer');
		expect(out).toMatch(
			/^## What to build\n\nthing\n\n## Requeue \d{4}-\d{2}-\d{2}\n\nsteer\n$/,
		);
	});
});
