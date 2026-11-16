import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rmrf} from './gitRepo.js';

/**
 * A probe for bash's "run by rshd/sshd" startup quirk. A NON-interactive
 * `bash -c` normally reads no rc file, BUT when its stdin is a socket (which is
 * how libuv implements Node's piped stdio) and `SHLVL` is unset or 0, bash
 * sources the system bashrc and then `~/.bashrc`. On NixOS the system bashrc
 * re-sources `/etc/profile`, which resets PATH, so a gate loses tools the caller
 * had on PATH.
 *
 * To make that observable on ANY distro, the probe points `HOME` at a temp dir
 * whose `.bashrc` sets {@link RC_SENTINEL} and clobbers PATH, and builds an env
 * with `SHLVL` / `SSH_CLIENT` / `SSH2_CLIENT` removed (so the branch is
 * reachable regardless of how the test runner was started) and
 * {@link PATH_MARKER} prepended to PATH. A spawned shell that runs
 * {@link PROBE_COMMAND} prints `rc=<yes|no> path=<PATH>`.
 */
export const RC_SENTINEL = 'DORFL_TEST_BASHRC_SOURCED';
export const PATH_MARKER = '/dorfl-test-path-marker/bin';
export const PROBE_COMMAND = `printf 'rc=%s path=%s\\n' "\${${RC_SENTINEL}:-no}" "$PATH"`;

export interface BashrcProbe {
	env: NodeJS.ProcessEnv;
	cleanup: () => void;
}

export function makeBashrcProbe(): BashrcProbe {
	const home = mkdtempSync(join(tmpdir(), 'dorfl-bashrc-probe-'));
	writeFileSync(
		join(home, '.bashrc'),
		`export ${RC_SENTINEL}=yes\nexport PATH=/clobbered-by-bashrc\n`,
	);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: home,
		PATH: `${PATH_MARKER}:${process.env.PATH ?? ''}`,
	};
	delete env.SHLVL;
	delete env.SSH_CLIENT;
	delete env.SSH2_CLIENT;
	return {env, cleanup: () => rmrf(home)};
}

/** Assert-friendly parse of {@link PROBE_COMMAND}'s output. */
export function parseProbe(output: string): {rc: string; path: string} {
	const m = /rc=(\S*) path=(.*)/.exec(output);
	return {rc: m?.[1] ?? '?', path: m?.[2] ?? ''};
}
