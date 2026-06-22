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
	stuckLockOnArbiter,
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

		// The agent ASSERTS it runs on the work branch with the body RESTING in
		// backlog/ in the worktree's tree (claimed via the lock + onboarded by the
		// runner, NOT the agent; claim no longer moves the body).
		const assertingAgent: DoAgentRunner = ({cwd, slug}) => {
			expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim()).toBe(
				`work/task-${slug}`,
			);
			expect(existsSync(join(cwd, 'work', 'tasks', 'todo', `${slug}.md`))).toBe(
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
		// propose → main is NOT merged (the body still rests in backlog/; a human
		// merges the PR), but the work branch (carrying the done-move commit) IS
		// pushed to the arbiter. This is the SAME propose semantics as do-in-place.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/task-alpha'],
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

describe('do --remote — a deliberate STOP routes to needs-attention (shared runRemotePipeline)', () => {
	it('a sentinel STOP → agent-stopped, surfaced on the arbiter, NO gate', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'merge',
			// A gate that would EXPLODE if run — proves it is SKIPPED on a STOP.
			verify: 'echo GATE-RAN >&2; exit 1',
			agentRunner: () => ({
				ok: true,
				output: [
					'=== TASK-STOP ===',
					'drifted: this task depends on a flag that was removed.',
					'=== END TASK-STOP ===',
				].join('\n'),
			}),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-stopped');
		expect(result.routedToNeedsAttention).toBe(true);
		expect(result.message).toMatch(/a flag that was removed/);
		// Surfaced on the arbiter main; never reached done.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});

	it('the empty-diff backstop fires in the remote worktree too', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		const result = await performDoRemote({
			arg: 'alpha',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'merge',
			verify: PASS,
			agentRunner: () => ({ok: true, output: 'changed nothing'}),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('agent-stopped');
		expect(result.message).toMatch(/no source change|empty diff|no-op/i);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});
});

describe('do --remote — slug resolution parity with do-in-place', () => {
	it('a prd: arg dispatches to the slicing path; an EXPLICITLY-named PRD slices with autoTask OFF (no worktree)', async () => {
		// Slug-resolution parity + the build/slice symmetry (slice
		// `explicit-do-prd-not-gated-by-autoslice`): `do --remote prd:<slug>` is an
		// EXPLICIT target, so it slices REGARDLESS of the repo's `autoTask` POLICY
		// (autoTask OFF / default), exactly as `do <slice>` builds regardless of
		// `autoBuild`. The agent RUNS (the policy no longer gate-refuses the explicit
		// form); no job worktree is cut for a prd: arg (slicing is not a build pipeline).
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha'], {
			prds: ['someprd'],
		});
		const ws = workspacesDir();

		let agentRan = false;
		const result = await performDoRemote({
			arg: 'brief:someprd',
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			// autoTask deliberately OMITTED (defaults off) — explicit naming authorizes.
			integration: 'merge',
			agentRunner: ({cwd}) => {
				agentRan = true;
				const dir = join(cwd, 'work', 'tasks', 'todo');
				mkdirSync(dir, {recursive: true});
				writeFileSync(
					join(dir, 'someprd-explicit.md'),
					'---\nslug: someprd-explicit\nprd: someprd\n---\n\n## Prompt\n\n> x\n',
				);
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.slug).toBe('someprd');
		// The agent ran (the gate did NOT refuse on the policy).
		expect(agentRan).toBe(true);
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
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
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

/**
 * The autonomous-path PR-INTENT pre-flight guard (slice
 * `propose-pr-intent-guard-on-autonomous-paths`): the SAME up-front `gh` probe +
 * `shouldFailProposePrIntent` the in-place `performDo` step 3c runs, now on the
 * no-checkout `do --remote` path — BEFORE the claim/build, so a `propose` run on a
 * GitHub arbiter that INTENDS a PR fails fast when `gh` is genuinely unauthed
 * instead of silently degrading to manual-PR instructions at integration.
 *
 * A GitHub arbiter URL would need the network to clone, so we PRE-CREATE the hub
 * mirror at the github-keyed path by bare-cloning the LOCAL arbiter into it (its
 * `origin` points at the local arbiter, so `ensureMirror`'s reuse-fetch stays
 * offline) while `mirror.url` reads as `github.com` — the exact split the guard
 * keys on (`isGitHubArbiterUrl(mirror.url)`), with no real `gh` ever invoked
 * (the probe is injected).
 */
describe('do --remote — PR-INTENT pre-flight guard (autonomous path)', () => {
	const GH_URL = 'https://github.com/o/r.git';

	/** Pre-seed the github-keyed hub mirror from the LOCAL arbiter (offline). */
	function seedGithubMirror(ws: string, arbiter: string): void {
		const hub = mirrorPath(ws, GH_URL);
		mkdirSync(join(ws, 'repos'), {recursive: true});
		gitIn(
			['clone', '--quiet', '--bare', `file://${arbiter}`, hub],
			scratch.root,
		);
	}

	it('EARLY VISIBLE FAILURE: propose + GitHub arbiter + noPR unset + a failing gh PROBE ⇒ refuses UP FRONT, no claim/build', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		seedGithubMirror(ws, arbiter);

		let agentRan = false;
		const result = await performDoRemote({
			arg: 'alpha',
			remote: GH_URL,
			workspacesDir: ws,
			integration: 'propose',
			// noPR unset (a PR is intended); the probe says `gh` cannot open one.
			ghCanOpenPr: () => false,
			verify: PASS,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/gh auth login/);
		expect(result.message).toMatch(/--no-pr/);
		expect(result.message).toMatch(/--merge/);
		// NO build work ran: the agent never launched, and the item is NOT claimed
		// (still in backlog on the arbiter, never moved to in-progress).
		expect(agentRan).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
	});

	it('AMBIENT AUTH NOT BROKEN: propose + GitHub arbiter + noPR unset + a PASSING probe ⇒ the guard does NOT refuse (the run gets PAST it)', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		seedGithubMirror(ws, arbiter);

		let probed = false;
		// A PASSING probe (the common ambient-`gh` case, no `providers.github`
		// identity) ⇒ the guard does NOT refuse and the run proceeds PAST it into the
		// build. We do not (and cannot) complete a real github.com build offline, so
		// proceeding-past-the-guard is proven by the run getting as far as the real
		// claim CLONE of the github URL (which then fails offline) — NOT by an early
		// PR-intent refusal. The KEY assertion is that the probe WAS consulted and the
		// failure is the offline clone, never the up-front guard.
		await expect(
			performDoRemote({
				arg: 'alpha',
				remote: GH_URL,
				workspacesDir: ws,
				integration: 'propose',
				ghCanOpenPr: () => {
					probed = true;
					return true;
				},
				verify: PASS,
				agentRunner: editingAgent,
				env: gitEnv(),
			}),
		).rejects.toThrow(/github\.com/);
		// The probe ran (the guard consulted it) and let the run THROUGH (it reached
		// the real clone). Ambient auth is honoured.
		expect(probed).toBe(true);
	});

	it('MERGE mode ⇒ the guard never fires (no PR is ever opened), even with a failing probe', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		seedGithubMirror(ws, arbiter);

		let probed = false;
		// merge never opens a PR, so the predicate short-circuits BEFORE the probe.
		// The run is NOT refused — it proceeds PAST the guard (proven by reaching the
		// real offline github clone), and the probe is never even consulted.
		await expect(
			performDoRemote({
				arg: 'alpha',
				remote: GH_URL,
				workspacesDir: ws,
				integration: 'merge',
				ghCanOpenPr: () => {
					probed = true;
					return false;
				},
				verify: PASS,
				agentRunner: editingAgent,
				env: gitEnv(),
			}),
		).rejects.toThrow(/github\.com/);
		expect(probed).toBe(false);
	});

	it('noPR: true ⇒ the guard never fires (a PR was deliberately suppressed), even with a failing probe', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		seedGithubMirror(ws, arbiter);

		let probed = false;
		// `noPR: true` short-circuits the predicate BEFORE the probe: no refusal. The
		// run proceeds PAST the guard (proven by reaching the offline github clone),
		// and the probe is never consulted.
		await expect(
			performDoRemote({
				arg: 'alpha',
				remote: GH_URL,
				workspacesDir: ws,
				integration: 'propose',
				noPR: true,
				ghCanOpenPr: () => {
					probed = true;
					return false;
				},
				verify: PASS,
				agentRunner: editingAgent,
				env: gitEnv(),
			}),
		).rejects.toThrow(/github\.com/);
		expect(probed).toBe(false);
	});

	it('a NON-GitHub (file://) arbiter ⇒ the guard never fires, even with a failing probe', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();

		let probed = false;
		const result = await performDoRemote({
			arg: 'alpha',
			// The local file:// arbiter reads as non-GitHub ⇒ no PR is ever possible.
			remote: remoteUrl(arbiter),
			workspacesDir: ws,
			integration: 'propose',
			ghCanOpenPr: () => {
				probed = true;
				return false;
			},
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		// A non-GitHub arbiter short-circuits the predicate BEFORE the probe: the
		// propose run proceeds (pushes the work branch, no refusal). The body stays in
		// backlog/ on main (claim wrote nothing there).
		expect(probed).toBe(false);
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
	});
});
