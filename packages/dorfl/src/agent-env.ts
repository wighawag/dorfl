/**
 * **No GitHub token in a CI agent's environment.**
 *
 * In CI, dorfl runs an agent (with shell) over text any GitHub user can write:
 * an issue body, a comment. Whatever the agent's environment holds, a prompt
 * injection in that text can ask it to print. So every autonomous agent launch
 * in GitHub Actions gets its environment with the GitHub credentials removed
 * ({@link scrubAgentEnv}), whatever the workflow put in the step environment.
 *
 * This is only the cheap layer. It does not stop an agent from reading the
 * token another way while it shares a job with one (its parent processes'
 * environment, `.git/config` when the checkout persists a credential, `sudo` on
 * a hosted runner). The real boundary is running the agent in a job whose
 * token cannot write, see spec `ci-agent-job-without-write-token` (under
 * `work/specs/`).
 *
 * On a laptop nothing is removed: it is the human's own machine, and a local
 * tool the agent uses (an MCP server, a `gh` call) may legitimately need the
 * human's token.
 */

/**
 * Names that carry a GitHub credential by convention (case-insensitive):
 * `GH_TOKEN`, `GITHUB_TOKEN`, any `GH_*_TOKEN` / `GITHUB_*_TOKEN` (e.g.
 * `GH_ENTERPRISE_TOKEN`), and the dorfl-specific `DORFL_GH_TOKEN`,
 * `DORFL_GIT_TOKEN`, `DORFL_GITHUB_TOKEN` with any infix
 * (`DORFL_*_GH_TOKEN` / `DORFL_*_GIT_TOKEN` / `DORFL_*_GITHUB_TOKEN`).
 */
const GITHUB_TOKEN_NAME =
	/^(?:(?:GH|GITHUB)_(?:\w+_)?TOKEN|DORFL_(?:\w+_)?(?:GH|GIT|GITHUB)_TOKEN)$/i;

/**
 * The GitHub Actions runtime credentials a step can see: the OIDC request pair
 * (it mints an ID token, which a cloud role may trust for writes) and the
 * runtime token (artifact/cache service).
 */
const ACTIONS_RUNTIME_NAME =
	/^ACTIONS_(?:ID_TOKEN_REQUEST_(?:TOKEN|URL)|RUNTIME_TOKEN)$/i;

/**
 * The runner's workflow-command FILES. Not credentials, but writing to them
 * injects environment variables, PATH entries or outputs into LATER steps of
 * the job, which may hold a token. The agent has no use for them.
 */
const RUNNER_COMMAND_FILES = new Set([
	'GITHUB_ENV',
	'GITHUB_PATH',
	'GITHUB_OUTPUT',
	'GITHUB_STATE',
	'GITHUB_STEP_SUMMARY',
]);

/**
 * GitHub token VALUE shapes, anywhere in a value (a token inside a URL counts):
 * personal (`ghp_`), OAuth (`gho_`), user-to-server (`ghu_`), server-to-server
 * incl. the Actions `GITHUB_TOKEN` (`ghs_`), refresh (`ghr_`) and fine-grained
 * PATs (`github_pat_`). Matching on the value catches a token the workflow
 * exported under ANY name, which a name list alone would miss.
 */
const GITHUB_TOKEN_VALUE =
	/(?:^|[^A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/;

/** `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>`. */
const GIT_CONFIG_ENV_ENTRY = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/;

/**
 * Git config text that carries or fetches a credential: an HTTP auth header, a
 * credential helper or askpass command, or an HTTP(S) URL with userinfo
 * (`https://user:token@host`). A plain `insteadOf` rewrite is NOT matched,
 * including an SSH one (`ssh://git@github.com/`, whose userinfo is no secret).
 */
const CREDENTIAL_CONFIG_TEXT =
	/extraheader|authorization|credential\.|askpass|https?:\/\/[^/@\s]+@/i;

/** The result of {@link scrubAgentEnv}. */
export interface ScrubbedEnv {
	/** The environment to launch the child with (a COPY; the input is untouched). */
	env: NodeJS.ProcessEnv;
	/** The NAMES that were removed (never the values), sorted, for diagnostics. */
	removed: string[];
}

/**
 * Should this single variable be withheld from an agent? True for the GitHub
 * token names, the Actions runtime credentials, the runner command files, and
 * any variable whose VALUE contains a GitHub token.
 */
export function isWriteCredentialVar(
	name: string,
	value: string | undefined,
): boolean {
	if (GITHUB_TOKEN_NAME.test(name) || ACTIONS_RUNTIME_NAME.test(name)) {
		return true;
	}
	if (RUNNER_COMMAND_FILES.has(name.toUpperCase())) {
		return true;
	}
	return value !== undefined && GITHUB_TOKEN_VALUE.test(value);
}

/**
 * Return a copy of `env` with every GitHub credential removed: the variables
 * {@link isWriteCredentialVar} flags, any OTHER variable holding the SAME value
 * as one of those (an alias such as `TOKEN=$GH_TOKEN` of a token whose shape is
 * not recognised, e.g. a GitHub Enterprise Server token), and git's environment
 * config (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT/KEY_n/VALUE_n`) when it
 * carries a credential. The `GIT_CONFIG_COUNT/KEY_n/VALUE_n` block is removed
 * WHOLE whenever any part of it is: removing one entry would leave a `COUNT`
 * pointing at a missing key, which makes every git command fail.
 *
 * A denylist on purpose: the agent needs an open-ended set of variables (PATH,
 * HOME, the provider key whose name the consumer chooses, node/pnpm/proxy
 * settings), and an allowlist would break a consumer's harness.
 */
export function scrubAgentEnv(env: NodeJS.ProcessEnv): ScrubbedEnv {
	const out: NodeJS.ProcessEnv = {...env};
	const removed = new Set<string>();
	const secretValues = new Set<string>();
	for (const [name, value] of Object.entries(env)) {
		if (isWriteCredentialVar(name, value)) {
			delete out[name];
			removed.add(name);
			// Only a value long enough to be a secret is used for alias matching, so
			// an empty or trivially short value cannot knock out unrelated variables.
			if (value !== undefined && value.length >= 16) {
				secretValues.add(value);
			}
		}
	}
	for (const [name, value] of Object.entries(out)) {
		if (value !== undefined && secretValues.has(value)) {
			delete out[name];
			removed.add(name);
		}
	}
	// Judge the block on the ORIGINAL env: an entry already removed above still
	// condemns the whole block.
	const gitConfigEntries = Object.keys(env).filter((k) =>
		GIT_CONFIG_ENV_ENTRY.test(k),
	);
	if (
		gitConfigEntries.some(
			(k) => removed.has(k) || CREDENTIAL_CONFIG_TEXT.test(env[k] ?? ''),
		)
	) {
		for (const k of gitConfigEntries) {
			delete out[k];
			removed.add(k);
		}
	}
	if (CREDENTIAL_CONFIG_TEXT.test(out.GIT_CONFIG_PARAMETERS ?? '')) {
		delete out.GIT_CONFIG_PARAMETERS;
		removed.add('GIT_CONFIG_PARAMETERS');
	}
	return {env: out, removed: [...removed].sort()};
}

/**
 * Is dorfl running in GitHub Actions (where agents lose the GitHub tokens)?
 * Checks the process env too, so a caller that builds a child env from scratch
 * (without `GITHUB_ACTIONS`) cannot switch the filter off by accident.
 */
export function inGitHubActions(env: NodeJS.ProcessEnv): boolean {
	return env.GITHUB_ACTIONS === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

/**
 * The environment an autonomous agent is launched with: in GitHub Actions, the
 * caller's env with every GitHub credential removed ({@link scrubAgentEnv}); on
 * a laptop, the caller's env unchanged.
 */
export function agentEnvFor(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return inGitHubActions(env) ? scrubAgentEnv(env).env : env;
}
