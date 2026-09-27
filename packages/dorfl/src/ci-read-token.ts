import {activePhase} from './phase.js';

/**
 * **The read token, passed per command** (spec `ci-agent-job-without-write-token`
 * §10, task `ci-split-phase-mode-and-guards`).
 *
 * The agent job checks out with `persist-credentials: false`, so no credential
 * lives in `.git/config`. dorfl's own git fetches in that job (the final rebase
 * onto `<arbiter>/main`, the kept branch, the merge action's clone) still need
 * the job's READ token on a private repository. It is handed to each child git
 * process through git's environment config (`GIT_CONFIG_COUNT` /
 * `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` setting
 * `http.<server>/.extraheader`, the header `actions/checkout` persists), so it:
 *
 *  - reaches ONLY the child git process dorfl spawns (never `.git/config`);
 *  - is removed from any agent's environment by `scrubAgentEnv` (the
 *    `GIT_CONFIG_*` block carrying an `extraheader` is dropped whole).
 *
 * The agent can still read the token from `/proc`; it only reads (accepted
 * residue, ADR `ci-agent-job-holds-no-write-token`).
 */

/**
 * The read token of the agent job: `GH_TOKEN`, else `GITHUB_TOKEN` (the same
 * precedence `gh` uses, so one step env serves both dorfl's `gh` reads and its
 * git fetches). `undefined` when neither is set or both are blank.
 */
export function resolveReadToken(env: NodeJS.ProcessEnv): string | undefined {
	for (const name of ['GH_TOKEN', 'GITHUB_TOKEN']) {
		const value = env[name]?.trim();
		if (value !== undefined && value !== '') {
			return value;
		}
	}
	return undefined;
}

/**
 * The git config key carrying the auth header for `serverUrl` (default the
 * Actions `GITHUB_SERVER_URL`, else `https://github.com`), scoped to that host
 * exactly as `actions/checkout` scopes it.
 */
export function readTokenHeaderKey(serverUrl: string): string {
	return `http.${serverUrl.replace(/\/+$/, '')}/.extraheader`;
}

/**
 * Return a COPY of `env` that makes a child git process send `token` as HTTP
 * basic auth (`x-access-token:<token>`) to `serverUrl`, appended to any existing
 * `GIT_CONFIG_COUNT` block. Idempotent: an env that already carries the header
 * key is returned unchanged. The input is never mutated.
 */
export function withReadTokenGitConfig(
	env: NodeJS.ProcessEnv,
	token: string,
	serverUrl: string = env.GITHUB_SERVER_URL ?? 'https://github.com',
): NodeJS.ProcessEnv {
	const key = readTokenHeaderKey(serverUrl);
	const parsed = Number(env.GIT_CONFIG_COUNT ?? '0');
	const count = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
	for (let i = 0; i < count; i++) {
		if (env[`GIT_CONFIG_KEY_${i}`] === key) {
			return env;
		}
	}
	const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString(
		'base64',
	);
	return {
		...env,
		GIT_CONFIG_COUNT: String(count + 1),
		[`GIT_CONFIG_KEY_${count}`]: key,
		[`GIT_CONFIG_VALUE_${count}`]: `AUTHORIZATION: basic ${basic}`,
	};
}

/**
 * The env for one child `git` process dorfl spawns: in the `agent` phase, with
 * the read token ({@link resolveReadToken}) passed per command
 * ({@link withReadTokenGitConfig}); otherwise (no phase, `lock`, `apply`, or no
 * token) `env` unchanged. Called from `git.ts`'s single spawn chokepoint, so
 * every dorfl git fetch in the agent phase carries it.
 */
export function gitChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	if (activePhase() !== 'agent') {
		return env;
	}
	const token = resolveReadToken(env);
	return token === undefined ? env : withReadTokenGitConfig(env, token);
}
