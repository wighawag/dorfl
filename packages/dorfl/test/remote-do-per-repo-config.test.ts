import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';
import {
	ensureMirror,
	ensureMirrorMain,
	readRepoConfigFromMirrorMain,
} from '../src/repo-mirror.js';
import {writeFileSync} from 'node:fs';
import {gitIn} from './helpers/gitRepo.js';
import {
	loadRepoConfigFromContent,
	resolveRepoConfigFromLoaded,
	REPO_CONFIG_FILENAME,
	type LoadedRepoConfig,
} from '../src/repo-config.js';
import {loadConfig, type Config, type PartialConfig} from '../src/config.js';
import {doFlagOverrides} from '../src/do-config.js';

/**
 * `do --remote` per-repo config tests (task
 * `remote-do-reads-per-repo-config-from-arbiter-main`). The no-checkout
 * `do --remote` path now reads the target repo's COMMITTED `dorfl.json`
 * from `<arbiter>/main` (via the hub mirror) and layers ONLY the whitelisted
 * `REPO_ALLOWED_KEYS` into resolution — restoring `flag > env > per-repo >
 * global > default` parity with in-place `do`.
 *
 * House style: a throwaway project + a local `--bare` arbiter whose `main`
 * carries a `dorfl.json` (with BOTH allowed + rejected keys), a temp
 * `workspacesDir` (the agents' area), `isolatePiAgentDir`, and real shared dirs
 * untouched. These tests exercise the SAME machinery the CLI's
 * `resolveRemoteRepoConfig` composes: source the bytes from the arbiter main
 * (`readRepoConfigFromMirrorMain`), filter via the existing per-repo split
 * (`loadRepoConfigFromContent`), then layer (`resolveRepoConfigFromLoaded`).
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-remote-repo-config-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

function workspacesDir(): string {
	return join(scratch.root, 'agents-area');
}

function remoteUrl(arbiter: string): string {
	return `file://${arbiter}`;
}

describe('do --remote — reads the per-repo dorfl.json from the arbiter main', () => {
	/** Source + filter + layer, exactly as the CLI composes it (no global file). */
	function resolve(opts: {
		arbiter: string;
		flags?: PartialConfig;
		env?: NodeJS.ProcessEnv;
	}): LoadedRepoConfig & {config: Config} {
		const ws = workspacesDir();
		const env = gitEnv();
		// Mirror the PRODUCTION build-path config read (`resolveRemoteRepoConfig`):
		// a main-only, no-prune ensure so a checked-out `work/<slug>` worktree branch
		// can never block it.
		const mirror = ensureMirrorMain({
			url: remoteUrl(opts.arbiter),
			workspacesDir: ws,
			env,
		});
		const content = readRepoConfigFromMirrorMain(mirror.path, env);
		const loaded: LoadedRepoConfig =
			content === undefined
				? {path: `${opts.arbiter}#main`, config: {}, rejected: []}
				: loadRepoConfigFromContent(content, `${opts.arbiter}#main`);
		// A bare "global" with nothing configured (no harness, no verify) — the
		// pre-task baseline the per-repo layer must override.
		const global = loadConfig(join(scratch.root, 'no-such-config.json'));
		const resolved = resolveRepoConfigFromLoaded(loaded, {
			global,
			flags: opts.flags ?? {},
			env: opts.env,
		});
		return {...loaded, config: resolved.config};
	}

	it('the repo-declared harness takes effect (no flag, no global) — "no agentCmd" no longer fires', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha'], {
			repoConfig: {harness: 'pi'},
		});
		const {config} = resolve({arbiter});
		// The committed `harness: pi` is honoured — the pi adapter needs no agentCmd,
		// so `doNeedsAgentCmd` (harness !== 'pi' && agentCmd === '') is false.
		expect(config.harness).toBe('pi');
		expect(config.harness !== 'pi' && config.agentCmd.trim() === '').toBe(
			false,
		);
	});

	it('the repo-declared verify gate takes effect (and there is no default to fall back to)', () => {
		const gate = 'pnpm format:check && pnpm build && pnpm test';
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha'], {
			repoConfig: {verify: gate},
		});
		const {config} = resolve({arbiter});
		expect(config.verify).toBe(gate);
	});

	it('host-only keys in the committed file are IGNORED + reported (reused REPO_REJECTED_KEYS)', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha'], {
			repoConfig: {
				harness: 'pi', // allowed → applied
				agentCmd: '/evil/bin', // host-only → rejected
				piBin: '/evil/pi', // host-only → rejected
				sessionsDir: '/evil/sessions', // host-only → rejected
				identity: 'bot', // host-only → rejected
			},
		});
		const {config, rejected, message} = resolve({arbiter});
		// The allowed key applied…
		expect(config.harness).toBe('pi');
		// …the host-only keys did NOT (agentCmd stays the empty default).
		expect(config.agentCmd).toBe('');
		// …and they were reported as rejected (every one named).
		expect(rejected.sort()).toEqual(
			['agentCmd', 'identity', 'piBin', 'sessionsDir'].sort(),
		);
		expect(message).toMatch(/runner\/host-only key/i);
		for (const key of ['agentCmd', 'piBin', 'sessionsDir', 'identity']) {
			expect(message).toContain(key);
		}
	});

	it('a flag OVERRIDES the per-repo file (flag > per-repo)', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha'], {
			repoConfig: {harness: 'pi', model: 'repo-model'},
		});
		// `--harness null --model flag-model --agent-cmd …` via the same flag-override
		// path `do` uses (doFlagOverrides → harnessFlagOverrides).
		const flags = doFlagOverrides(
			{harness: 'null', model: 'flag-model', agentCmd: '/bin/agent'},
			'merge',
		);
		const {config} = resolve({arbiter, flags});
		expect(config.harness).toBe('null');
		expect(config.model).toBe('flag-model');
	});

	it('an DORFL_* env var OVERRIDES the per-repo file (env > per-repo)', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha'], {
			repoConfig: {harness: 'pi', model: 'repo-model'},
		});
		const {config} = resolve({
			arbiter,
			env: {DORFL_MODEL: 'env-model'},
		});
		// env beats the per-repo file; the per-repo `harness` (no env for it) holds.
		expect(config.model).toBe('env-model');
		expect(config.harness).toBe('pi');
	});

	it('resolves the per-repo config even when a stale work/<other> worktree is checked out in the mirror (defect #1 regression)', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha'], {
			repoConfig: {harness: 'pi', verify: 'echo gate'},
		});
		const repo = join(scratch.root, 'project');
		const env = gitEnv();

		// A DIFFERENT task's `work/other` branch on the arbiter, checked out in a
		// stale (un-reaped) job worktree on the mirror — the exact poisoning shape.
		gitIn(['switch', '-q', '-c', 'work/other', 'main'], repo);
		writeFileSync(join(repo, 'OTHER.md'), '# other\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'other'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/other'], repo);
		gitIn(['switch', '-q', 'main'], repo);

		const all = ensureMirror({
			url: remoteUrl(arbiter),
			workspacesDir: workspacesDir(),
			env,
		});
		const stale = join(scratch.root, 'stale-wt');
		gitIn(['worktree', 'add', stale, 'work/other'], all.path);
		// Advance `work/other` so a subsequent all-heads fetch WOULD refuse.
		gitIn(['switch', '-q', 'work/other'], repo);
		writeFileSync(join(repo, 'OTHER.md'), '# other v2\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'other v2'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/other'], repo);
		gitIn(['switch', '-q', 'main'], repo);

		// The build-path resolve (via the narrowed `ensureMirrorMain`) succeeds and
		// honours the per-repo config instead of failing into global+default.
		const {config} = resolve({arbiter});
		expect(config.harness).toBe('pi');
		expect(config.verify).toBe('echo gate');
	});

	it('a config-less repo resolves to global+default (byte-identical to today)', () => {
		// No `repoConfig` → no `dorfl.json` committed on main.
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const resolved = resolve({arbiter});
		// Nothing layered: rejected empty, no message, and the resolved config is
		// exactly the global+default (harness unset, verify unset).
		expect(resolved.rejected).toEqual([]);
		expect(resolved.message).toBeUndefined();
		expect(resolved.config.harness).toBeUndefined();
		expect(resolved.config.verify).toBeUndefined();
		const baseline = loadConfig(join(scratch.root, 'no-such-config.json'));
		expect(resolved.config).toEqual(baseline);
	});
});

describe('readRepoConfigFromMirrorMain — sources the committed bytes from <arbiter>/main', () => {
	it('returns the file content when committed on main', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha'], {
			repoConfig: {harness: 'pi', verify: 'echo ok'},
		});
		const env = gitEnv();
		const mirror = ensureMirror({
			url: remoteUrl(arbiter),
			workspacesDir: workspacesDir(),
			env,
		});
		const content = readRepoConfigFromMirrorMain(mirror.path, env);
		expect(content).toBeDefined();
		const parsed = JSON.parse(content as string) as Record<string, unknown>;
		expect(parsed.harness).toBe('pi');
		expect(parsed.verify).toBe('echo ok');
	});

	it('returns undefined when the repo has NO dorfl.json on main', () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const env = gitEnv();
		const mirror = ensureMirror({
			url: remoteUrl(arbiter),
			workspacesDir: workspacesDir(),
			env,
		});
		expect(readRepoConfigFromMirrorMain(mirror.path, env)).toBeUndefined();
	});

	it('the sourced filename matches the brand REPO_CONFIG_FILENAME', () => {
		// Guard against drift: the read PREFERS `main:<REPO_CONFIG_FILENAME>`
		// (`dorfl.json`) and falls back to the legacy `.dorfl.json`; the test fixture
		// writes the preferred name.
		expect(REPO_CONFIG_FILENAME).toBe('dorfl.json');
	});
});
