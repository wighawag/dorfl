/**
 * The ONE way dorfl builds a `bash -c` argv. Every shell dorfl spawns (the
 * acceptance gate, `prepare`, the null/shell agent adapter, the bootstrap
 * self-forward) goes through {@link bashCommandArgs}.
 *
 * WHY `--norc`: a non-interactive `bash -c` is supposed to read no rc file, but
 * bash has a "started by rshd/sshd" heuristic: when stdin is a SOCKET (or
 * `SSH_CLIENT` is set on builds with `SSH_SOURCE_BASHRC`) and `SHLVL` is unset
 * or 0, it sources the system bashrc and then `~/.bashrc`. Node/libuv implements
 * piped stdio as a UNIX socketpair, so a plain `spawn('bash', ['-c', cmd])` hits
 * that branch whenever dorfl itself was started without `SHLVL` (a systemd unit,
 * a supervisor). On NixOS `/etc/bashrc` then re-sources `/etc/profile`, which
 * RESETS PATH: a gate that passes in the caller's shell failed inside dorfl with
 * `spawnSync openssl ENOENT` (dorfl 0.15.1). `--norc` disables exactly that
 * branch and nothing else (`BASH_ENV` handling is separate and unchanged), with
 * no dependence on distro-specific variables like `NOSYSBASHRC` or
 * `__ETC_PROFILE_DONE`, and it holds even when stdin must stay a pipe (the null
 * adapter feeds the prompt on stdin) or is inherited (the forward).
 *
 * Callers that never feed stdin should ALSO spawn with stdin `'ignore'` (a
 * `/dev/null` EOF), so a command that reads stdin cannot block forever on a pipe
 * nobody writes or closes.
 */
export function bashCommandArgs(
	command: string,
	...positional: string[]
): string[] {
	return ['--norc', '-c', command, ...positional];
}
