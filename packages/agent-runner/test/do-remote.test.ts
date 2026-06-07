import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	mkdirSync,
	existsSync,
	readdirSync,
	statSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {performDoRemote, type DoAgentRunner} from '../src/do.js';
import {performClaim} from '../src/claim-cas.js';
import {mirrorPath, encodeRepoKey} from '../src/repo-mirror.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `do --remote <r>` tests (slice `do-remote`) — the per-repo `do` WORKER run
 * against a REGISTERED repo with NO checkout (ADR §3, Option A
 * materialise-then-reuse). House style: a throwaway project + a local `--bare`
 * arbiter as the registered remote, a TEMP `workspacesDir` (the agents' area),
 * `isolatePiAgentDir` pointing pi's session storage at scratch, and a STUBBED
 * agent (injected `agentRunner` edits files directly, never a real harness).
 *
 * It materialises a hub mirror + job worktree in the temp agents' area and runs
 * the EXISTING `do` pipeline (start[resume] → agent → complete) against that
 * worktree, then reaps per the §4 predicate. It drives real git + writes `main`
 * (the autonomous needs-attention surfacing) + materialises worktrees, so it
 * lives in the non-parallel project.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-do-remote-');
	// Isolate pi's session storage to a scratch dir so any default-path launch
	// does NOT write into the developer's real ~/.pi/agent/sessions/.
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const PASS = 'exit 0';
const FAIL = 'exit 1';

/** The temp agents' execution area for a run (the worktrees + mirrors live here). */
function workspacesDir(): string {
	return join(scratch.root, 'agents-area');
}

/** The `file://` URL of a seeded `--bare` arbiter (the registered remote). */
function remoteUrl(arbiter: string): string {
	return `file://${arbiter}`;
}

/** A stubbed agent that edits a file (so the commit is non-empty) and succeeds. */
const editingAgent: DoAgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

/** Recursively snapshot every file path under `dir` (relative), for untouched-checks. */
function listAllFiles(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}
	const out: string[] = [];
	const walk = (d: string, prefix: string) => {
		for (const entry of readdirSync(d)) {
			const full = join(d, entry);
			const rel = prefix ? `${prefix}/${entry}` : entry;
			let isDir: boolean;
			try {
				isDir = statSync(full).isDirectory();
			} catch {
				continue;
			}
			if (isDir) {
				walk(full, rel);
			} else {
				out.push(rel);
			}
		}
	};
	walk(dir, '');
	return out.sort();
}

describe('do --remote — end-to-end in a job worktree (no checkout)', () => {
	it('materialises a hub mirror + job worktree in the agents area and completes', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();

		let agentCwd = '';
		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'merge',
			verify: PASS,
			agentRunner: (input) => {
				agentCwd = input.cwd;
				return editingAgent(input);
			},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('alpha');

		// The agent ran inside the AGENTS' area job worktree (under workspacesDir/
		// work/), NOT a checkout.
		expect(agentCwd.startsWith(join(ws, 'work'))).toBe(true);

		// merge mode → the work landed on the arbiter's main, in done/.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(false);

		// The agent's edit landed on the arbiter (the runner committed it).
		expect(
			gitIn(['cat-file', '-e', 'arbiter/main:agent-output.txt'], repo),
		).toBe('');

		// The hub mirror was created in the agents' area under repos/.
		const hub = mirrorPath(ws, remoteUrl(arbiter));
		expect(existsSync(hub)).toBe(true);
	});

	it('the worktree is created off the POST-CLAIM main (no double-claim, branch plain-switched)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();

		// The agent ASSERTS it runs on the work branch with the item in-progress in
		// the worktree's tree (claimed + onboarded by the runner, NOT the agent).
		const assertingAgent: DoAgentRunner = ({cwd, slug}) => {
			expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim()).toBe(
				`work/${slug}`,
			);
			expect(existsSync(join(cwd, 'work', 'in-progress', `${slug}.md`))).toBe(
				true,
			);
			writeFileSync(join(cwd, 'agent-output.txt'), 'work\n');
			return {ok: true};
		};

		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'merge',
			verify: PASS,
			agentRunner: assertingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
	});

	it('--propose pushes the work branch WITHOUT merging to main (parity with do-in-place)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();

		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'propose',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// propose → main is NOT merged (it still shows the in-progress claim; a human
		// merges the PR), but the work branch (carrying the done-move commit) IS
		// pushed to the arbiter. This is the SAME propose semantics as do-in-place.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(true);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/alpha'],
				repo,
			).trim(),
		).not.toBe('');
	});
});

describe('do --remote — auto-registers an unknown remote', () => {
	it('auto-mirrors a never-before-seen remote before use (ensureMirror)', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		const hub = mirrorPath(ws, remoteUrl(arbiter));

		// The mirror does NOT exist yet — this is the first time we touch <r>.
		expect(existsSync(hub)).toBe(false);

		let noted = '';
		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			note: (m) => {
				noted += m + '\n';
			},
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		// The mirror was auto-created under the agents' area.
		expect(existsSync(hub)).toBe(true);
		expect(noted).toMatch(/auto-registered/i);
	});
});

describe('do --remote — slug resolution parity with do-in-place', () => {
	it('a prd: arg dispatches to the slicing path, gate-bound for the agent (no worktree)', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha'], {
			prds: ['someprd'],
		});
		const ws = workspacesDir();

		let agentRan = false;
		// autoSlice OFF (default) → the agent slicing gate refuses; no worktree, no
		// agent, no build pipeline (a prd: arg never enters the slice-build worktree).
		const result = await performDoRemote({
			arg: 'prd:someprd',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			verify: PASS,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.slug).toBe('someprd');
		expect(agentRan).toBe(false);
		// No job worktree was materialised for a prd: arg.
		expect(existsSync(join(ws, 'work'))).toBe(false);
	});

	it('a lost claim race is skipped cleanly (no worktree, no agent)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		const ws = workspacesDir();
		// Another claimer wins first from a separate clone.
		const other = seeded.clone('other');
		const won = await performClaim({
			slug: 'solo',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(won.exitCode).toBe(0);

		let agentRan = false;
		const result = await performDoRemote({
			arg: 'solo',
			remote: remoteUrl(seeded.arbiter),
			workspacesDir: ws,
			verify: PASS,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});

		expect(result.exitCode).not.toBe(0);
		expect(result.outcome).toBe('lost');
		expect(agentRan).toBe(false);
	});
});

describe('do --remote — teardown re-applies the §4 predicate (reapJob)', () => {
	it('REAPS the clean+pushed job worktree after a successful completion', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();

		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');

		// The work landed on the arbiter (merged) ⇒ the worktree is provably safe ⇒
		// reaped. No job worktree dirs remain under the agents' area.
		const workDir = join(ws, 'work');
		const remaining = existsSync(workDir)
			? readdirSync(workDir).filter((e) =>
					statSync(join(workDir, e)).isDirectory(),
				)
			: [];
		expect(remaining).toEqual([]);
	});

	it('RETAINS the worktree when its work never reached the arbiter (never-lose-work)', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();

		// An agent that edits a file AND then breaks the worktree's `origin` URL
		// (simulating an OFFLINE arbiter): the agent's work is committed by the
		// done-move, but every subsequent push/fetch FAILS, so the branch never
		// reaches the arbiter. The §4 predicate then RETAINS the worktree (its tip
		// is not reachable on the arbiter) — the never-lose-work signal. (Mirrors
		// run.test.ts's broken-origin retain test.)
		const offliningAgent: DoAgentRunner = ({cwd}) => {
			writeFileSync(join(cwd, 'agent-output.txt'), 'committed work\n');
			gitIn(
				['remote', 'set-url', 'origin', 'file:///nonexistent/arbiter.git'],
				cwd,
			);
			return {ok: true};
		};

		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'merge',
			verify: PASS,
			agentRunner: offliningAgent,
			env: gitEnv(),
		});
		// The push/fetch to the (now broken) origin fails → NOT completed.
		expect(result.outcome).not.toBe('completed');

		// The worktree is RETAINED: its branch tip is not reachable on the arbiter,
		// so the §4 predicate refuses to reap (un-saved work is never discarded).
		const workDir = join(ws, 'work');
		const remaining = existsSync(workDir)
			? readdirSync(workDir).filter((e) =>
					statSync(join(workDir, e)).isDirectory(),
				)
			: [];
		expect(remaining.length).toBe(1);
	});

	it('a red gate surfaces the stuck item ON THE ARBITER main (autonomous)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();

		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'merge',
			verify: FAIL,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');
		// `do` is autonomous: the stuck state is SURFACED ON MAIN (mode-M cherry-pick
		// of the move-only commit) so scan/status/another machine can see it.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});
});

describe('do --remote — NEVER touches the human area or the real state dirs', () => {
	it('writes the human worktree area NOT at all (workspacesDir only)', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		// A human worktree area, distinct from the agents' area; it must stay empty.
		const humanArea = join(scratch.root, 'human-worktrees');
		mkdirSync(humanArea, {recursive: true});

		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');

		// The human area was NEVER written.
		expect(listAllFiles(humanArea)).toEqual([]);
	});

	it('the real ~/.agent-runner/ and ~/.pi/agent/sessions/ are UNTOUCHED', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();

		// Snapshot the real state dirs BEFORE the run (we point workspacesDir +
		// PI_CODING_AGENT_DIR at scratch, so NEITHER should change).
		const realAgentRunner = join(homedir(), '.agent-runner');
		const realPiSessions = join(homedir(), '.pi', 'agent', 'sessions');
		const before = {
			agentRunner: listAllFiles(realAgentRunner),
			piSessions: listAllFiles(realPiSessions),
		};

		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');

		// The real state dirs are byte-for-path identical (nothing leaked there).
		expect(listAllFiles(realAgentRunner)).toEqual(before.agentRunner);
		expect(listAllFiles(realPiSessions)).toEqual(before.piSessions);

		// Sanity: the run DID materialise its mirror in the SCRATCH agents' area.
		expect(existsSync(mirrorPath(ws, remoteUrl(arbiter)))).toBe(true);
		// And the key the mirror is filed under round-trips the encode helper.
		expect(encodeRepoKey(remoteUrl(arbiter))).toContain('project-work');
	});
});
