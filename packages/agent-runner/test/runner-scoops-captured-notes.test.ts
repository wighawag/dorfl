import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {performSlice, type SliceAgentRunner} from '../src/slicing.js';
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
 * `runner-scoops-captured-notes` slice (advance-loop's reporting-channel fold-in
 * "EXTEND this channel to agent-authored CAPTURED NOTES"). The RUNNER must SCOOP +
 * REPORT agent-authored capture-bucket files (`work/notes/observations/*`,
 * `work/notes/findings/*`) a rung's agent writes during its run, on BOTH the build path
 * (`do <slice>`/`run`/`complete`) and the slice path (`do prd:`).
 *
 * Rule A is preserved (the agent does NO git \u2014 the stubbed agents below only WRITE
 * the note files); Rule B is extended (the runner scoops + reports). The fix lives
 * in the ONE shared place (`performIntegration`'s atomic commit), so neither path
 * forks the channel: this suite drives the SHARED core directly AND through the
 * `do prd:` slicing path, asserting BOTH the persistence (committed, not dropped)
 * and the reporting (the runner announces exactly which note files landed).
 *
 * House style (mirrors `integration-core.test.ts` / `slicing-integration.test.ts`):
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
 * core: a slice claimed (lock held; body rests in backlog/ on the arbiter) + onboarded onto its work
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
			source: 'backlog',
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
			source: 'backlog',
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
			source: 'backlog',
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

/** Seed a `work/briefs/ready/<slug>.md` (committed onto the arbiter) for the slicing path. */
function seedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'briefs', 'ready');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug} — slice me`,
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
	run('git', ['commit', '-q', '-m', `brief: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/** A slicing agent that writes one STAGED slice AND a captured note (no git). */
function slicingAgentWithNote(note: string | undefined): SliceAgentRunner {
	return ({cwd}) => {
		const dir = join(cwd, 'work', 'tasks', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, 'child.md'),
			[
				'---',
				'title: child',
				'slug: child',
				'brief: it',
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

describe('the SLICE path (do prd:) scoops + reports agent-authored captured notes', () => {
	it('a note the slicer wrote during slicing lands in the slice commit and is REPORTED (--merge)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');

		const sink = noteSink();
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: slicingAgentWithNote(
				'work/notes/observations/slicer-spotted-drift.md',
			),
			env: gitEnv(),
			note: sink.note,
		});

		expect(result.outcome).toBe('sliced');
		// PERSISTENCE: the produced slice AND the captured note both landed on main
		// through the shared core (alongside the PRD lifecycle move) \u2014 not dropped.
		expect(onArbiterMainPath(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(
			onArbiterMainPath(
				repo,
				'work/notes/observations/slicer-spotted-drift.md',
			),
		).toBe(true);
		// REPORTING: the runner announced the scooped note.
		const report = sink.lines.find((l) => l.includes('Scooped'));
		expect(report).toBeDefined();
		expect(report).toContain('work/notes/observations/slicer-spotted-drift.md');
	});

	it('a note the slicer wrote rides the PROPOSE work branch and is REPORTED (--propose)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');

		const sink = noteSink();
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'propose',
			agentRunner: slicingAgentWithNote(
				'work/notes/findings/slicer-external-fact.md',
			),
			env: gitEnv(),
			note: sink.note,
		});

		expect(result.outcome).toBe('sliced');
		// PERSISTENCE: propose does not touch main; the note rides the pushed work
		// branch carrying the slices (the same branch the build path integrates).
		expect(
			onArbiterMainPath(repo, 'work/notes/findings/slicer-external-fact.md'),
		).toBe(false);
		expect(
			onArbiterBranch(
				repo,
				'work/brief-it',
				'work/notes/findings/slicer-external-fact.md',
			),
		).toBe(true);
		// REPORTING.
		const report = sink.lines.find((l) => l.includes('Scooped'));
		expect(report).toBeDefined();
		expect(report).toContain('work/notes/findings/slicer-external-fact.md');
	});

	it('a slicing run that writes NO captured note ⇒ no scoop report', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');

		const sink = noteSink();
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: slicingAgentWithNote(undefined),
			env: gitEnv(),
			note: sink.note,
		});

		expect(result.outcome).toBe('sliced');
		expect(onArbiterMainPath(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(sink.lines.some((l) => l.includes('Scooped'))).toBe(false);
	});
});
