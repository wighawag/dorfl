import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	mkdirSync,
	existsSync,
	chmodSync,
	readFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {performDo, type DoAgentRunner} from '../src/do.js';
import {performComplete} from '../src/complete.js';
import {performStart} from '../src/start.js';
import {returnToBacklog} from '../src/needs-attention.js';
import {performClaim} from '../src/claim-cas.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `do <slug>` (in-place form) tests — the per-repo, in-place WORKER (the CI
 * command) that COMPOSES `start` + (autonomous agent run) + `complete`, guarded
 * by a dirty-tree refusal. House style: a throwaway checkout + a local `--bare`
 * arbiter + a STUBBED agent (the injected `agentRunner` edits files directly,
 * never a real harness). It drives real git + writes `main` (the autonomous
 * needs-attention surfacing), so it lives in the non-parallel project.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-do-');
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
const editingAgent: DoAgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

/** Seed a `work/prd/<slug>.md` in the checkout's working tree (for prd: tests). */
function seedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'prd');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		['---', `title: ${slug}`, `slug: ${slug}`, '---', '', '# PRD', ''].join(
			'\n',
		),
	);
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
			agentRunner: editingAgent,
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
		expect(gitIn(['branch', '--list', 'work/alpha'], repo).trim()).toBe('');
	});

	it('the AGENT does no git — the runner owns claim + done-move + commit', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// An agent that ASSERTS the tree is already on the work branch + claimed
		// (the runner onboarded) and only edits code.
		const assertingAgent: DoAgentRunner = ({cwd, slug}) => {
			expect(currentBranch(cwd)).toBe(`work/${slug}`);
			// in-progress (claimed) in the tree; the agent never moved it.
			expect(existsSync(join(cwd, 'work', 'in-progress', `${slug}.md`))).toBe(
				true,
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
			agentRunner: assertingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
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
			agentRunner: editingAgent,
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
			agentRunner: editingAgent,
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
			agentRunner: () => {
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
		expect(gitIn(['branch', '--list', 'work/solo'], repo).trim()).toBe('');
		expect(currentBranch(repo)).toBe('main');
	});

	it('a genuine two-doer race: the loser skips, the winner completes', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['race']);
		const a = seeded.clone('a');
		const b = seeded.clone('b');

		const [ra, rb] = await Promise.all([
			performDo({
				arg: 'race',
				cwd: a,
				arbiter: ARBITER,
				integration: 'merge',
				verify: PASS,
				agentRunner: editingAgent,
				env: gitEnv(),
			}),
			performDo({
				arg: 'race',
				cwd: b,
				arbiter: ARBITER,
				integration: 'merge',
				verify: PASS,
				agentRunner: editingAgent,
				env: gitEnv(),
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
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');

		// CRITICAL — `do` is autonomous: the stuck state is SURFACED ON MAIN (the
		// mode-M cherry-pick of the move-only commit), so scan/status/another
		// machine can see it. A `complete` (human) call without surfaceArbiter
		// would leave main showing in-progress; `do` MUST surface it.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);

		// Locally too, the item bounced to needs-attention/ with the reason.
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			true,
		);
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			false,
		);
	});

	it('CONTRAST: human `complete` (no surfaceArbiter) routes LOCAL-ONLY — main still shows in-progress', async () => {
		// This locks the AUTONOMOUS-vs-HUMAN divergence the slice flags: `do` passes
		// the arbiter (surfaces on main); the human `complete` does NOT, so a red
		// gate leaves main showing in-progress (a human is right there). If someone
		// made `complete` always surface, this fails.
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
		gitIn(['switch', '-q', '-c', 'work/beta', `${ARBITER}/main`], repo);
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
		// Local-only: the item bounced locally, but main was NOT surfaced — it still
		// shows the in-progress claim (the human's, no cross-machine surfacing).
		expect(existsSync(join(repo, 'work', 'needs-attention', 'beta.md'))).toBe(
			true,
		);
		expect(existsOnArbiterMain(repo, 'in-progress', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(false);
	});

	it('an agent failure before the gate surfaces agent-failed (item NOT moved to done)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			agentRunner: () => ({ok: false, detail: 'agent exploded'}),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.message).toMatch(/exploded/);
		// Claimed + onboarded, but never integrated → not done on the arbiter.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});
});

describe('do <slug> — an agent FAILURE SAVES partial work (commit + push + surface)', () => {
	/** A stubbed agent that EDITS a file (partial work) then returns ok:false. */
	const editsThenFails: DoAgentRunner = ({cwd}) => {
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
			agentRunner: editsThenFails,
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
		// (a) surfaced ON THE ARBITER main (mode-M), cross-machine visible.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);

		// (b) the failure reason is recorded in the item body.
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			true,
		);

		// (c) the work/<slug> branch is PUSHED to the arbiter, carrying the agent's
		// partial work (a wip commit) — the durable artifact a requeue continues from.
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/alpha'],
				repo,
			).trim(),
		).not.toBe('');
		// The agent's partial edit is on that pushed branch (not dropped).
		expect(
			gitIn(['cat-file', '-e', 'arbiter/work/alpha:partial.txt'], repo),
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
			agentRunner: editsThenFails,
			env: gitEnv(),
		});
		expect(failed.outcome).toBe('agent-failed');
		expect(failed.routedToNeedsAttention).toBe(true);

		// A human resolves the cause and requeues (default = keep + continue): the
		// ledger file moves needs-attention → backlog; the pushed work branch stays.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		const requeued = returnToBacklog({
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
		expect(restarted.branch).toBe('work/alpha');
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
			agentRunner: () => ({ok: false, detail: 'agent did nothing'}),
			env: gitEnv(),
		});
		// No crash; still an agent failure, and the reason is STILL surfaced (the
		// move-only commit is non-empty even when there is no wip to save).
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.routedToNeedsAttention).toBe(true);
		expect(result.message).toMatch(/did nothing/);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			true,
		);
	});

	it('a THROWN agent error is saved the same way (commit + push + surface)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			agentRunner: ({cwd}) => {
				writeFileSync(join(cwd, 'partial.txt'), 'work before throw\n');
				throw new Error('agent crashed hard');
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.message).toMatch(/crashed hard/);
		expect(result.routedToNeedsAttention).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(['cat-file', '-e', 'arbiter/work/alpha:partial.txt'], repo),
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
			agentRunner: editsThenFails,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('agent-failed');
		expect(result.routedToNeedsAttention).toBe(true);
		// Surfaced on the arbiter main + the branch pushed, from the job checkout.
		expect(existsOnArbiterMain(job, 'needs-attention', 'alpha')).toBe(true);
		gitIn(['fetch', '-q', ARBITER], job);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/alpha'],
				job,
			).trim(),
		).not.toBe('');
		expect(
			gitIn(['cat-file', '-e', 'arbiter/work/alpha:partial.txt'], job),
		).toBe('');
	});
});

describe('do <slug> — a RED GATE bounce SAVES partial work cross-machine (push the work branch)', () => {
	/** A stubbed agent that EDITS a file (partial work) then succeeds — so the run
	 * reaches the GATE, which is red (the work is committed as the wip, then the
	 * gate-fail bounces it to needs-attention). */
	const editsThenPasses: DoAgentRunner = ({cwd}) => {
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
			agentRunner: editsThenPasses,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');

		// The LEDGER is surfaced on main (mode-M), as before.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);

		// THE FIX: the work/<slug> branch is now PUSHED to the arbiter, carrying the
		// agent's partial work (the wip commit) — the durable artifact a requeue
		// continues from (parity with the agent-fail path).
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/alpha'],
				repo,
			).trim(),
		).not.toBe('');
		// The partial edit is on the pushed branch (not dropped).
		expect(
			gitIn(['cat-file', '-e', 'arbiter/work/alpha:partial.txt'], repo),
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
			agentRunner: editsThenPasses,
			env: gitEnv(),
		});
		expect(failed.outcome).toBe('needs-attention');

		// A human resolves the cause and requeues (default = keep + continue): the
		// ledger file moves needs-attention → backlog; the pushed work branch stays.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		const requeued = returnToBacklog({
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
		expect(restarted.branch).toBe('work/alpha');
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
		gitIn(['switch', '-q', '-c', 'work/beta', `${ARBITER}/main`], repo);
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
		// Local bounce happened, but the work branch was NOT pushed.
		expect(existsSync(join(repo, 'work', 'needs-attention', 'beta.md'))).toBe(
			true,
		);
		// No `<arbiter>/work/beta` ref exists (the human path never pushes it).
		// `git ls-remote` is a soft check: it lists nothing for an absent ref.
		const remoteRefs = gitIn(
			['ls-remote', '--heads', ARBITER, 'work/beta'],
			repo,
		).trim();
		expect(remoteRefs).toBe('');
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
			agentRunner: editingAgent,
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
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');

		// propose: the work CODE is on a PUSHED branch awaiting review, NOT merged
		// to main. The CLAIM move IS on main (the item is in-progress, not done),
		// but the agent's work has not auto-landed.
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(true);
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
				['rev-parse', '--verify', '--quiet', 'arbiter/work/alpha'],
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
	it('a stubbed agent`s output is threaded to gh pr create --body (under a slice pointer)', async () => {
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
		const summarisingAgent: DoAgentRunner = ({cwd}) => {
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
			provider: 'github',
			verify: PASS,
			agentRunner: summarisingAgent,
			env: {...gitEnv(), PATH: `${binDir}:${process.env.PATH ?? ''}`},
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');

		const args = readFileSync(argsFile, 'utf8');
		expect(args).toMatch(/^--body$/m);
		expect(args).toContain('Implemented alpha. Note: refactored the seam.');
		expect(args).toContain('work/done/alpha.md');
		// Half A still applies: a synthesised single-line title, never --fill.
		expect(args).toMatch(/^--title$/m);
		expect(args).not.toMatch(/^--fill$/m);
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
			provider: 'github',
			verify: PASS,
			agentRunner: editingAgent,
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

describe('do — slug resolution (§3a): bare / slice: / prd: + collision', () => {
	it('a bare slug resolves to the slice and builds it', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha', // bare → the slice
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('alpha');
	});

	it('an explicit slice:<slug> resolves to the slice and builds it', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'slice:alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('alpha');
	});

	it('do prd:<slug> dispatches to the slicing path (gate-bound for the agent)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedPrd(repo, 'somePrd');

		let agentRan = false;
		// autoSlice OFF (the default) → the agent gate refuses an undeclared PRD. The
		// refusal is HONEST (names autoSlice) and runs no agent / no slicing.
		const result = await performDo({
			arg: 'prd:somePrd',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('gate-refused');
		expect(result.slug).toBe('somePrd');
		expect(result.message).toMatch(/autoSlice/);
		// The gate refused BEFORE running the agent / taking the lock.
		expect(agentRan).toBe(false);
	});

	it('do prd:<slug> with autoSlice on slices the PRD (runner owns the git)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'somePrd');

		// The stubbed slicing agent writes a backlog slice file (no git).
		const result = await performDo({
			arg: 'prd:somePrd',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			agentRunner: ({cwd}) => {
				const dir = join(cwd, 'work', 'backlog');
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
		expect(result.outcome).toBe('sliced');
		expect(result.slug).toBe('somePrd');

		// The runner committed the produced backlog slice + restored the PRD to prd/.
		run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
		expect(
			run(
				'git',
				['cat-file', '-e', `${ARBITER}/main:work/backlog/somePrd-first.md`],
				repo,
				{env: gitEnv()},
			).status,
		).toBe(0);
		expect(
			run(
				'git',
				['cat-file', '-e', `${ARBITER}/main:work/prd/somePrd.md`],
				repo,
				{env: gitEnv()},
			).status,
		).toBe(0);
		// slicing/ is empty (the lock was released), and the PRD is marked sliced.
		expect(
			run(
				'git',
				['cat-file', '-e', `${ARBITER}/main:work/slicing/somePrd.md`],
				repo,
				{env: gitEnv()},
			).status,
		).not.toBe(0);
		const prd = run(
			'git',
			['show', `${ARBITER}/main:work/prd/somePrd.md`],
			repo,
			{env: gitEnv()},
		).stdout;
		expect(prd).toMatch(/sliced:/);
	});

	it('a bare slug that collides (a slice AND a PRD share it) ERRORS loudly', async () => {
		// Seed a slice `dup` AND a PRD `dup` → a bare `do dup` is ambiguous.
		const {repo} = seedRepoWithArbiter(scratch.root, ['dup']);
		seedPrd(repo, 'dup');

		const result = await performDo({
			arg: 'dup', // bare → ambiguous across namespaces
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/ambiguous/i);
		expect(result.message).toMatch(/slice:dup/);
		expect(result.message).toMatch(/prd:dup/);
		// Nothing was claimed — the collision halts before any git transition.
		expect(existsOnArbiterMain(repo, 'backlog', 'dup')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'dup')).toBe(false);
	});

	it('an explicit slice:<slug> on a colliding slug is unambiguous (builds the slice)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['dup']);
		seedPrd(repo, 'dup');

		const result = await performDo({
			arg: 'slice:dup', // explicit → no collision check, builds the slice
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('dup');
		expect(existsOnArbiterMain(repo, 'done', 'dup')).toBe(true);
	});
});
