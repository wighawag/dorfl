import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {performTask, type TaskAgentRunner} from '../src/tasking.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * `runner-scoops-captured-notes` task (advance-loop's reporting-channel fold-in
 * "EXTEND this channel to agent-authored CAPTURED NOTES"). The RUNNER must SCOOP +
 * REPORT agent-authored capture-bucket files (`work/notes/observations/*`,
 * `work/notes/findings/*`) a rung's agent writes during its run, on BOTH the build path
 * (`do <task>`/`run`/`complete`) and the task path (`do prd:`).
 *
 * Rule A is preserved (the agent does NO git \u2014 the stubbed agents below only WRITE
 * the note files); Rule B is extended (the runner scoops + reports). The fix lives
 * in the ONE shared place (`performIntegration`'s atomic commit), so neither path
 * forks the channel: this suite drives the SHARED core directly AND through the
 * `do prd:` tasking path, asserting BOTH the persistence (committed, not dropped)
 * and the reporting (the runner announces exactly which note files landed).
 *
 * House style (mirrors `integration-core.test.ts` / `tasking-integration.test.ts`):
 * a throwaway checkout + a local `--bare` arbiter + STUBBED agents (write files
 * directly, no model, no git). No shared/global location is touched.
 */

const ARBITER = 'arbiter';
const PASS = 'exit 0';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-scoop-notes-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/** Capture every `note(...)` line a run emits, for the reporting assertions. */
function noteSink(): {note: (m: string) => void; lines: string[]} {
	const lines: string[] = [];
	return {note: (m: string) => lines.push(m), lines};
}

/** Write one capture-bucket note FILE (the agent's `capture-signal` reflex; no git). */
function writeNote(
	cwd: string,
	relPath: string,
	body = 'spotted something',
): void {
	const abs = join(cwd, relPath);
	mkdirSync(join(abs, '..'), {recursive: true});
	writeFileSync(
		abs,
		[
			'---',
			'title: a captured signal',
			'status: spotted',
			'---',
			'',
			body,
			'',
		].join('\n'),
	);
}

/** True iff `<arbiter>/<branch>` tracks `path` (after a fetch). */
function onArbiterBranch(repo: string, branch: string, path: string): boolean {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/${branch}:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
}

/** True iff `<arbiter>/main` tracks `path` (after a fetch). */
function onArbiterMainPath(repo: string, path: string): boolean {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
}

/**
 * Stand a repo up as the build caller's HEAD leaves it just before the shared
 * core: a task claimed (lock held; body rests in backlog/ on the arbiter) + onboarded onto its work
 * branch off fresh main, with UNCOMMITTED agent work in the tree.
 */
async function claimAndBranch(slug: string): Promise<string> {
	const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	// The build agent: leave UNCOMMITTED source work (it does no git).
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	return repo;
}

describe('the BUILD path (shared core) scoops + reports agent-authored captured notes', () => {
	it('a note the agent wrote during the build is COMMITTED (not dropped) and REPORTED', async () => {
		const repo = await claimAndBranch('alpha');
		// Rule A: the build agent WROTE the note files (no git). Simulate that here.
		writeNote(repo, 'work/notes/observations/spotted-during-build.md');
		writeNote(repo, 'work/notes/findings/external-quirk.md');

		const sink = noteSink();
		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'alpha',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			note: sink.note,
		});

		expect(core.outcome).toBe('completed');
		// PERSISTENCE: both notes landed in the runner-owned commit on the arbiter
		// main (the merge mode lands the done-commit), not left untracked.
		expect(
			onArbiterMainPath(
				repo,
				'work/notes/observations/spotted-during-build.md',
			),
		).toBe(true);
		expect(
			onArbiterMainPath(repo, 'work/notes/findings/external-quirk.md'),
		).toBe(true);
		// REPORTING: the runner announced exactly which note files it scooped.
		const report = sink.lines.find((l) => l.includes('Scooped'));
		expect(report).toBeDefined();
		expect(report).toContain('work/notes/observations/spotted-during-build.md');
		expect(report).toContain('work/notes/findings/external-quirk.md');
		expect(report).toMatch(/Scooped 2 agent-authored captured notes/);
	});

	it('a build that writes NO captured note ⇒ no scoop report (no change)', async () => {
		const repo = await claimAndBranch('beta');

		const sink = noteSink();
		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			note: sink.note,
		});

		expect(core.outcome).toBe('completed');
		// No capture-bucket file was written ⇒ the runner reports nothing about notes.
		expect(sink.lines.some((l) => l.includes('Scooped'))).toBe(false);
	});

	it('scratch files OUTSIDE the capture buckets are NOT announced as captured notes', async () => {
		const repo = await claimAndBranch('gamma');
		// A stray file the agent left elsewhere: it still rides `git add -A`, but it is
		// NOT a captured signal, so the scoop report must NOT name it.
		writeFileSync(join(repo, 'scratch.tmp'), 'debug\n');
		writeNote(repo, 'work/notes/observations/real-signal.md');

		const sink = noteSink();
		await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'gamma',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			note: sink.note,
		});

		const report = sink.lines.find((l) => l.includes('Scooped'));
		expect(report).toBeDefined();
		expect(report).toContain('work/notes/observations/real-signal.md');
		expect(report).not.toContain('scratch.tmp');
		expect(report).toMatch(
			/Scooped 1 agent-authored captured note into this commit/,
		);
	});
});

/** Seed a `work/prds/ready/<slug>.md` (committed onto the arbiter) for the tasking path. */
function seedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'prds', 'ready');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug} — task me`,
			`slug: ${slug}`,
			'---',
			'',
			'## Problem',
			'',
			'body',
			'',
		].join('\n'),
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `prd: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/** A tasking agent that writes one STAGED task AND a captured note (no git). */
function taskingAgentWithNote(note: string | undefined): TaskAgentRunner {
	return ({cwd}) => {
		const dir = join(cwd, 'work', 'tasks', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, 'child.md'),
			[
				'---',
				'title: child',
				'slug: child',
				'prd: it',
				'---',
				'',
				'## Prompt',
				'',
				'> build it',
				'',
			].join('\n'),
		);
		if (note) {
			writeNote(cwd, note, 'a PRD premise drifted');
		}
		return {ok: true};
	};
}

describe('the TASK path (do prd:) scoops + reports agent-authored captured notes', () => {
	it('a note the tasker wrote during tasking lands in the task commit and is REPORTED (--merge)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');

		const sink = noteSink();
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: taskingAgentWithNote(
				'work/notes/observations/tasker-spotted-drift.md',
			),
			env: gitEnv(),
			note: sink.note,
		});

		expect(result.outcome).toBe('tasked');
		// PERSISTENCE: the produced task AND the captured note both landed on main
		// through the shared core (alongside the PRD lifecycle move) \u2014 not dropped.
		expect(onArbiterMainPath(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(
			onArbiterMainPath(
				repo,
				'work/notes/observations/tasker-spotted-drift.md',
			),
		).toBe(true);
		// REPORTING: the runner announced the scooped note.
		const report = sink.lines.find((l) => l.includes('Scooped'));
		expect(report).toBeDefined();
		expect(report).toContain('work/notes/observations/tasker-spotted-drift.md');
	});

	it('a note the tasker wrote rides the PROPOSE work branch and is REPORTED (--propose)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');

		const sink = noteSink();
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'propose',
			agentRunner: taskingAgentWithNote(
				'work/notes/findings/tasker-external-fact.md',
			),
			env: gitEnv(),
			note: sink.note,
		});

		expect(result.outcome).toBe('tasked');
		// PERSISTENCE: propose does not touch main; the note rides the pushed work
		// branch carrying the tasks (the same branch the build path integrates).
		expect(
			onArbiterMainPath(repo, 'work/notes/findings/tasker-external-fact.md'),
		).toBe(false);
		expect(
			onArbiterBranch(
				repo,
				'work/prd-it',
				'work/notes/findings/tasker-external-fact.md',
			),
		).toBe(true);
		// REPORTING.
		const report = sink.lines.find((l) => l.includes('Scooped'));
		expect(report).toBeDefined();
		expect(report).toContain('work/notes/findings/tasker-external-fact.md');
	});

	it('a tasking run that writes NO captured note ⇒ no scoop report', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');

		const sink = noteSink();
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: taskingAgentWithNote(undefined),
			env: gitEnv(),
			note: sink.note,
		});

		expect(result.outcome).toBe('tasked');
		expect(onArbiterMainPath(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(sink.lines.some((l) => l.includes('Scooped'))).toBe(false);
	});
});
