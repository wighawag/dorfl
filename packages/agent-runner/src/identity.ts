/**
 * The **identity** feature: run the runner's git + provider operations as a
 * configured entity (a bot), without mutating the user's global git/`gh` config.
 *
 * The mechanism is process-scoped environment overrides on the child processes
 * the runner spawns (`git`, `gh`) — never a global mutation. So if the runner
 * crashes mid-run the user's machine is untouched, and an absent identity is
 * byte-for-byte today's ambient behaviour.
 *
 * # The three axes (keep these distinct — they are different concerns)
 *
 *   1. **commit label** (`name` / `email`) — the git author/committer strings
 *      stamped into the commit object. These are NOT authenticated: git never
 *      checks them against anything. Driven by `GIT_CONFIG_PARAMETERS`.
 *   2. **git transport auth** (`auth`) — WHO pushes. Per-transport policy: an
 *      SSH key (or ambient ssh) drives `GIT_SSH_COMMAND`; HTTPS uses the ambient
 *      credential. This is the substrate concern — meaningful with NO provider.
 *   3. **provider API auth** (`providers.github`) — WHO opens the PR / posts the
 *      comment, via `GH_TOKEN`. NEVER used as a git credential (git is SSH-first;
 *      GitHub is an additive layer). Optional: absent ⇒ `gh` degrades.
 *
 * The three axes SHOULD point at the same entity for a coherent bot (the token's
 * GitHub account should be the account the SSH key is registered to), but nothing
 * can verify that automatically — it is a documented coherence note, not a check.
 *
 * # Why `auth` is mandatory-explicit (no silent omission)
 *
 * `auth.ssh` and `auth.https` are BOTH required, each an explicit small union, so
 * the dangerous "I set a bot provider token but left git auth ambient — and my
 * remote is HTTPS, so I silently push as the human" misconfig is UNSPELLABLE by
 * accident: pushing over ambient HTTPS requires literally writing
 * `https: "ambient"`. A bot setup naturally writes `https: "never"`, which makes
 * the leak a hard push-time failure instead of a silent wrong-account push.
 */

/** The conventional `agents.alt` TLD never resolves to a real account (deliberate). */
export const DEFAULT_IDENTITY_NAME = 'agent-runner';
export const DEFAULT_IDENTITY_EMAIL = 'agent-runner@agents.alt';

/**
 * Per-transport git-auth policy for SSH. A filesystem path PINS that key
 * (`GIT_SSH_COMMAND -i <path>`); `"ambient"` lets ssh-agent / `~/.ssh/config`
 * resolve the key; `"never"` FORBIDS the SSH transport (a hard push-time failure
 * if the arbiter is an SSH remote). A `union of more` later (e.g. host options).
 */
export type SshAuth = string | 'ambient' | 'never';

/**
 * Per-transport git-auth policy for HTTPS. `"ambient"` uses whatever HTTPS
 * credential the environment supplies (credential helper / cached PAT — e.g. the
 * CI `actions/checkout` token); `"never"` FORBIDS the HTTPS transport (a hard
 * push-time failure if the arbiter is an HTTPS remote). A token-pin member (the
 * explicit HTTPS-push credential, distinct from the provider token) is a planned
 * future addition — keep this a union so it grows without churn.
 */
export type HttpsAuth = 'ambient' | 'never';

/** Git TRANSPORT auth — both transports stated, no silent-omission state. */
export interface GitAuth {
	/** Policy for SSH pushes: a key path, `"ambient"`, or `"never"`. */
	ssh: SshAuth;
	/** Policy for HTTPS pushes: `"ambient"` or `"never"`. */
	https: HttpsAuth;
}

/** Provider API auth — the `gh` token, by literal value OR an env-var name. */
export type GitHubProviderAuth = {token: string} | {tokenEnv: string};

/** The optional, pluggable review-request providers (matches `ProviderName`). */
export interface IdentityProviders {
	/** GitHub provider API auth (`gh`). Absent ⇒ `gh` runs unauthenticated. */
	github?: GitHubProviderAuth;
}

/**
 * A configured runner identity (a bot). The WHOLE block is optional — absent ⇒
 * fully ambient (today's behaviour, byte-for-byte). When present, `auth` is
 * MANDATORY (both transports stated); `name`/`email` default in; `providers` is
 * optional. HOST-ONLY: rejected in a per-repo `.agent-runner.json` (it carries
 * secrets and is per-machine), so it lives only in the global config.
 */
export interface Identity {
	/** Commit author/committer LABEL. Default {@link DEFAULT_IDENTITY_NAME}. */
	name?: string;
	/** Commit author/committer LABEL. Default {@link DEFAULT_IDENTITY_EMAIL}. */
	email?: string;
	/** Git transport auth (mandatory when identity present). */
	auth: GitAuth;
	/** Optional pluggable providers (GitHub today). */
	providers?: IdentityProviders;
}

/** Which transport an arbiter remote URL pushes over. */
export type ArbiterTransport = 'ssh' | 'https' | 'local';

/**
 * Classify the git transport an arbiter remote URL uses — the fact that selects
 * WHICH `auth` policy (`ssh` vs `https`) applies at push time. Mirrors the four
 * URL shapes `repo-mirror`/`github` already handle:
 *
 *  - scp-like ssh (`git@host:org/repo.git`) and `ssh://` ⇒ `ssh`
 *  - `https://` / `http://` ⇒ `https`
 *  - `file://` / a plain local path ⇒ `local` (no transport auth applies)
 */
export function arbiterTransport(url: string): ArbiterTransport {
	const trimmed = url.trim();
	if (!trimmed.includes('://')) {
		// scp-like ssh: [user@]host:path (a `:` before the path, NOT a local path).
		const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/;
		if (scp.test(trimmed) && !trimmed.startsWith('/')) {
			return 'ssh';
		}
		return 'local'; // a plain absolute path has no transport
	}
	const scheme = trimmed.slice(0, trimmed.indexOf('://')).toLowerCase();
	if (scheme === 'ssh') {
		return 'ssh';
	}
	if (scheme === 'https' || scheme === 'http') {
		return 'https';
	}
	return 'local'; // file:// (or anything else) — no transport auth
}

/** A validation failure naming the offending field (load-time config error). */
export class IdentityConfigError extends Error {}

/** A push-time transport-coherence failure (forbidden transport for the arbiter). */
export class IdentityTransportError extends Error {}

/**
 * Validate a present `identity` block at config-LOAD time (dumb — does NOT
 * resolve any arbiter URL; the transport-coherence check is push-time). Throws
 * an {@link IdentityConfigError} naming the offending field. The structural
 * "auth mandatory / ssh+https stated" guarantee mostly rides on the type, but a
 * JSON file is untyped, so we re-check it here for a human-facing message.
 */
export function validateIdentity(identity: Identity): void {
	if (identity.auth === undefined || identity.auth === null) {
		throw new IdentityConfigError(
			'identity.auth is required when an identity is configured ' +
				'(state both `ssh` and `https`).',
		);
	}
	const {ssh, https} = identity.auth;
	if (ssh === undefined || ssh === null || ssh === '') {
		throw new IdentityConfigError(
			'identity.auth.ssh is required (a key path, "ambient", or "never").',
		);
	}
	if (https !== 'ambient' && https !== 'never') {
		throw new IdentityConfigError(
			'identity.auth.https must be "ambient" or "never".',
		);
	}
	const github = identity.providers?.github;
	if (github !== undefined) {
		const hasToken = 'token' in github && github.token !== undefined;
		const hasEnv = 'tokenEnv' in github && github.tokenEnv !== undefined;
		if (hasToken && hasEnv) {
			throw new IdentityConfigError(
				'identity.providers.github must set exactly one of `token` or ' +
					'`tokenEnv`, not both.',
			);
		}
		if (!hasToken && !hasEnv) {
			throw new IdentityConfigError(
				'identity.providers.github must set `token` or `tokenEnv`.',
			);
		}
	}
}

/**
 * Resolve the `gh` token for the GitHub provider from the identity, or
 * `undefined` when no GitHub provider auth is configured. A `tokenEnv` is read
 * from `env` at USE-time (so a missing env var surfaces here with a clear
 * message), `token` is the literal value. `env` defaults to `process.env`.
 */
export function resolveGitHubToken(
	identity: Identity | undefined,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const github = identity?.providers?.github;
	if (github === undefined) {
		return undefined;
	}
	if ('token' in github && github.token !== undefined) {
		return github.token;
	}
	if ('tokenEnv' in github && github.tokenEnv !== undefined) {
		const value = env[github.tokenEnv];
		if (value === undefined || value === '') {
			throw new IdentityConfigError(
				`identity.providers.github.tokenEnv names env var ` +
					`"${github.tokenEnv}", which is unset or empty.`,
			);
		}
		return value;
	}
	return undefined;
}

/**
 * Build the process-scoped environment overrides for `identity`, merged over
 * `base` (default `process.env`). Returns `base` UNCHANGED (same reference) when
 * `identity` is `undefined` — the absent-identity path is byte-for-byte today's
 * behaviour, so callers can pass the result straight through.
 *
 * When present it sets, on a COPY of `base`:
 *   - `GIT_CONFIG_PARAMETERS` — quoted `'user.name=…' 'user.email=…'` (defaults
 *     applied). Properly single-quoted (with `'\''` escaping) so a name/email
 *     containing a space or quote cannot break the parse.
 *   - `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/
 *     `GIT_COMMITTER_EMAIL` — set to the SAME bot name/email. This is
 *     LOAD-BEARING: the per-commit `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars take
 *     PRECEDENCE over `user.name`/`user.email` (and thus over
 *     `GIT_CONFIG_PARAMETERS`). If the AMBIENT env already has them (some CI /
 *     tooling sets them), `GIT_CONFIG_PARAMETERS` alone would be SILENTLY ignored
 *     and the commit would be authored by the ambient identity — exactly the
 *     silent-fallback this feature exists to prevent. So we pin all four to the
 *     identity, making it win UNCONDITIONALLY over any ambient git identity.
 *   - `GIT_SSH_COMMAND` — `ssh -i <path> -o IdentitiesOnly=yes -o
 *     IdentityAgent=none` ONLY when `auth.ssh` is a key path. `"ambient"`/`"never"`
 *     set nothing (ambient ssh resolution; `"never"` is enforced by the push-time
 *     transport guard).
 *
 *     `IdentityAgent=none` is LOAD-BEARING, NOT decoration: `IdentitiesOnly=yes`
 *     ALONE does NOT stop a running ssh-agent from offering its OWN keys — it only
 *     restricts which keys are tried to those whose public file is named, and an
 *     agent key matching a discoverable `~/.ssh/*.pub` is still offered FIRST. So
 *     with a personal key in the agent, the push could silently authenticate as
 *     the HUMAN (the wrong account) despite `-i <bot key>` — the exact silent-
 *     wrong-account failure mode this feature exists to prevent (the SSH-axis twin
 *     of the `GIT_AUTHOR_*` pinning below). `IdentityAgent=none` detaches the
 *     agent entirely, so ONLY the pinned key is offered — it wins unconditionally.
 *   - `GH_TOKEN` — ONLY when a GitHub provider token is configured (resolved at
 *     use-time). NEVER fed to git (the token is provider-API only).
 */
export function identityEnv(
	identity: Identity | undefined,
	base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	if (identity === undefined) {
		return base;
	}
	const name = identity.name ?? DEFAULT_IDENTITY_NAME;
	const email = identity.email ?? DEFAULT_IDENTITY_EMAIL;
	const env: NodeJS.ProcessEnv = {...base};

	// Commit LABEL (always set when an identity is present). GIT_CONFIG_PARAMETERS
	// is a space-separated list of shell-quoted `key=value` pairs.
	env.GIT_CONFIG_PARAMETERS = [
		shellQuote(`user.name=${name}`),
		shellQuote(`user.email=${email}`),
	].join(' ');
	// Pin the per-commit author/committer env too — these OUTRANK `user.name`/
	// `user.email`, so without them an ambient `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
	// would silently beat the identity (the silent-fallback failure mode). Setting
	// them makes the identity win unconditionally.
	env.GIT_AUTHOR_NAME = name;
	env.GIT_AUTHOR_EMAIL = email;
	env.GIT_COMMITTER_NAME = name;
	env.GIT_COMMITTER_EMAIL = email;

	// Git TRANSPORT auth — only a PINNED ssh key sets GIT_SSH_COMMAND.
	// `IdentityAgent=none` is REQUIRED for the pin to actually hold: without it a
	// running ssh-agent (e.g. with the human's personal key) can offer its own keys
	// FIRST and silently push as the wrong account, despite `-i <bot key>`.
	const ssh = identity.auth.ssh;
	if (ssh !== 'ambient' && ssh !== 'never') {
		env.GIT_SSH_COMMAND = `ssh -i ${shellQuote(ssh)} -o IdentitiesOnly=yes -o IdentityAgent=none`;
	}

	// Provider API auth — the gh token, NEVER a git credential.
	const token = resolveGitHubToken(identity, base);
	if (token !== undefined) {
		env.GH_TOKEN = token;
	}

	return env;
}

/**
 * Enforce the push-time transport-coherence rule: the `auth` policy for the
 * arbiter's actual transport must not be `"never"`. Throws an
 * {@link IdentityTransportError} with an actionable message (use a matching
 * remote, or unset `identity`) when the transport is forbidden. A `local`
 * arbiter (or an absent identity) has nothing to enforce.
 */
export function assertTransportAllowed(
	identity: Identity | undefined,
	arbiterUrl: string,
): void {
	if (identity === undefined) {
		return;
	}
	const transport = arbiterTransport(arbiterUrl);
	if (transport === 'ssh' && identity.auth.ssh === 'never') {
		throw new IdentityTransportError(
			`identity forbids SSH (auth.ssh: "never") but arbiter ` +
				`"${arbiterUrl}" is an SSH remote. Use an HTTPS remote, set ` +
				`auth.ssh to a key path or "ambient", or unset identity.`,
		);
	}
	if (transport === 'https' && identity.auth.https === 'never') {
		throw new IdentityTransportError(
			`identity forbids HTTPS (auth.https: "never") but arbiter ` +
				`"${arbiterUrl}" is an HTTPS remote. Use an SSH remote, set ` +
				`auth.https to "ambient", or unset identity.`,
		);
	}
}

/**
 * Single-quote a string for safe inclusion in a `GIT_CONFIG_PARAMETERS` /
 * `GIT_SSH_COMMAND` value: wrap in single quotes and escape any embedded single
 * quote as `'\''` (close-quote, escaped-quote, re-open-quote — the POSIX idiom).
 */
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
