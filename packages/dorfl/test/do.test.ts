import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	mkdirSync,
	existsSync,
	chmodSync,
	readFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {performDo, type DoDorfl} from '../src/do.js';
import {GitHubProvider} from '../src/github.js';
import {performComplete} from '../src/complete.js';
import {performStart} from '../src/start.js';
import {returnToBacklog} from '../src/needs-attention.js';
import {performClaim} from '../src/claim-cas.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `do <slug>` (in-place form) tests — the per-repo, in-place WORKER (the CI
 * command) that COMPOSES `start` + (autonomous agent run) + `complete`, guarded
 * by a dirty-tree refusal. House style: a throwaway checkout + a local `--bare`
 * arbiter + a STUBBED agent (the injected `dorfl` edits files directly,
 * never a real harness). It drives real git + writes `main` (the autonomous
 * needs-attention surfacing), so it lives in the non-parallel project.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-do-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';
const FAIL = 'exit 1';

function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}

/** A stubbed agent that edits a file (so the commit is non-empty) and succeeds. */
const editingAgent: DoDorfl = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

/** Seed a `work/prds/ready/<slug>.md` in the checkout's working tree (for prd: tests). */
function seedPrd(
	repo: string,
	slug: string,
	fm: {humanOnly?: boolean; needsAnswers?: boolean} = {},
): void {
	const dir = join(repo, 'work', 'prds', 'ready');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `title: ${slug}`, `slug: ${slug}`];
	if (fm.humanOnly) lines.push('humanOnly: true');
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	lines.push('---', '', '# PRD', '');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
	// Commit it so the PRD lives on main (and survives the work-branch cut).
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `prd: ${slug}`], repo);
	gitIn(['push', '-q', ARBITER, 'main'], repo);
}

describe('do <slug> — in-place happy path → exit', () => {
	it('refuses-on-dirty? no; claims + onboards + runs agent + gates + integrates in-place + exits', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('alpha');

		// merge mode → the work landed on the arbiter's main, in done/.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(false);

		// The agent's edit landed (the runner committed it with the done-move).
		expect(
			gitIn(['cat-file', '-e', 'arbiter/main:agent-output.txt'], repo),
		).toBe('');

		// Like `complete`: switched back to main, branch tidied (provably on arbiter).
		expect(currentBranch(repo)).toBe('main');
		expect(gitIn(['branch', '--list', 'work/task-alpha'], repo).trim()).toBe(
			'',
		);
	});

	it('the AGENT does no git — the runner owns claim + done-move + commit', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// An agent that ASSERTS the tree is already on the work branch + claimed
		// (the runner onboarded) and only edits code.
		const assertingAgent: DoDorfl = ({cwd, slug}) => {
			expect(currentBranch(cwd)).toBe(`work/task-${slug}`);
			// The body RESTS in backlog/ in the tree (claim acquired the lock but
			// never moved the body); the agent never did any git.
			expect(
				existsSync(join(cwd, 'work', 'tasks', 'ready', `${slug}.md`)),
			).toBe(true);
			expect(existsSync(join(cwd, 'work', 'in-progress', `${slug}.md`))).toBe(
				false,
			);
			writeFileSync(join(cwd, 'agent-output.txt'), 'work\n');
			return {ok: true};
		};
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: assertingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
	});
});

describe('do task:<slug> --allow-backlog — drive a STAGED task in place (backlog→done)', () => {
	// prd `do-allow-backlog-drive-staged-tasks-without-promotion` (the keystone):
	// a human drives a task that lives ONLY in tasks/backlog/ WITHOUT promoting it
	// to the pool; the done-move goes tasks/backlog/ → tasks/done/ directly.
	it('WITH the flag: resolves + claims + builds a staged task; it lands in tasks/done/', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {staged: ['staged']});
		const result = await performDo({
			arg: 'task:staged',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			allowBacklog: true,
			dorfl: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('staged');

		// The completed task landed in tasks/done/ — the full backlog→done path.
		expect(existsOnArbiterMain(repo, 'done', 'staged')).toBe(true);
		// It NEVER bounced through the pool (tasks/ready/), and left staging.
		expect(existsOnArbiterMain(repo, 'backlog', 'staged')).toBe(false);
		expect(existsOnArbiterMain(repo, 'pre-backlog', 'staged')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'staged')).toBe(false);

		// The agent's edit landed (the runner committed it with the done-move).
		expect(
			gitIn(['cat-file', '-e', 'arbiter/main:agent-output.txt'], repo),
		).toBe('');
	});

	it('the claim of a staged task wrote nothing to main and moved no body before the done-move', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {staged: ['staged']});
		// An agent that ASSERTS the body still RESTS in tasks/backlog/ at build time
		// (claim acquired the lock but never moved the staged body).
		const assertingAgent: DoDorfl = ({cwd, slug}) => {
			expect(currentBranch(cwd)).toBe(`work/task-${slug}`);
			expect(
				existsSync(join(cwd, 'work', 'tasks', 'backlog', `${slug}.md`)),
			).toBe(true);
			expect(
				existsSync(join(cwd, 'work', 'tasks', 'ready', `${slug}.md`)),
			).toBe(false);
			writeFileSync(join(cwd, 'agent-output.txt'), 'work\n');
			return {ok: true};
		};
		const result = await performDo({
			arg: 'task:staged',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			allowBacklog: true,
			dorfl: assertingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'staged')).toBe(true);
	});

	it('WITHOUT the flag: the same staged task fails to resolve (no silent widening)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {staged: ['staged']});
		const result = await performDo({
			arg: 'task:staged',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			// allowBacklog omitted ⇒ default off.
			dorfl: editingAgent,
			env: gitEnv(),
		});
		// Not claimable from the pool (it is only in staging) ⇒ lost (exit 2), and
		// the staged body is untouched.
		expect(result.exitCode).not.toBe(0);
		expect(result.outcome).not.toBe('completed');
		expect(existsOnArbiterMain(repo, 'pre-backlog', 'staged')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'staged')).toBe(false);
	});

	it('a slug in BOTH tasks/ready/ and tasks/backlog/ resolves to the READY copy', async () => {
		// The malformed-state tie-break (prd decision 5): ready before backlog. Seed
		// the SAME slug in both folders, with distinguishable bodies.
		const {repo} = seedRepoWithArbiter(scratch.root, ['dup'], {
			staged: ['dup'],
		});
		let seenPrompt: string | undefined;
		const capturingAgent: DoDorfl = ({cwd, prompt}) => {
			seenPrompt = prompt;
			writeFileSync(join(cwd, 'agent-output.txt'), 'work\n');
			return {ok: true};
		};
		const result = await performDo({
			arg: 'task:dup',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			allowBacklog: true,
			dorfl: capturingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		// The done-move sourced from tasks/ready/ (the READY copy won): the pool copy
		// is gone, and the staged copy is left behind (untouched by this build).
		expect(existsOnArbiterMain(repo, 'done', 'dup')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'dup')).toBe(false);
		expect(existsOnArbiterMain(repo, 'pre-backlog', 'dup')).toBe(true);
	});
});

describe('do <slug> — promptGuidance.testFirst reaches the AUTONOMOUS worker prompt', () => {
	// REGRESSION (prompt-guidance-testfirst Gate-2 block): the resolved
	// `promptGuidance` MUST reach the prompt the autonomous `do` worker is handed.
	// Before this fix the `do` call site built the prompt WITHOUT promptGuidance,
	// so a per-repo `promptGuidance.testFirst:true` was a silent no-op on the
	// build path (only `dorfl prompt` honoured it). We assert on the
	// strengthened sentence sourced from CLAIM-PROTOCOL.md.
	// Both strings are the EXACT (line-wrapped) markdown from CLAIM-PROTOCOL.md.
	const STRENGTHENED = 'write\nthe failing test BEFORE the production code';
	const SOFT = 'TDD where the task asks for\nit';

	it('ON: the strengthened test-first line is in the prompt; the soft line is gone', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		let seen: string | undefined;
		const capturingAgent: DoDorfl = ({cwd, prompt}) => {
			seen = prompt;
			writeFileSync(join(cwd, 'agent-output.txt'), 'work\n');
			return {ok: true};
		};
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			// The resolved nudge the CLI threads from per-repo config; ON here.
			promptGuidance: {testFirst: true},
			dorfl: capturingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(seen).toBeDefined();
		expect(seen).toContain(STRENGTHENED);
		expect(seen).not.toContain(SOFT);
		// The conditional markers never leak into the worker prompt.
		expect(seen).not.toContain('<!-- if promptGuidance');
	});

	it('OFF (default): the soft line stands; the strengthened line is absent', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		let seen: string | undefined;
		const capturingAgent: DoDorfl = ({cwd, prompt}) => {
			seen = prompt;
			writeFileSync(join(cwd, 'agent-output.txt'), 'work\n');
			return {ok: true};
		};
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			// No promptGuidance ⇒ default (testFirst false) ⇒ byte-identical to today.
			dorfl: capturingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(seen).toBeDefined();
		expect(seen).toContain(SOFT);
		expect(seen).not.toContain(STRENGTHENED);
	});
});

describe('do <slug> — UNTRUSTED-ORIGIN build forces propose (untrusted-origin-forces-build-propose)', () => {
	// Stamp the backlog task as untrusted-origin + push it to main (a task born
	// from an untrusted issue, propagated by the tasker onto the backlog file).
	const stampTaskUntrusted = (repo: string, slug: string): void => {
		const path = join(repo, 'work', 'tasks', 'ready', `${slug}.md`);
		const content = readFileSync(path, 'utf8');
		writeFileSync(
			path,
			content.replace(/^---\n/, '---\norigin: issue\noriginTrust: untrusted\n'),
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', `stamp ${slug} untrusted`], repo);
		gitIn(['push', '-q', ARBITER, 'main'], repo);
	};

	it('the AUTONOMOUS path (integration: merge, NO explicit flag) PROPOSES an untrusted task — never merges to main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['untrusted']);
		stampTaskUntrusted(repo, 'untrusted');

		const result = await performDo({
			arg: 'untrusted',
			cwd: repo,
			arbiter: ARBITER,
			// The build-transition config is `merge`, but the autonomous/CI path passes
			// NO explicit flag ⇒ untrusted-origin forces the BUILD to propose.
			integration: 'merge',
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// PROPOSE: the task did NOT land in done/ on main (a human reviews the PR).
		expect(existsOnArbiterMain(repo, 'done', 'untrusted')).toBe(false);
		// The work branch was pushed (the PR source).
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/task-untrusted'],
				repo,
			).trim(),
		).not.toBe('');
	});

	it('an explicit --merge (explicitMerge: true) OVERRIDES the build-propose rule — the untrusted task LANDS on main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['untrusted']);
		stampTaskUntrusted(repo, 'untrusted');

		const result = await performDo({
			arg: 'untrusted',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			// The operator typed --merge: it wins over the untrusted-origin default.
			explicitMerge: true,
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'untrusted')).toBe(true);
	});
});

describe('do <slug> — dirty-tree refusal (ar-run.sh guard)', () => {
	it('refuses on an unstaged dirty tree, claiming nothing', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		writeFileSync(join(repo, 'README.md'), '# project DIRTY\n');

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/dirty/i);
		// Nothing claimed; still in backlog; still on main.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(currentBranch(repo)).toBe('main');
	});

	it('refuses on a staged-but-uncommitted dirty tree', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		writeFileSync(join(repo, 'staged.txt'), 'staged\n');
		gitIn(['add', 'staged.txt'], repo);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
	});
});

describe('do <slug> — lost claim race is skipped cleanly', () => {
	it('skips an item already claimed by someone else (no work branch, no agent)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		const repo = seeded.repo;
		// Another claimer wins first from a separate clone.
		const other = seeded.clone('other');
		const won = await performClaim({
			slug: 'solo',
			cwd: other,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(won.exitCode).toBe(0);

		let agentRan = false;
		const result = await performDo({
			arg: 'solo',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});

		// start refuses an already-in-progress item (folder-based) → do reports the
		// lost/skip cleanly, runs no agent, creates no work branch.
		expect(result.exitCode).not.toBe(0);
		expect(['lost', 'refused']).toContain(result.outcome);
		expect(agentRan).toBe(false);
		expect(gitIn(['branch', '--list', 'work/task-solo'], repo).trim()).toBe('');
		expect(currentBranch(repo)).toBe('main');
	});

	it('a genuine two-doer race: the loser skips, the winner completes', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['race']);
		// Distinct committer identity per racer so the two claim commits get DISTINCT
		// shas (as two real doers would) and the loser loses through the genuine CAS,
		// not a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		const [ra, rb] = await Promise.all([
			performDo({
				arg: 'race',
				cwd: a,
				arbiter: ARBITER,
				integration: 'merge',
				verify: PASS,
				dorfl: editingAgent,
				env: racerEnv('a'),
			}),
			performDo({
				arg: 'race',
				cwd: b,
				arbiter: ARBITER,
				integration: 'merge',
				verify: PASS,
				dorfl: editingAgent,
				env: racerEnv('b'),
			}),
		]);

		const outcomes = [ra.outcome, rb.outcome].sort();
		// Exactly one completes; the other skips (lost/contended/refused).
		const completedCount = [ra, rb].filter(
			(r) => r.outcome === 'completed',
		).length;
		expect(completedCount).toBe(1);
		expect(outcomes).not.toEqual(['completed', 'completed']);
		// The item is done on the arbiter exactly once.
		expect(existsOnArbiterMain(a, 'done', 'race')).toBe(true);
	});
});

describe('do <slug> — red gate routes to needs-attention via the seam (AUTONOMOUS surfacing)', () => {
	it('a red gate surfaces the stuck item ON THE ARBITER main (not local-only)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: FAIL,
			dorfl: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');

		// CRITICAL — `do` is autonomous: the stuck state is the per-item lock
		// `state: stuck` (task 9b: the lock is the SOLE stuck record), so
		// scan/status/another machine can read it. NO `main` write — the body STAYS
		// in backlog/ (it never moved on claim) and NO needs-attention/ folder is
		// written.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});

	it('CONTRAST: human `complete` (no surfaceArbiter) routes LOCAL-ONLY — main still shows the body in backlog', async () => {
		// This locks the AUTONOMOUS-vs-HUMAN divergence the task flags: `do` passes
		// the arbiter (surfaces on main); the human `complete` does NOT, so a red
		// gate leaves main showing the body still in backlog (a human is right there).
		// If someone made `complete` always surface, this fails.
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/task-beta', `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'agent-output.txt'), 'work\n');

		const result = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			verify: FAIL,
			// NB: NO surfaceArbiter — the human path.
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-failed');
		// HUMAN local-only path (NO surfaceArbiter): there is no arbiter handle, so
		// the lock is NOT marked stuck (a human is right there) and main is untouched
		// — the body stays in backlog/, no needs-attention/ folder, the lock stays
		// active. The autonomous-vs-human divergence rides on whether an arbiter is
		// given to the bounce.
		expect(stuckLockOnArbiter(repo, 'beta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(false);
	});

	it('an agent failure before the gate surfaces agent-failed (item NOT moved to done)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: () => ({ok: false, detail: 'agent exploded'}),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.message).toMatch(/exploded/);
		// Claimed + onboarded, but never integrated → not done on the arbiter.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});
});

describe('do <slug> — autonomous SOURCE-STRAND refusal MAPS to needs-attention (performDo parity with runRemotePipeline)', () => {
	/**
	 * Task `autonomous-integration-refusal-surfaces-not-strands-in-progress`
	 * (PR/Gate-2 follow-up): `complete.ts` now returns `outcome: 'strand-surfaced'`
	 * (the autonomous source-strand / empty-staged refusal surfaced on the arbiter)
	 * and `outcome: 'surface-unmoved'` (the honest cannot-land signal). The in-place
	 * `performDo` dispatch must MAP these to the same caller-visible labels that
	 * `runRemotePipeline` (the `do --remote` tail) uses — `needs-attention` and
	 * `surface-unmoved` respectively — so `advance task:<slug>` (via the default
	 * `doDriver = performDo`) agrees with the remote path on the outcome label.
	 * Without this mapping a strand surface fell through to `usage-error`.
	 */

	/** A stubbed agent that COMMITS a deletion of the task's body (now resting in
	 * `work/tasks/ready/`, since claim no longer moves it) from the work branch — the
	 * source-strand state `complete.ts` refuses with `nothing to complete (already
	 * done, or wrong slug?)`. The arbiter still holds the body in `work/tasks/ready/`,
	 * so `do` should bounce it to needs-attention on the arbiter, not silently
	 * strand it.
	 */
	const stranderAgent: DoDorfl = ({cwd, slug}) => {
		// Touch a file too so the empty-diff backstop (`agent-stopped`) does NOT
		// fire — we WANT the run to reach `performComplete`, where source-resolution
		// refuses with `nothing to complete` (the source-strand class).
		writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
		gitIn(['rm', '-q', `work/tasks/ready/${slug}.md`], cwd);
		gitIn(['add', '-A'], cwd);
		gitIn(['commit', '-q', '-m', 'drop the task (source strand)'], cwd);
		return {ok: true};
	};

	it('an autonomous source-strand bounces to needs-attention on the arbiter — NOT a fall-through usage-error', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: stranderAgent,
			env: gitEnv(),
		});

		// The Gate-2 fix: the new `strand-surfaced` outcome from `performComplete`
		// maps to `needs-attention` here (it previously fell through to
		// `usage-error`, which is what blocked the prior PR). This brings the
		// in-place dispatch to parity with `runRemotePipeline`.
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');

		// The stuck state is the per-item lock `state: stuck` (task 9b); the body
		// STAYS in backlog/ on main (no needs-attention/ folder, no in-progress/), so
		// the next autonomous tick reads the held stuck lock and does NOT re-claim and
		// re-crash forever.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
	});
});

describe('do <slug> — an agent FAILURE SAVES partial work (commit + push + surface)', () => {
	/** A stubbed agent that EDITS a file (partial work) then returns ok:false. */
	const editsThenFails: DoDorfl = ({cwd}) => {
		writeFileSync(join(cwd, 'partial.txt'), 'half-finished work\n');
		return {ok: false, detail: 'agent exploded mid-build'};
	};

	it('saves the agent work + surfaces on the arbiter main + pushes the work branch (NOT a bare drop)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: editsThenFails,
			env: gitEnv(),
		});

		// The exit CONTRACT stays coherent: it is still an agent failure (distinct
		// from a clean success and from a red gate's `needs-attention`), exit 1, with
		// the failure detail in the message.
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.message).toMatch(/exploded mid-build/);
		expect(result.routedToNeedsAttention).toBe(true);

		// The work-preserving side-effect now MATCHES the gate-failure path:
		// (a) the stuck state is the per-item lock `state: stuck` (cross-machine
		//     visible via the lock ref); the body STAYS in backlog/ on main.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);

		// (c) the work/<slug> branch is PUSHED to the arbiter, carrying the agent's
		// partial work (a wip commit) — the durable artifact a requeue continues from.
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/task-alpha'],
				repo,
			).trim(),
		).not.toBe('');
		// The agent's partial edit is on that pushed branch (not dropped).
		expect(
			gitIn(['cat-file', '-e', 'arbiter/work/task-alpha:partial.txt'], repo),
		).toBe('');
		// But it never reached main (no auto-merge of a failed build).
		expect(gitIn(['ls-tree', 'arbiter/main', 'partial.txt'], repo).trim()).toBe(
			'',
		);
	});

	it('the SAVED work is recoverable: requeue (continue) lands a re-claim on the branch WITH the partial commits', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const repo = seeded.repo;

		// The agent fails after editing; `do` saves + surfaces + pushes the branch.
		const failed = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: editsThenFails,
			env: gitEnv(),
		});
		expect(failed.outcome).toBe('agent-failed');
		expect(failed.routedToNeedsAttention).toBe(true);

		// A human resolves the cause and requeues (default = keep + continue): the
		// ledger file moves needs-attention → backlog; the pushed work branch stays.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		const requeued = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(requeued.moved).toBe(true);

		// A DIFFERENT machine (a fresh clone) re-claims via start: it must CONTINUE
		// from the kept branch, so the agent's partial commit is present.
		const fresh = seeded.clone('continuer');
		const restarted = await performStart({
			slug: 'alpha',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(restarted.exitCode).toBe(0);
		expect(restarted.branch).toBe('work/task-alpha');
		// The partial work the failed agent left is present on the continued branch.
		expect(existsSync(join(fresh, 'partial.txt'))).toBe(true);
	});

	it('an EMPTY failure (the agent made NO changes) is handled without crashing on an empty commit', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// The agent makes NO edits and fails (nothing to wip-commit).
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: () => ({ok: false, detail: 'agent did nothing'}),
			env: gitEnv(),
		});
		// No crash; still an agent failure, and the reason is STILL surfaced (the
		// move-only commit is non-empty even when there is no wip to save).
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.routedToNeedsAttention).toBe(true);
		expect(result.message).toMatch(/did nothing/);
		// The reason is STILL surfaced on the lock entry even with no wip to save (the
		// lock amend does not depend on a commit).
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
	});

	it('a THROWN agent error is saved the same way (commit + push + surface)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: ({cwd}) => {
				writeFileSync(join(cwd, 'partial.txt'), 'work before throw\n');
				throw new Error('agent crashed hard');
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.message).toMatch(/crashed hard/);
		expect(result.routedToNeedsAttention).toBe(true);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(['cat-file', '-e', 'arbiter/work/task-alpha:partial.txt'], repo),
		).toBe('');
	});

	it('the JOB-WORKTREE case is covered too (a non-cwd checkout still saves + pushes)', async () => {
		// `do` in-place and `do --remote`/`run` differ only in WHERE the checkout is;
		// the save+push path reads `cwd` + the arbiter remote, so it works regardless
		// of isolation form. Simulate the job-worktree form: run `do` against a
		// SEPARATE clone (not the seed repo), as a job worktree is a separate checkout
		// pointing at the same arbiter.
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const job = seeded.clone('job');
		const result = await performDo({
			arg: 'alpha',
			cwd: job,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: editsThenFails,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('agent-failed');
		expect(result.routedToNeedsAttention).toBe(true);
		// The stuck lock is marked + the branch pushed, from the job checkout.
		expect(stuckLockOnArbiter(job, 'alpha')).toBe(true);
		gitIn(['fetch', '-q', ARBITER], job);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/task-alpha'],
				job,
			).trim(),
		).not.toBe('');
		expect(
			gitIn(['cat-file', '-e', 'arbiter/work/task-alpha:partial.txt'], job),
		).toBe('');
	});
});

describe('do <slug> — failure-CAUSE classification (transient-infra / config-error / generic)', () => {
	it('a harness-surfaced model/connection outage (post-retry) → transient-infra, NOT generic agent-failed', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			// The harness already exhausted its own retries; what it SURFACES is a
			// connection/model outage (NOT the agent producing bad output).
			dorfl: () => ({
				ok: false,
				detail:
					'connection error: ECONNREFUSED to the model endpoint after retries',
			}),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('transient-infra');
		expect(result.outcome).not.toBe('agent-failed');
		expect(result.routedToNeedsAttention).toBe(true);
		// The cause is legible on the route reason.
		expect(result.message).toMatch(/transient[\s-]?infra/i);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
	});

	it('an agent that ran but produced bad/empty output stays the generic agent-failed (conservative default)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: () => ({ok: false, detail: 'the agent produced garbage'}),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('agent-failed');
		expect(result.outcome).not.toBe('transient-infra');
		expect(result.outcome).not.toBe('config-error');
	});

	it('a thrown CORE wiring/config error (review on, no reviewGate) → config-error (NOT usage-error)', async () => {
		// `review` on with NO `reviewGate` wired makes `performIntegration` throw a
		// wiring error; `performComplete` swallows it into `usage-error`, which `do`
		// now RECLASSIFIES onto `config-error` (the FAILURE-CAUSE axis) — so a wiring
		// bug is not mistaken for an environment/usage problem.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			review: true, // but no reviewGate ⇒ the core throws the wiring error
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('config-error');
		expect(result.outcome).not.toBe('usage-error');
		expect(result.outcome).not.toBe('agent-failed');
		expect(result.message).toMatch(/wiring bug|review gate/i);
	});
});

describe('do <slug> — a RED GATE bounce SAVES partial work cross-machine (push the work branch)', () => {
	/** A stubbed agent that EDITS a file (partial work) then succeeds — so the run
	 * reaches the GATE, which is red (the work is committed as the wip, then the
	 * gate-fail bounces it to needs-attention). */
	const editsThenPasses: DoDorfl = ({cwd}) => {
		writeFileSync(join(cwd, 'partial.txt'), 'gate-fail work\n');
		return {ok: true};
	};

	it('a red gate pushes the work/<slug> branch to the arbiter (mirrors the agent-fail path)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: FAIL,
			dorfl: editsThenPasses,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');

		// The stuck state is the per-item lock; the body STAYS in backlog/ on main.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);

		// THE FIX: the work/<slug> branch is now PUSHED to the arbiter, carrying the
		// agent's partial work (the wip commit) — the durable artifact a requeue
		// continues from (parity with the agent-fail path).
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/task-alpha'],
				repo,
			).trim(),
		).not.toBe('');
		// The partial edit is on the pushed branch (not dropped).
		expect(
			gitIn(['cat-file', '-e', 'arbiter/work/task-alpha:partial.txt'], repo),
		).toBe('');
		// But it never reached main (no auto-merge of failing work).
		expect(gitIn(['ls-tree', 'arbiter/main', 'partial.txt'], repo).trim()).toBe(
			'',
		);
	});

	it('the SAVED gate-fail work is recoverable: requeue (continue) from a FRESH clone lands on the branch WITH the aborted wip', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const repo = seeded.repo;

		// The gate fails after the agent edited; `do` saves + surfaces + pushes.
		const failed = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: FAIL,
			dorfl: editsThenPasses,
			env: gitEnv(),
		});
		expect(failed.outcome).toBe('needs-attention');

		// A human resolves the cause and requeues (default = keep + continue): the
		// ledger file moves needs-attention → backlog; the pushed work branch stays.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		const requeued = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(requeued.moved).toBe(true);

		// A DIFFERENT machine (a fresh clone) re-claims via start: it must CONTINUE
		// from the kept branch (which exists ONLY because the gate-fail pushed it),
		// so the agent's aborted wip is present.
		const fresh = seeded.clone('gate-continuer');
		const restarted = await performStart({
			slug: 'alpha',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(restarted.exitCode).toBe(0);
		expect(restarted.branch).toBe('work/task-alpha');
		// The partial work the gate-failed run left is present on the continued branch.
		expect(existsSync(join(fresh, 'partial.txt'))).toBe(true);
	});

	it('CONTRAST: the HUMAN `complete` gate-fail (no surfaceArbiter) does NOT push the work branch', async () => {
		// Locks the autonomous-vs-human divergence for the BRANCH PUSH (the do tests
		// already lock it for the on-main surface): a human is right there, so the
		// work stays local — no <arbiter>/work/<slug>.
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/task-beta', `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'partial.txt'), 'work\n');

		const result = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			verify: FAIL,
			// NB: NO surfaceArbiter — the human path.
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-failed');
		// Local-only (no surfaceArbiter): the lock is NOT marked stuck and the work
		// branch is NOT pushed (a human is right there). No needs-attention/ folder.
		expect(stuckLockOnArbiter(repo, 'beta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(false);
		// No `<arbiter>/work/task-beta` ref exists (the human path never pushes it).
		// `git ls-remote` is a soft check: it lists nothing for an absent ref.
		const remoteRefs = gitIn(
			['ls-remote', '--heads', ARBITER, 'work/task-beta'],
			repo,
		).trim();
		expect(remoteRefs).toBe('');
	});
});

describe('do <slug> — a deliberate STOP routes to needs-attention BEFORE the gate (agent-stop-signal)', () => {
	/** A STOP agent: emits the in-band sentinel in `output`, makes NO source change. */
	const stoppingAgent: DoDorfl = () => ({
		ok: true,
		output: [
			'I ran the task drift-check.',
			'=== TASK-STOP ===',
			'The task rests on premise X which is false against current src/foo.ts.',
			'Re-scope before re-claiming.',
			'=== END TASK-STOP ===',
		].join('\n'),
	});

	it('a sentinel STOP → agent-stopped, needs-attention with the VERBATIM reason, NO gate run', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// A gate that would EXPLODE if run — proves the gate is SKIPPED on a STOP.
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'echo GATE-RAN >&2; exit 1',
			dorfl: stoppingAgent,
			env: gitEnv(),
		});

		// The NEW terminal outcome — distinct from needs-attention / agent-failed.
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-stopped');
		expect(result.routedToNeedsAttention).toBe(true);
		// The agent's STOP reason is recorded VERBATIM in the message + body.
		expect(result.message).toMatch(/premise X which is false/);
		expect(result.message).toMatch(/Re-scope before re-claiming/);

		// Routed to stuck (the lock), surfaced on the arbiter via the lock ref.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);

		// The acceptance gate was NEVER run (the exploding verify never fired) — a
		// STOP short-circuits before the gate + Gate-2.
		// (If the gate had run, verify:exit 1 would still land needs-attention, but
		//  the outcome would be `needs-attention`, not `agent-stopped`; the distinct
		//  outcome above is the proof the STOP path was taken.)
	});

	it('the empty-diff BACKSTOP: agent.ok + NO source change → agent-stopped without a sentinel', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// An agent that succeeds but makes NO edits and emits NO sentinel.
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'echo GATE-RAN >&2; exit 0',
			dorfl: () => ({ok: true, output: 'all done (changed nothing)'}),
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-stopped');
		expect(result.routedToNeedsAttention).toBe(true);
		expect(result.message).toMatch(/no source change|empty diff|no-op/i);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});

	it('a NORMAL build (non-empty diff, no sentinel) is UNAFFECTED — it gates + completes', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			// editingAgent edits a file (non-empty diff) and emits NO sentinel.
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
	});

	it('a non-empty diff WITH a sentinel is still a STOP (the sentinel wins over scratch)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: ({cwd}) => {
				// Left some scratch, but DECLARED a STOP — the sentinel wins.
				writeFileSync(join(cwd, 'scratch.txt'), 'leftover\n');
				return {
					ok: true,
					output: [
						'=== TASK-STOP ===',
						'drifted: the API this task targets was removed.',
						'=== END TASK-STOP ===',
					].join('\n'),
				};
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('agent-stopped');
		expect(result.message).toMatch(/the API this task targets was removed/);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});

	it('agent-failed (the agent ERRORED) is UNCHANGED — STOP is a THIRD state', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: () => ({ok: false, detail: 'agent exploded'}),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('agent-failed');
		expect(result.outcome).not.toBe('agent-stopped');
		expect(result.message).toMatch(/exploded/);
	});
});

describe('do <slug> — on the ISOLATION SEAM: in-place onboarding via inPlaceStrategy', () => {
	// These pin the equivalence the `do-run-share-isolation-seam` task requires:
	// in-place `do` now onboards through `selectIsolationStrategy({checkout})` →
	// `inPlaceStrategy.prepare()` (the §14 continue + §10 conflict path) instead of
	// composing `performStart`'s onboarding on a literal `cwd`.

	it('CONTINUES a requeued kept work/<slug> in-place: the agent sees the prior work + the run completes', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const repo = seeded.repo;

		// First attempt: the agent edits a file, the gate is RED → `do` saves the
		// partial work + pushes `work/task-alpha` to the arbiter (the durable artifact a
		// requeue continues from).
		const first = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: FAIL,
			dorfl: ({cwd}) => {
				writeFileSync(join(cwd, 'prior.txt'), 'prior attempt work\n');
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(first.outcome).toBe('needs-attention');

		// A human resolves the cause + requeues (keep + continue): the ledger file
		// moves needs-attention → backlog; the pushed work branch stays on the arbiter.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		const requeued = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(requeued.moved).toBe(true);

		// Second attempt IN-PLACE: `inPlaceStrategy.prepare()` must CONTINUE from the
		// kept branch (not cut fresh off main), so the agent runs ON the prior work.
		let sawPriorWork = false;
		const second = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: ({cwd}) => {
				sawPriorWork = existsSync(join(cwd, 'prior.txt'));
				writeFileSync(join(cwd, 'agent-output.txt'), 'finished\n');
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(second.outcome).toBe('completed');
		// The continue worked: the agent saw the prior attempt's file (onboarded onto
		// the kept branch, the seam's §14 continue path).
		expect(sawPriorWork).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
	});

	it('a CONTINUE-FROM-TIP whose prior work is already committed + green and adds NOTHING this session is NOT a no-op (reaches the gate + PR, task noop-backstop-counts-branch-commits)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const repo = seeded.repo;

		// First attempt: the agent produces real source work, but the gate is RED →
		// `do` saves the partial work + pushes `work/task-alpha` to the arbiter (a chain of
		// COMMITTED commits ahead of main — the durable artifact a requeue continues).
		const first = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: FAIL,
			dorfl: ({cwd}) => {
				writeFileSync(join(cwd, 'feature.ts'), 'export const x = 1;\n');
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(first.outcome).toBe('needs-attention');

		// Requeue (keep + continue): the ledger moves needs-attention → backlog; the
		// pushed work branch (with the committed feature) stays on the arbiter.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		const requeued = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(requeued.moved).toBe(true);

		// Second attempt: the cause is already fixed on the kept branch, so the agent
		// correctly adds NOTHING this session (clean working tree). BEFORE this task
		// the working-tree-only backstop read that as a no-op and routed to
		// needs-attention BEFORE the gate; now the prior SOURCE commit ahead of
		// `<arbiter>/main` keeps it out of "no-op" so it flows to the gate + completes.
		const second = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: () => ({ok: true, output: 'prior work already complete\n'}),
			env: gitEnv(),
		});
		expect(second.outcome).toBe('completed');
		expect(second.outcome).not.toBe('agent-stopped');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
	});

	it('a CONTINUE rebase CONFLICT onboarding in-place routes to needs-attention WITHOUT running the agent (§10)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const repo = seeded.repo;

		// First attempt edits a SHARED file then the gate fails → the kept work/task-alpha
		// (with that edit) is pushed to the arbiter.
		const first = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: FAIL,
			dorfl: ({cwd}) => {
				writeFileSync(join(cwd, 'shared.txt'), 'agent version\n');
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(first.outcome).toBe('needs-attention');

		// Requeue (keep + continue).
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		const requeued = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(requeued.moved).toBe(true);

		// Meanwhile main advances with a CONFLICTING edit to the same file (from a
		// separate clone), so the kept branch cannot replay onto the new main.
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'shared.txt'), 'main version (conflicting)\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'conflicting main edit'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		// Second attempt IN-PLACE: the onboard-time continue rebase conflicts → the
		// seam sets continueRebaseConflict → the driver routes to needs-attention and
		// NEVER runs the agent (the §10 path), surfaced on the arbiter.
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		let agentRan = false;
		const second = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(second.exitCode).toBe(1);
		expect(second.outcome).toBe('needs-attention');
		expect(second.message).toMatch(/conflict/i);
		// The agent NEVER ran (the §10 continue-conflict returns before the agent),
		// and the run did NOT complete — byte-parity with `run`'s onboard-conflict.
		expect(agentRan).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		// The durable artifact — the kept work/task-alpha branch — is still on the arbiter
		// (the rebase was aborted; recovery flows through the branch + the surface the
		// prior bounce already published).
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/task-alpha'],
				repo,
			).trim(),
		).not.toBe('');
	});

	it('an already-in-progress (claimed) item is skipped as LOST in-place (claim-or-lose, like do --remote/run)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		const repo = seeded.repo;
		// Another doer claims first from a separate clone.
		const other = seeded.clone('other');
		const won = await performClaim({
			slug: 'solo',
			cwd: other,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(won.exitCode).toBe(0);

		let agentRan = false;
		const result = await performDo({
			arg: 'task:solo', // explicit (no backlog existence check), reaches the claim
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		// The claim-first composition reports the in-progress item as LOST (exit 2),
		// runs no agent, creates no work branch — `do` never re-claims someone's item.
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
		expect(agentRan).toBe(false);
		expect(currentBranch(repo)).toBe('main');
	});
});

describe('do <slug> — --merge / --propose resolve at integrate-time', () => {
	it('--merge lands the work ON the arbiter main (done/)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
	});

	it('--propose (the CI default) pushes the work branch + does NOT auto-merge the work to main (CI equivalence to ar-run.sh --propose)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');

		// propose: the work CODE is on a PUSHED branch awaiting review, NOT merged
		// to main. Claim writes NOTHING to main (the body stays in backlog/), and
		// the agent's work has not auto-landed (the done-move is on the branch, not main).
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		// The agent's edit is NOT on main (no auto-merge in propose).
		const onMain = gitIn(
			['ls-tree', 'arbiter/main', 'agent-output.txt'],
			repo,
		).trim();
		expect(onMain).toBe('');
		// The work branch was pushed to the arbiter (the safety-bearing step).
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/task-alpha'],
				repo,
			).trim(),
		).not.toBe('');
	});
});

describe('do <slug> — propose PR body: the agent OUTPUT reaches the provider --body', () => {
	/**
	 * Half B source-capture: `runDoAgent` now RETURNS the build agent's
	 * `LaunchResult.output` (it used to drop it), and `do` threads it into
	 * `performComplete` as the PR `body`. With a `gh` stub on PATH (recording its
	 * args), the stubbed agent's `output` must surface in `gh pr create --body`.
	 */
	it('a stubbed agent`s output is threaded to gh pr create --body (under a task pointer)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// A recording `gh` stub on PATH (no real GitHub).
		const binDir = join(scratch.root, 'gh-stub-do');
		mkdirSync(binDir, {recursive: true});
		const argsFile = join(binDir, 'gh-args.txt');
		const gh = join(binDir, 'gh');
		writeFileSync(
			gh,
			[
				'#!/usr/bin/env bash',
				`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
				"printf '%s\\n' 'https://github.com/o/r/pull/5'",
				'exit 0',
			].join('\n') + '\n',
		);
		chmodSync(gh, 0o755);

		// The build agent SUPPLIES a final summary on `output` (the source channel).
		const summarisingAgent: DoDorfl = ({cwd}) => {
			writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
			return {
				ok: true,
				output: 'Implemented alpha. Note: refactored the seam.',
			};
		};

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh}),
			verify: PASS,
			dorfl: summarisingAgent,
			env: {...gitEnv(), PATH: `${binDir}:${process.env.PATH ?? ''}`},
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');

		const args = readFileSync(argsFile, 'utf8');
		expect(args).toMatch(/^--body$/m);
		expect(args).toContain('Implemented alpha. Note: refactored the seam.');
		expect(args).toContain('work/tasks/done/alpha.md');
		// Half A still applies: a synthesised single-line title, never --fill.
		expect(args).toMatch(/^--title$/m);
		expect(args).not.toMatch(/^--fill$/m);
	});

	it('a ## Decisions block in agent.output is SURFACED for review (in the PR body) and does NOT block (Part B)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const binDir = join(scratch.root, 'gh-stub-decisions');
		mkdirSync(binDir, {recursive: true});
		const argsFile = join(binDir, 'gh-args.txt');
		const gh = join(binDir, 'gh');
		writeFileSync(
			gh,
			[
				'#!/usr/bin/env bash',
				`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
				"printf '%s\\n' 'https://github.com/o/r/pull/7'",
				'exit 0',
			].join('\n') + '\n',
		);
		chmodSync(gh, 0o755);

		// The agent PROCEEDS (real edit, no STOP sentinel) but records a non-obvious
		// in-scope decision in a `## Decisions` block on its output channel.
		const decidingAgent: DoDorfl = ({cwd}) => {
			writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
			return {
				ok: true,
				output: [
					'Implemented alpha.',
					'',
					'## Decisions',
					'',
					'- Chose to ERROR on -n × --remote (touches the do command); ',
					'  alternative: silently auto-pick. Reversible.',
				].join('\n'),
			};
		};

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh}),
			verify: PASS,
			dorfl: decidingAgent,
			env: {...gitEnv(), PATH: `${binDir}:${process.env.PATH ?? ''}`},
		});

		// The build PROCEEDED + completed — a recorded decision NEVER blocks.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');

		// The decisions block is surfaced for review via the PR body (the existing
		// agent.output → --body path), so Gate-2 + the human see it in the PR.
		const args = readFileSync(argsFile, 'utf8');
		expect(args).toMatch(/^--body$/m);
		expect(args).toContain('## Decisions');
		expect(args).toContain('ERROR on -n × --remote');
	});

	it('no agent output ⇒ no body ⇒ gh still gets the title (no regression to a run-on)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const binDir = join(scratch.root, 'gh-stub-do2');
		mkdirSync(binDir, {recursive: true});
		const argsFile = join(binDir, 'gh-args.txt');
		const gh = join(binDir, 'gh');
		writeFileSync(
			gh,
			[
				'#!/usr/bin/env bash',
				`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
				"printf '%s\\n' 'https://github.com/o/r/pull/6'",
				'exit 0',
			].join('\n') + '\n',
		);
		chmodSync(gh, 0o755);

		// editingAgent supplies NO `output` ⇒ no PR body.
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh}),
			verify: PASS,
			dorfl: editingAgent,
			env: {...gitEnv(), PATH: `${binDir}:${process.env.PATH ?? ''}`},
		});
		expect(result.exitCode).toBe(0);
		const args = readFileSync(argsFile, 'utf8');
		// Title always present; the (empty) body field present so gh never re-derives.
		expect(args).toMatch(/^--title$/m);
		expect(args).toMatch(/^--body$/m);
		expect(args).not.toMatch(/^--fill$/m);
	});
});

describe('do <slug> — noPR (the PR-INTENT axis) + the up-front gh-probe guard', () => {
	/** A recording `gh` stub that succeeds; returns its bin path + an args reader. */
	function recordingGh(tag: string): {bin: string; readArgs(): string} {
		const binDir = join(scratch.root, `gh-stub-${tag}`);
		mkdirSync(binDir, {recursive: true});
		const argsFile = join(binDir, 'gh-args.txt');
		const gh = join(binDir, 'gh');
		writeFileSync(
			gh,
			[
				'#!/usr/bin/env bash',
				`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
				"printf '%s\\n' 'https://github.com/o/r/pull/9'",
				'exit 0',
			].join('\n') + '\n',
		);
		chmodSync(gh, 0o755);
		return {
			bin: gh,
			readArgs: () =>
				existsSync(argsFile) ? readFileSync(argsFile, 'utf8') : '',
		};
	}

	it('noPR: true ⇒ propose pushes the branch but does NOT open a PR (no gh call), even with an authed GitHub provider', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gh = recordingGh('nopr-set');
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			noPR: true,
			// An authed GitHub provider is injected, yet noPR suppresses the PR.
			providerInstance: new GitHubProvider({ghBin: gh.bin}),
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// `gh pr create` was NEVER invoked (no args file written) — no PR opened.
		expect(gh.readArgs()).toBe('');
		// The branch IS pushed to the arbiter (the safety-bearing step still runs).
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/task-alpha'],
				repo,
			).trim(),
		).not.toBe('');
	});

	it('noPR unset ⇒ propose opens the PR normally (the default "I want a PR")', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gh = recordingGh('nopr-unset');
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			// noPR omitted (the default).
			providerInstance: new GitHubProvider({ghBin: gh.bin}),
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// `gh pr create` WAS invoked — the PR opened.
		expect(gh.readArgs()).toMatch(/^create$/m);
	});

	it('EARLY VISIBLE FAILURE: propose + GitHub arbiter + noPR unset + a failing gh PROBE ⇒ fails UP FRONT, before any build (no claim, no agent run)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Make the arbiter remote URL read as GitHub. The guard fires BEFORE any
		// fetch/push (it only `git remote get-url`s), so a github.com URL is safe here
		// — no network op runs because the guard refuses first.
		gitIn(['remote', 'set-url', ARBITER, 'https://github.com/o/r.git'], repo);
		let agentRan = false;
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			// noPR unset (the operator INTENDS a PR). The probe says `gh` cannot open one.
			ghCanOpenPr: () => false,
			verify: PASS,
			dorfl: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		// The error names the real fixes (gh auth / providers.github token / --merge / --no-pr).
		expect(result.message).toMatch(/gh auth login/);
		expect(result.message).toMatch(/--no-pr/);
		expect(result.message).toMatch(/--merge/);
		// NO build work ran: the agent never launched, and the item is NOT in-progress.
		expect(agentRan).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
	});

	it('AMBIENT AUTH NOT BROKEN: propose + GitHub arbiter + noPR unset + a PASSING probe ⇒ the up-front guard does NOT refuse (the run gets past it)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// A GitHub arbiter URL (no `providers.github` identity — the common local-dev
		// case: ambient `gh` auth). The probe PASSES, so the guard must NOT fire. (We
		// can only assert the guard let it through offline — a real fetch to github.com
		// would need the network — so we assert the outcome is NOT the up-front refusal
		// and the guard's message is absent; the probe-passes→doesn't-fire logic is also
		// unit-tested in do-config.test.ts.)
		gitIn(['remote', 'set-url', ARBITER, 'https://github.com/o/r.git'], repo);
		let probed = false;
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			// No `providers.github` identity, but the probe PASSES (ambient `gh` auth).
			ghCanOpenPr: () => {
				probed = true;
				return true;
			},
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		// The probe ran (the guard consulted it) but did NOT refuse — ambient auth is
		// honoured. The outcome is whatever the (offline) onboarding produced, but it is
		// NOT the up-front PR-intent refusal.
		expect(probed).toBe(true);
		expect(result.message).not.toMatch(/intends a PR, but `gh` is not/);
	});
});

describe('do — slug resolution (§3a): bare / task: / prd: + collision', () => {
	it('a bare slug resolves to the task and builds it', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha', // bare → the task
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('alpha');
	});

	it('an explicit task:<slug> resolves to the task and builds it', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('alpha');
	});

	it('do prd:<slug> dispatches to the tasking path; an EXPLICITLY-named PRD tasks with autoTask OFF (naming IS the authorization)', async () => {
		// The build/task symmetry (task `explicit-do-prd-not-gated-by-autoslice`):
		// `do prd:<slug>` is an EXPLICIT target the operator named, so it tasks
		// REGARDLESS of the repo's `autoTask` POLICY — EXACTLY as `do <task>` builds a
		// named task regardless of `autoBuild`. autoTask OFF (the default) no longer
		// refuses the explicit form (the policy gates the auto-pick POOL only).
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedPrd(repo, 'somePrd');

		let agentRan = false;
		const result = await performDo({
			arg: 'prd:somePrd',
			cwd: repo,
			arbiter: ARBITER,
			// autoTask deliberately OMITTED (defaults off) — explicit naming authorizes.
			integration: 'merge',
			dorfl: ({cwd}) => {
				agentRan = true;
				const dir = join(cwd, 'work', 'tasks', 'backlog');
				mkdirSync(dir, {recursive: true});
				writeFileSync(
					join(dir, 'somePrd-explicit.md'),
					'---\nslug: somePrd-explicit\nprd: somePrd\n---\n\n## Prompt\n\n> x\n',
				);
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('tasked');
		expect(result.slug).toBe('somePrd');
		// The agent ran (the gate did NOT refuse on the policy).
		expect(agentRan).toBe(true);
	});

	it('do prd:<slug> on an explicitly-named humanOnly PRD STILL refuses (the readiness axis binds, only the policy dropped)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedPrd(repo, 'somePrd', {humanOnly: true});

		let agentRan = false;
		const result = await performDo({
			arg: 'prd:somePrd',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('gate-refused');
		expect(result.slug).toBe('somePrd');
		expect(result.message).toMatch(/humanOnly/);
		// The policy is NEVER the named reason on the explicit path.
		expect(result.message).not.toMatch(/autoTask/);
		expect(agentRan).toBe(false);
	});

	it('do prd:<slug> with autoTask on tasks the PRD (runner owns the git)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'somePrd');

		// The stubbed tasking agent writes a backlog task file (no git).
		const result = await performDo({
			arg: 'prd:somePrd',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			// `--merge`: the task output now integrates through the shared core; merge
			// lands it on the arbiter main (propose would open a PR instead).
			integration: 'merge',
			dorfl: ({cwd}) => {
				const dir = join(cwd, 'work', 'tasks', 'backlog');
				mkdirSync(dir, {recursive: true});
				writeFileSync(
					join(dir, 'somePrd-first.md'),
					[
						'---',
						'title: somePrd-first',
						'slug: somePrd-first',
						'prd: somePrd',
						'---',
						'',
						'## Prompt',
						'',
						'> build it',
						'',
					].join('\n'),
				);
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('tasked');
		expect(result.slug).toBe('somePrd');

		// The runner committed the produced backlog task + moved the PRD into the
		// TASKED resting state (tasking/ -> prd-tasked/, the source of truth).
		run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
		expect(
			run(
				'git',
				[
					'cat-file',
					'-e',
					`${ARBITER}/main:work/tasks/backlog/somePrd-first.md`,
				],
				repo,
				{env: gitEnv()},
			).status,
		).toBe(0);
		expect(
			run(
				'git',
				['cat-file', '-e', `${ARBITER}/main:work/prds/tasked/somePrd.md`],
				repo,
				{env: gitEnv()},
			).status,
		).toBe(0);
		// The PRD has LEFT prd/ (it rests in prd-tasked/ now).
		expect(
			run(
				'git',
				['cat-file', '-e', `${ARBITER}/main:work/prds/ready/somePrd.md`],
				repo,
				{env: gitEnv()},
			).status,
		).not.toBe(0);
		// tasking/ is empty (the lock was released). Tasked-ness is RESIDENCE in
		// prd-tasked/ (asserted above); the `tasked:` marker was removed entirely in
		// remove-sliced-marker-step-b, so the resting PRD carries NO tasked: line.
		expect(
			run(
				'git',
				['cat-file', '-e', `${ARBITER}/main:work/tasking/somePrd.md`],
				repo,
				{env: gitEnv()},
			).status,
		).not.toBe(0);
		const prd = run(
			'git',
			['show', `${ARBITER}/main:work/prds/tasked/somePrd.md`],
			repo,
			{env: gitEnv()},
		).stdout;
		expect(prd).not.toMatch(/^tasked:/m);
	});

	it('a bare slug that collides (a task AND a PRD share it) ERRORS loudly', async () => {
		// Seed a task `dup` AND a PRD `dup` → a bare `do dup` is ambiguous.
		const {repo} = seedRepoWithArbiter(scratch.root, ['dup']);
		seedPrd(repo, 'dup');

		const result = await performDo({
			arg: 'dup', // bare → ambiguous across namespaces
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/ambiguous/i);
		expect(result.message).toMatch(/task:dup/);
		expect(result.message).toMatch(/prd:dup/);
		// Nothing was claimed — the collision halts before any git transition.
		expect(existsOnArbiterMain(repo, 'backlog', 'dup')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'dup')).toBe(false);
	});

	it('an explicit task:<slug> on a colliding slug is unambiguous (builds the task)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['dup']);
		seedPrd(repo, 'dup');

		const result = await performDo({
			arg: 'task:dup', // explicit → no collision check, builds the task
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('dup');
		expect(existsOnArbiterMain(repo, 'done', 'dup')).toBe(true);
	});
});

/**
 * Per-TRANSITION integration mode
 * (`per-transition-integration-mode-slicing-vs-build`): the option-threading
 * caller (`performDo`) threads `taskingIntegration ?? integration` into the
 * TASKING transition, but plain `integration` into the task-BUILD transition. So
 * a repo with `integration:'propose'` + `taskingIntegration:'merge'` lands the
 * task FILES on main when tasking a PRD, yet does NOT auto-land code on main when
 * building a task. UNSET `taskingIntegration` ⇒ tasking falls back to
 * `integration` (byte-for-byte today's behaviour). An explicit `--merge`/`--propose`
 * is resolved into BOTH keys upstream (`do-config.ts`, covered in do-config.test.ts).
 */
const taskingAgent: DoDorfl = ({cwd}) => {
	const dir = join(cwd, 'work', 'tasks', 'backlog');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, 'somePrd-first.md'),
		[
			'---',
			'slug: somePrd-first',
			'prd: somePrd',
			'---',
			'',
			'## Prompt',
			'',
			'> x',
			'',
		].join('\n'),
	);
	return {ok: true};
};

describe('do — per-transition integration mode (taskingIntegration vs integration)', () => {
	it('the TASKING transition uses `taskingIntegration` over `integration`: `integration:propose` + `taskingIntegration:merge` lands the task FILES on main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'somePrd');

		const result = await performDo({
			arg: 'prd:somePrd',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			// The maintainer's target: build proposes, tasking merges. The caller threads
			// `taskingIntegration ?? integration` (= 'merge') into the TASKING transition.
			integration: 'propose',
			taskingIntegration: 'merge',
			dorfl: taskingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('tasked');

		// merge ⇒ the produced task + the PRD lifecycle move landed on the arbiter main
		// (NOT on a work branch awaiting a PR). This is `taskingIntegration:'merge'`
		// winning over `integration:'propose'`.
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			run(
				'git',
				[
					'cat-file',
					'-e',
					`${ARBITER}/main:work/tasks/backlog/somePrd-first.md`,
				],
				repo,
				{env: gitEnv()},
			).status,
		).toBe(0);
		expect(
			run(
				'git',
				['cat-file', '-e', `${ARBITER}/main:work/prds/tasked/somePrd.md`],
				repo,
				{env: gitEnv()},
			).status,
		).toBe(0);
	});

	it('the task-BUILD transition keeps using `integration` (never `taskingIntegration`): `integration:propose` + `taskingIntegration:merge` does NOT auto-land code on main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			// The SAME options as the tasking test above. The build path reads `integration`
			// (propose), so `taskingIntegration:'merge'` MUST NOT leak into it.
			integration: 'propose',
			taskingIntegration: 'merge',
			verify: PASS,
			dorfl: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// propose ⇒ the build is NOT on main (the task files of the build path stay in
		// in-progress; the agent's code edit is not auto-merged).
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(['ls-tree', 'arbiter/main', 'agent-output.txt'], repo).trim(),
		).toBe('');
	});

	it('UNSET `taskingIntegration` ⇒ tasking falls back to `integration` (byte-for-byte today): `integration:merge` with no override lands the task files on main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'somePrd');

		const result = await performDo({
			arg: 'prd:somePrd',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			// No `taskingIntegration` ⇒ the caller threads `undefined ?? 'merge'` = 'merge'.
			integration: 'merge',
			dorfl: taskingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			run(
				'git',
				[
					'cat-file',
					'-e',
					`${ARBITER}/main:work/tasks/backlog/somePrd-first.md`,
				],
				repo,
				{env: gitEnv()},
			).status,
		).toBe(0);
	});

	it('an explicit tasking mode wins over the config: passing `taskingIntegration:propose` (the resolved flag) on an `integration:propose` repo does NOT land task files on main', async () => {
		// `do-config.ts` resolves an explicit `--propose`/`--merge` into BOTH
		// `integration` AND `taskingIntegration`, so the operator's flag wins for the
		// TASKING transition too. Here we pin the threaded effect: a `propose`-resolved
		// tasking transition pushes the work branch + leaves main untouched (no PR
		// provider needed for a local --bare arbiter; selectProvider derives `none`).
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'somePrd');

		const result = await performDo({
			arg: 'prd:somePrd',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'propose',
			taskingIntegration: 'propose',
			dorfl: taskingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		gitIn(['fetch', '-q', ARBITER], repo);
		// propose ⇒ the task files are NOT on main (they ride the pushed work branch).
		expect(
			run(
				'git',
				[
					'cat-file',
					'-e',
					`${ARBITER}/main:work/tasks/backlog/somePrd-first.md`,
				],
				repo,
				{env: gitEnv()},
			).status,
		).not.toBe(0);
		// The work branch was pushed carrying the tasks (the PR source).
		expect(
			run(
				'git',
				[
					'cat-file',
					'-e',
					`${ARBITER}/work/prd-somePrd:work/tasks/backlog/somePrd-first.md`,
				],
				repo,
				{env: gitEnv()},
			).status,
		).toBe(0);
	});
});
