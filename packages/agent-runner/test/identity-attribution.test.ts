import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {runOnce, type AgentRunner} from '../src/run.js';
import {performDo} from '../src/do.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import {git} from '../src/git.js';
import type {Identity} from '../src/identity.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * The IDENTITY ATTRIBUTION test (design §6): prove the configured `identity`
 * actually WINS over the ambient git config on a real `run` integration — i.e. the
 * done-commit on the arbiter is authored by the BOT, not the ambient identity.
 * This catches the silent-fallback failure mode (a malformed override that lets
 * git quietly fall back to the user's identity while the push still succeeds).
 *
 * We assert the COMMIT-LABEL axis (name/email via `GIT_CONFIG_PARAMETERS`), the
 * one axis testable without real SSH keys / a network. The base env deliberately
 * OMITS `GIT_AUTHOR_*`/`GIT_COMMITTER_*` (those would beat
 * `GIT_CONFIG_PARAMETERS` — a real-world caveat) and nulls the global/system
 * config, so the ONLY thing that can set the author is the identity's env.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-identity-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const editingAgent: AgentRunner = ({cwd, slug}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), `work done for ${slug}\n`);
	return {ok: true};
};

/**
 * A HOSTILE ambient env: it sets a DECOY human `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
 * identity (and nulls the global/system config). Crucially, `GIT_AUTHOR_*`/
 * `GIT_COMMITTER_*` take PRECEDENCE over `user.name`/`user.email` — so this is the
 * adversarial case: if `identityEnv` only set `GIT_CONFIG_PARAMETERS`, the decoy
 * human would silently win. The tests assert the BOT wins anyway, proving the
 * feature defeats the silent-fallback failure mode in a realistic environment
 * (CI/tooling that sets these vars), not just an artificially-clean one.
 */
function hostileAmbientEnv(): NodeJS.ProcessEnv {
	const env = {...process.env};
	// STRIP any identity-bearing vars the developer's/CI's real shell may carry
	// (e.g. a real `GH_TOKEN` from `gh auth`, or a configured runner identity).
	// Without this the baseline is not actually "ambient with no identity": an
	// inherited GH_TOKEN would make the "agent stays ambient" assertions assert
	// against a polluted baseline. The test must OWN its baseline, not inherit it.
	for (const k of [
		'GH_TOKEN',
		'GITHUB_TOKEN',
		'GIT_CONFIG_PARAMETERS',
		'GIT_SSH_COMMAND',
		'GIT_AUTHOR_NAME',
		'GIT_AUTHOR_EMAIL',
		'GIT_COMMITTER_NAME',
		'GIT_COMMITTER_EMAIL',
	]) {
		delete env[k];
	}
	return {
		...env,
		// Re-add the DECOY human author/committer (the adversarial case): the bot
		// identity must still win over these.
		GIT_AUTHOR_NAME: 'Ambient Human',
		GIT_AUTHOR_EMAIL: 'human@corp.test',
		GIT_COMMITTER_NAME: 'Ambient Human',
		GIT_COMMITTER_EMAIL: 'human@corp.test',
		GIT_TERMINAL_PROMPT: '0',
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_CONFIG_SYSTEM: '/dev/null',
		GIT_CONFIG_NOSYSTEM: '1',
	};
}

/** A neutral env for READING the arbiter (no identity overrides needed). */
function readEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_CONFIG_SYSTEM: '/dev/null',
		GIT_CONFIG_NOSYSTEM: '1',
	};
}

/** Read author + committer `Name <email>` of `<arbiter>/main`'s tip commit. */
function arbiterMainAuthor(repo: string): string {
	git(['fetch', '-q', 'arbiter'], repo, {env: readEnv()});
	return git(
		[
			'log',
			'-1',
			'--format=author=%an <%ae> committer=%cn <%ce>',
			'arbiter/main',
		],
		repo,
		{env: readEnv()},
	).trim();
}

describe('identity attribution (end-to-end through run → merge)', () => {
	it('authors the integrated commit as the configured bot, not the ambient user', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const identity: Identity = {
			name: 'Automation Bot',
			email: 'bot@agents.alt',
			// Ambient ssh/https — the local-path arbiter is `local` transport, so the
			// transport guard is a no-op; we are exercising the commit-LABEL axis.
			auth: {ssh: 'ambient', https: 'ambient'},
		};
		const config = mergeConfig({
			defaultArbiter: 'arbiter',
			integration: 'merge',
			agentCmd: 'true',
			verify: 'exit 0',
			allowAgents: true,
			identity,
		});

		const result = await runOnce({
			config,
			report: scanRepoPaths([join(scratch.root, 'project')], config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			// The ambient env carries NO author identity — only the configured
			// identity can set the commit author.
			env: hostileAmbientEnv(),
			agentId: () => 'agentA',
		});

		expect(result.items[0].status).toBe('claimed-done');
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);
		// The decisive assertion: the merged done-commit is the BOT's, proving the
		// identity override won over the (absent) ambient identity.
		expect(arbiterMainAuthor(repo)).toBe(
			'author=Automation Bot <bot@agents.alt> committer=Automation Bot <bot@agents.alt>',
		);
	});

	it('does NOT inject the identity env into the agent launch (runner acts, not the agent)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const identity: Identity = {
			name: 'Automation Bot',
			email: 'bot@agents.alt',
			auth: {ssh: 'ambient', https: 'ambient'},
			providers: {github: {token: 'ghp_secret_should_not_leak'}},
		};
		const config = mergeConfig({
			defaultArbiter: 'arbiter',
			integration: 'merge',
			agentCmd: 'true',
			verify: 'exit 0',
			allowAgents: true,
			identity,
		});

		let agentEnv: NodeJS.ProcessEnv | undefined;
		const capturingAgent: AgentRunner = ({cwd, slug, env}) => {
			agentEnv = env;
			writeFileSync(join(cwd, 'agent-output.txt'), `work done for ${slug}\n`);
			return {ok: true};
		};

		await runOnce({
			config,
			report: scanRepoPaths([join(scratch.root, 'project')], config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: capturingAgent,
			env: hostileAmbientEnv(),
			agentId: () => 'agentA',
		});

		// The agent ran with the plain AMBIENT env: no provider token leaked into the
		// agent's environment, and no identity commit-label override. The runner
		// (not the agent) is the one that acts as the identity (design point 4).
		expect(agentEnv?.GH_TOKEN).toBeUndefined();
		expect(agentEnv?.GIT_CONFIG_PARAMETERS).toBeUndefined();
		// But the integration STILL attributed to the bot (the runner's git op did
		// get the identity).
		expect(arbiterMainAuthor(repo)).toBe(
			'author=Automation Bot <bot@agents.alt> committer=Automation Bot <bot@agents.alt>',
		);
	});
});

describe('identity attribution (end-to-end through do → merge)', () => {
	it('authors the in-place do commit as the bot, with the agent left ambient', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const identity: Identity = {
			name: 'Automation Bot',
			email: 'bot@agents.alt',
			auth: {ssh: 'ambient', https: 'ambient'},
			providers: {github: {token: 'ghp_secret_should_not_leak'}},
		};

		let agentEnv: NodeJS.ProcessEnv | undefined;
		const capturingAgent: AgentRunner = ({cwd, slug, env}) => {
			agentEnv = env;
			writeFileSync(join(cwd, 'agent-output.txt'), `work done for ${slug}\n`);
			return {ok: true};
		};

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			integration: 'merge',
			verify: 'exit 0',
			agentRunner: capturingAgent,
			identity,
			env: hostileAmbientEnv(),
		});

		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		// The runner's commit is the bot's …
		expect(arbiterMainAuthor(repo)).toBe(
			'author=Automation Bot <bot@agents.alt> committer=Automation Bot <bot@agents.alt>',
		);
		// … but the AGENT ran ambient (no leaked token, no identity commit-label).
		expect(agentEnv?.GH_TOKEN).toBeUndefined();
		expect(agentEnv?.GIT_CONFIG_PARAMETERS).toBeUndefined();
	});

	it('fails cleanly (no crash, no ambient fallback) when tokenEnv names an unset var', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const identity: Identity = {
			auth: {ssh: 'ambient', https: 'ambient'},
			// Points at an env var that is NOT set in the run env below.
			providers: {github: {tokenEnv: 'DEFINITELY_UNSET_BOT_TOKEN'}},
		};
		let agentRan = false;
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			integration: 'merge',
			verify: 'exit 0',
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			identity,
			env: hostileAmbientEnv(),
		});
		// A clean usage error naming the offending var — NOT a thrown crash, and the
		// agent never ran (we refuse BEFORE claiming/onboarding).
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/DEFINITELY_UNSET_BOT_TOKEN/);
		expect(agentRan).toBe(false);
		// Nothing was integrated (no silent fallback push).
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});
});
