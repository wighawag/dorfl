import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	chmodSync,
} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {PiHarness} from '../src/pi-harness.js';
import {NullHarness} from '../src/harness.js';
import type {InteractiveLaunchSite} from '../src/harness.js';
import {generateSessionPath} from '../src/session-path.js';
import {performStart} from '../src/start.js';
import {performWorkOn} from '../src/work-on.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-interactive-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/**
 * An executable pi STUB for the INTERACTIVE path. Unlike the autonomous stub it
 * does NOT `cat` stdin (an interactive launch inherits stdio and feeds NO piped
 * prompt — reading stdin would block). It records the args + cwd, then exits.
 */
function writeInteractivePiStub(opts: {exitCode?: number} = {}): {
	bin: string;
	argsFile: string;
	cwdFile: string;
} {
	const bin = join(scratch.root, 'pi-interactive-stub.sh');
	const argsFile = join(scratch.root, 'pi-args.txt');
	const cwdFile = join(scratch.root, 'pi-cwd.txt');
	const exit = opts.exitCode ?? 0;
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
		`pwd > ${JSON.stringify(cwdFile)}`,
		// NO `cat` of stdin — an interactive launch has no piped prompt; reading
		// would hang. Create the --session file (real pi creates+writes it).
		'session_file=""',
		'prev=""',
		'for a in "$@"; do',
		'  if [ "$prev" = "--session" ]; then session_file="$a"; fi',
		'  prev="$a"',
		'done',
		'if [ -n "$session_file" ]; then mkdir -p "$(dirname "$session_file")"; : > "$session_file"; fi',
		`exit ${exit}`,
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile, cwdFile};
}

function recordedArgs(argsFile: string): string[] {
	return readFileSync(argsFile, 'utf8').split('\n');
}

describe('Harness.launchInteractive — null adapter (pi-only)', () => {
	it('throws a CLEAR pi-only error (decision #2)', () => {
		const harness = new NullHarness();
		expect(() =>
			harness.launchInteractive({dir: scratch.root, slug: 'feat'}),
		).toThrow(/interactive launch requires the pi harness/i);
		expect(() =>
			harness.launchInteractive({dir: scratch.root, slug: 'feat'}),
		).toThrow(/harness: pi/);
	});
});

describe('PiHarness.launchInteractive — interactive pi invocation (stubbed)', () => {
	it('runs pi WITHOUT --print, with --session <abs .jsonl>, in input.dir (no prepared prompt)', () => {
		const stub = writeInteractivePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		const session = generateSessionPath({cwd: dir, id: 'feat'});
		const result = harness.launchInteractive({dir, slug: 'feat', session});

		const args = recordedArgs(stub.argsFile);
		// INTERACTIVE = NO `--print` (a real foreground session, not captured).
		expect(args).not.toContain('--print');
		// STILL records the human session via `--session <full path>` (decision #2).
		expect(args).toContain('--session');
		const i = args.indexOf('--session');
		const sessionArg = args[i + 1];
		expect(sessionArg).toBe(session);
		expect(isAbsolute(sessionArg)).toBe(true);
		expect(sessionArg.endsWith('.jsonl')).toBe(true);
		// Ran in the onboarded working tree (foreground session starts there).
		expect(readFileSync(stub.cwdFile, 'utf8').trim()).toBe(dir);
		// Returns only an exit code (NOT a tracked job — decision #3).
		expect(result.exitCode).toBe(0);
	});

	it('passes the resolved model NATIVELY as --model (decision #4)', () => {
		const stub = writeInteractivePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		harness.launchInteractive({
			dir,
			slug: 'feat',
			model: 'anthropic/claude-sonnet-4',
		});

		const args = recordedArgs(stub.argsFile);
		const mi = args.indexOf('--model');
		expect(mi).toBeGreaterThanOrEqual(0);
		expect(args[mi + 1]).toBe('anthropic/claude-sonnet-4');
		// No model ⇒ no --model arg at all (offered, never forced).
		const stub2 = writeInteractivePiStub();
		new PiHarness({piBin: stub2.bin}).launchInteractive({dir, slug: 'feat'});
		expect(recordedArgs(stub2.argsFile)).not.toContain('--model');
	});

	it('generates a default session path under the isolated agent dir when none is passed', () => {
		const stub = writeInteractivePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		harness.launchInteractive({dir, slug: 'feat'});

		const args = recordedArgs(stub.argsFile);
		const sessionArg = args[args.indexOf('--session') + 1];
		expect(isAbsolute(sessionArg)).toBe(true);
		expect(sessionArg.endsWith('.jsonl')).toBe(true);
		// Lands under the scratch-isolated agent dir, never the real ~/.pi.
		expect(sessionArg.startsWith(scratch.root)).toBe(true);
	});

	it('surfaces a non-zero pi exit as the returned exit code', () => {
		const stub = writeInteractivePiStub({exitCode: 7});
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		const result = harness.launchInteractive({dir, slug: 'feat'});
		expect(result.exitCode).toBe(7);
	});
});

describe('start --agent — interactive launch after onboarding', () => {
	it('invokes the interactive launcher with the checkout cwd after a winning claim', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const sites: InteractiveLaunchSite[] = [];

		const result = await performStart({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
			launchInteractive: (site) => sites.push(site),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('started');
		// The INTERACTIVE seam fired once, in the onboarded checkout (NOT the
		// captured autonomous launch).
		expect(sites).toHaveLength(1);
		expect(sites[0].dir).toBe(repo);
		expect(sites[0].slug).toBe('alpha');
		// It is NOT a tracked job (decision #3): no .dorfl-job.json written
		// in the checkout.
		expect(existsSync(join(repo, '.dorfl-job.json'))).toBe(false);
	});

	it('does NOT launch when start refuses (in-progress without --resume)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Claim it from another clone so the item is in-progress.
		const other = seeded.clone('other');
		await performStart({
			slug: 'alpha',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const sites: InteractiveLaunchSite[] = [];
		const result = await performStart({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
			launchInteractive: (site) => sites.push(site),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		// A failed/refused onboard NEVER launches the agent.
		expect(sites).toHaveLength(0);
	});

	it('launches on --resume (re-engaging an in-progress item)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Claim it in THIS checkout so it is in-progress, owned here.
		await performStart({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		// Switch off the work branch to simulate coming back later.
		gitIn(['checkout', '-q', 'main'], repo);

		const sites: InteractiveLaunchSite[] = [];
		const result = await performStart({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
			resume: true,
			launchInteractive: (site) => sites.push(site),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('resumed');
		expect(sites).toHaveLength(1);
		expect(sites[0].dir).toBe(repo);
	});
});

describe('work-on --agent — interactive launch in the new worktree', () => {
	it('invokes the interactive launcher with the worktree dir after creation', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['beta']);
		const sites: InteractiveLaunchSite[] = [];

		const result = await performWorkOn({
			slug: 'beta',
			cwd: repo,
			arbiter: 'arbiter',
			workspacesDir: join(scratch.root, '.dorfl'),
			humanWorktreesDir: join(scratch.root, 'worktrees'),
			env: gitEnv(),
			launchInteractive: (site) => sites.push(site),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('created');
		// The interactive seam fired in the freshly-created WORKTREE (not the repo).
		expect(sites).toHaveLength(1);
		expect(sites[0].dir).toBe(result.dir);
		expect(sites[0].slug).toBe('beta');
		// NOT a tracked job: no job record in the worktree (decision #3).
		expect(existsSync(join(result.dir!, '.dorfl-job.json'))).toBe(false);
	});

	it('does NOT launch when the claim is lost (no worktree)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		// Another claimer wins first.
		const other = seeded.clone('other');
		await performWorkOn({
			slug: 'beta',
			cwd: other,
			arbiter: 'arbiter',
			workspacesDir: join(scratch.root, '.dorfl-other'),
			humanWorktreesDir: join(scratch.root, 'worktrees-other'),
			env: gitEnv(),
		});

		const sites: InteractiveLaunchSite[] = [];
		const result = await performWorkOn({
			slug: 'beta',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			workspacesDir: join(scratch.root, '.dorfl'),
			humanWorktreesDir: join(scratch.root, 'worktrees'),
			env: gitEnv(),
			launchInteractive: (site) => sites.push(site),
		});

		expect(result.exitCode).not.toBe(0);
		expect(sites).toHaveLength(0);
	});

	it('the real ~/.dorfl + ~/.pi/agent/sessions are untouched (isolation)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['gamma']);
		const stub = writeInteractivePiStub();
		const harness = new PiHarness({piBin: stub.bin});

		const result = await performWorkOn({
			slug: 'gamma',
			cwd: repo,
			arbiter: 'arbiter',
			workspacesDir: join(scratch.root, '.dorfl'),
			humanWorktreesDir: join(scratch.root, 'worktrees'),
			env: gitEnv(),
			// Wire a REAL pi (stub) interactive launch via the resolved seam, with a
			// session path under the isolated scratch agent dir.
			launchInteractive: (site) => {
				const session = generateSessionPath({cwd: site.dir, id: site.slug});
				harness.launchInteractive({slug: site.slug, dir: site.dir, session});
			},
		});

		expect(result.exitCode).toBe(0);
		// pi ran in the worktree, and its session landed under the scratch agent
		// dir (isolatePiAgentDir), never the developer's real ~/.pi.
		const args = recordedArgs(stub.argsFile);
		const sessionArg = args[args.indexOf('--session') + 1];
		expect(sessionArg.startsWith(scratch.root)).toBe(true);
		expect(existsSync(sessionArg)).toBe(true);
		// The claim landed (the onboard happened before the launch); claim writes
		// nothing to main, so the body rests in backlog/.
		expect(existsOnArbiterMain(repo, 'backlog', 'gamma')).toBe(true);
	});
});
