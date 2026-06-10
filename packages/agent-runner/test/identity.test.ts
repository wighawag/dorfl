import {describe, it, expect} from 'vitest';
import {spawnSync, execSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	arbiterTransport,
	assertTransportAllowed,
	identityEnv,
	resolveGitHubToken,
	validateIdentity,
	IdentityConfigError,
	IdentityTransportError,
	DEFAULT_IDENTITY_NAME,
	DEFAULT_IDENTITY_EMAIL,
	type Identity,
} from '../src/identity.js';

/** A minimal valid identity (ambient ssh, ambient https, no provider). */
function ambientIdentity(extra: Partial<Identity> = {}): Identity {
	return {auth: {ssh: 'ambient', https: 'ambient'}, ...extra};
}

describe('arbiterTransport', () => {
	it('classifies scp-like ssh as ssh', () => {
		expect(arbiterTransport('git@github.com:org/repo.git')).toBe('ssh');
	});
	it('classifies ssh:// as ssh', () => {
		expect(arbiterTransport('ssh://git@github.com/org/repo.git')).toBe('ssh');
	});
	it('classifies https:// and http:// as https', () => {
		expect(arbiterTransport('https://github.com/org/repo.git')).toBe('https');
		expect(arbiterTransport('http://example.com/org/repo.git')).toBe('https');
	});
	it('classifies file:// and a plain local path as local', () => {
		expect(arbiterTransport('file:///srv/git/repo.git')).toBe('local');
		expect(arbiterTransport('/srv/git/org/repo.git')).toBe('local');
	});
});

describe('validateIdentity', () => {
	it('accepts a minimal ambient identity', () => {
		expect(() => validateIdentity(ambientIdentity())).not.toThrow();
	});
	it('rejects a missing auth block', () => {
		expect(() => validateIdentity({auth: undefined as never})).toThrow(
			IdentityConfigError,
		);
	});
	it('rejects a missing/empty ssh policy', () => {
		expect(() =>
			validateIdentity({auth: {ssh: '' as never, https: 'ambient'}}),
		).toThrow(/auth\.ssh/);
	});
	it('rejects an invalid https policy', () => {
		expect(() =>
			validateIdentity({auth: {ssh: 'ambient', https: 'maybe' as never}}),
		).toThrow(/auth\.https/);
	});
	it('rejects github with both token and tokenEnv', () => {
		expect(() =>
			validateIdentity(
				ambientIdentity({
					providers: {github: {token: 'x', tokenEnv: 'Y'} as never},
				}),
			),
		).toThrow(/exactly one/);
	});
	it('rejects github with neither token nor tokenEnv', () => {
		expect(() =>
			validateIdentity(ambientIdentity({providers: {github: {} as never}})),
		).toThrow(/token/);
	});
	it('accepts github with a literal token', () => {
		expect(() =>
			validateIdentity(
				ambientIdentity({providers: {github: {token: 'ghp_x'}}}),
			),
		).not.toThrow();
	});
});

describe('resolveGitHubToken', () => {
	it('returns undefined for no identity / no provider', () => {
		expect(resolveGitHubToken(undefined)).toBeUndefined();
		expect(resolveGitHubToken(ambientIdentity())).toBeUndefined();
	});
	it('returns a literal token', () => {
		const id = ambientIdentity({providers: {github: {token: 'ghp_lit'}}});
		expect(resolveGitHubToken(id, {})).toBe('ghp_lit');
	});
	it('resolves a tokenEnv from the passed env at use-time', () => {
		const id = ambientIdentity({providers: {github: {tokenEnv: 'BOT_TOK'}}});
		expect(resolveGitHubToken(id, {BOT_TOK: 'ghp_env'})).toBe('ghp_env');
	});
	it('throws a clear error when the named env var is unset', () => {
		const id = ambientIdentity({providers: {github: {tokenEnv: 'MISSING'}}});
		expect(() => resolveGitHubToken(id, {})).toThrow(/MISSING/);
	});
});

describe('identityEnv', () => {
	it('returns the base env unchanged (same reference) when identity is absent', () => {
		const base = {FOO: 'bar'};
		expect(identityEnv(undefined, base)).toBe(base);
	});

	it('sets GIT_CONFIG_PARAMETERS with defaulted name/email', () => {
		const env = identityEnv(ambientIdentity(), {});
		expect(env.GIT_CONFIG_PARAMETERS).toBe(
			`'user.name=${DEFAULT_IDENTITY_NAME}' 'user.email=${DEFAULT_IDENTITY_EMAIL}'`,
		);
	});

	it('pins GIT_AUTHOR_*/GIT_COMMITTER_* so an ambient identity cannot win', () => {
		// These per-commit vars OUTRANK user.name/user.email — setting them is what
		// defeats a hostile ambient GIT_AUTHOR_* (the silent-fallback failure mode).
		const env = identityEnv(
			ambientIdentity({name: 'Bot', email: 'bot@x.test'}),
			{GIT_AUTHOR_NAME: 'Ambient Human', GIT_AUTHOR_EMAIL: 'h@corp.test'},
		);
		expect(env.GIT_AUTHOR_NAME).toBe('Bot');
		expect(env.GIT_AUTHOR_EMAIL).toBe('bot@x.test');
		expect(env.GIT_COMMITTER_NAME).toBe('Bot');
		expect(env.GIT_COMMITTER_EMAIL).toBe('bot@x.test');
	});

	it('sets GIT_CONFIG_PARAMETERS with explicit name/email', () => {
		const env = identityEnv(
			ambientIdentity({name: 'Bot', email: 'bot@x.test'}),
			{},
		);
		expect(env.GIT_CONFIG_PARAMETERS).toBe(
			`'user.name=Bot' 'user.email=bot@x.test'`,
		);
	});

	it('quotes a name containing a space and a single quote safely', () => {
		const env = identityEnv(
			ambientIdentity({name: "O'Bot Builder", email: 'b@x.test'}),
			{},
		);
		// single quote becomes '\'' (close, escaped-quote, reopen)
		expect(env.GIT_CONFIG_PARAMETERS).toBe(
			`'user.name=O'\\''Bot Builder' 'user.email=b@x.test'`,
		);
	});

	it('sets GIT_SSH_COMMAND only when ssh is a key path', () => {
		const pinned = identityEnv(
			{auth: {ssh: '/home/u/.ssh/bot', https: 'never'}},
			{},
		);
		expect(pinned.GIT_SSH_COMMAND).toBe(
			`ssh -i '/home/u/.ssh/bot' -o IdentitiesOnly=yes -o IdentityAgent=none`,
		);
		// `IdentityAgent=none` is load-bearing: without it a running ssh-agent can
		// offer the human's key first and silently push as the wrong account.
		expect(pinned.GIT_SSH_COMMAND).toContain('-o IdentityAgent=none');
		expect(identityEnv(ambientIdentity(), {}).GIT_SSH_COMMAND).toBeUndefined();
		expect(
			identityEnv({auth: {ssh: 'never', https: 'ambient'}}, {}).GIT_SSH_COMMAND,
		).toBeUndefined();
	});

	it('sets GH_TOKEN only when a provider token is configured', () => {
		expect(identityEnv(ambientIdentity(), {}).GH_TOKEN).toBeUndefined();
		const withTok = identityEnv(
			ambientIdentity({providers: {github: {token: 'ghp_x'}}}),
			{},
		);
		expect(withTok.GH_TOKEN).toBe('ghp_x');
	});

	it('NEVER feeds the gh token into a git transport variable', () => {
		const env = identityEnv(
			{
				auth: {ssh: 'ambient', https: 'ambient'},
				providers: {github: {token: 'ghp_secret'}},
			},
			{},
		);
		expect(env.GIT_SSH_COMMAND).toBeUndefined();
		expect(env.GIT_CONFIG_PARAMETERS).not.toContain('ghp_secret');
	});

	it('copies (does not mutate) the base env', () => {
		const base: NodeJS.ProcessEnv = {KEEP: '1'};
		const env = identityEnv(ambientIdentity(), base);
		expect(env).not.toBe(base);
		expect(base.GIT_CONFIG_PARAMETERS).toBeUndefined();
		expect(env.KEEP).toBe('1');
	});
});

describe('assertTransportAllowed', () => {
	it('is a no-op for an absent identity', () => {
		expect(() =>
			assertTransportAllowed(undefined, 'https://github.com/o/r.git'),
		).not.toThrow();
	});

	it('throws when ssh:"never" meets an SSH arbiter', () => {
		expect(() =>
			assertTransportAllowed(
				{auth: {ssh: 'never', https: 'ambient'}},
				'git@github.com:o/r.git',
			),
		).toThrow(IdentityTransportError);
	});

	it('throws when https:"never" meets an HTTPS arbiter', () => {
		expect(() =>
			assertTransportAllowed(
				{auth: {ssh: '/k', https: 'never'}},
				'https://github.com/o/r.git',
			),
		).toThrow(IdentityTransportError);
	});

	it('allows a pinned ssh key against an SSH arbiter', () => {
		expect(() =>
			assertTransportAllowed(
				{auth: {ssh: '/k', https: 'never'}},
				'git@github.com:o/r.git',
			),
		).not.toThrow();
	});

	it('allows ambient https against an HTTPS arbiter', () => {
		expect(() =>
			assertTransportAllowed(ambientIdentity(), 'https://github.com/o/r.git'),
		).not.toThrow();
	});

	it('enforces nothing for a local arbiter', () => {
		expect(() =>
			assertTransportAllowed(
				{auth: {ssh: 'never', https: 'never'}},
				'/srv/git/o/r.git',
			),
		).not.toThrow();
	});
});

/**
 * BEHAVIORAL regression for the agent-hijack bug: a pinned `auth.ssh` key must be
 * the ONLY identity the real `ssh` binary offers, even when an ssh-agent holds
 * other keys. `IdentitiesOnly=yes` ALONE does NOT achieve this — a running agent
 * still offers its own keys first, so a push could silently authenticate as the
 * WRONG account (we observed a real `Hi <human>!` despite `-i <bot key>`). The fix
 * is `IdentityAgent=none`. We prove the produced `GIT_SSH_COMMAND` is HONORED by
 * the actual `ssh` binary (not just that our string contains the flag) by
 * resolving it with `ssh -G` (offline; no network/server/agent needed): the
 * resolved config must report `identityagent none` and pin the bot key first.
 */
const hasSsh = (() => {
	try {
		return spawnSync('ssh', ['-V'], {stdio: 'ignore'}).status !== null;
	} catch {
		return false;
	}
})();

(hasSsh ? describe : describe.skip)(
	'GIT_SSH_COMMAND is honored by the real ssh binary (agent-hijack regression)',
	() => {
		it('detaches the ssh-agent and pins the bot key (IdentityAgent=none)', () => {
			const dir = mkdtempSync(join(tmpdir(), 'agent-runner-ssh-'));
			try {
				// A REAL key file so `ssh -G` pins it (a non-existent `-i` path falls
				// back to the default identity list).
				const keyPath = join(dir, 'botkey');
				execSync(
					`ssh-keygen -q -t ed25519 -N "" -C bot -f ${JSON.stringify(keyPath)}`,
				);

				const env = identityEnv({auth: {ssh: keyPath, https: 'never'}}, {});
				const sshCommand = env.GIT_SSH_COMMAND;
				expect(sshCommand).toBeDefined();

				// Parse the GIT_SSH_COMMAND into argv (it is `ssh -i <q> -o ... -o ...`),
				// then ask the SAME ssh to RESOLVE its effective config (`-G <host>`),
				// which honors the `-o` flags WITHOUT connecting anywhere.
				const argv = (sshCommand as string).split(/\s+/).map((tok) =>
					// strip the single-quotes our shellQuote added around the key path
					tok.startsWith("'") && tok.endsWith("'") ? tok.slice(1, -1) : tok,
				);
				const [bin, ...args] = argv;
				const resolved = spawnSync(bin, [...args, '-G', 'example.test'], {
					encoding: 'utf8',
				});
				expect(resolved.status).toBe(0);
				const lines = resolved.stdout.toLowerCase().split('\n');

				// The decisive assertion: the agent is detached.
				expect(lines).toContain('identityagent none');
				expect(lines).toContain('identitiesonly yes');
				// And the bot key is the FIRST identity file (the pin took effect).
				const firstIdentity = lines.find((l) => l.startsWith('identityfile '));
				expect(firstIdentity).toBe(`identityfile ${keyPath.toLowerCase()}`);
			} finally {
				rmSync(dir, {recursive: true, force: true});
			}
		});
	},
);
