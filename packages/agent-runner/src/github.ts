import {run, type RunResult} from './git.js';
import {
	NoneProvider,
	type ReviewProvider,
	type OpenRequestInput,
	type OpenRequestResult,
} from './integrator.js';

/**
 * The **GitHub** integration provider (ADR §6 in
 * `docs/adr/execution-substrate-decisions.md`): the concrete `propose`-mode
 * review-request step, implemented by shelling out to the `gh` CLI.
 *
 * It fulfils the provider seam introduced by `agent-workspaces`
 * (`./integrator.ts`, with its `none` provider). The contract that seam encodes
 * is load-bearing here:
 *
 *  - The **universal, safety-bearing action is `git push`** — done by the seam
 *    BEFORE the provider is asked to open a request (`Integrator.integrate`).
 *    So by the time `openRequest` runs the branch is already on the arbiter and
 *    the work is SAFE regardless of what `gh` does (ADR §4/§6).
 *  - Therefore this provider **NEVER hard-fails**: if `gh` is missing or
 *    unauthenticated it degrades to the `none` behaviour (branch pushed + print
 *    manual-PR instructions) rather than throwing — a provider failure must
 *    leave a safe, pushed branch, not lost work.
 *  - It **NEVER `--force`s** anything (the only force in the system is the claim
 *    micro-commit's `--force-with-lease` inside claim.sh).
 *
 * Selection is driven by the ARBITER URL: a GitHub remote auto-selects this
 * provider; an explicit `provider` config value overrides detection; an unknown
 * arbiter defaults to `none` (see {@link selectProvider}).
 *
 * The core never imports `gh`; ONLY this adapter shells out to it (the `gh`
 * invocation lives entirely behind the `ReviewProvider` seam). Tests stub `gh`
 * via the injectable `ghBin` (no network, no real GitHub).
 */

/** The review-request providers agent-runner knows about (config `provider`). */
export type ProviderName = 'none' | 'github';

/** The default `gh` CLI binary name (resolved on `PATH`). */
export const DEFAULT_GH_BIN = 'gh';

/**
 * True iff `url` is a GitHub arbiter remote, recognised across the URL shapes
 * the arbiter can take (scp-like ssh `git@github.com:o/r.git`, `ssh://`,
 * `https://`/`http://`). We match on the HOST being exactly `github.com` (or a
 * `github.com` subdomain — GitHub Enterprise installs are out of scope and read
 * as not-GitHub, the safe `none` default). A mere substring match is rejected so
 * a lookalike host (`notgithub.com.evil`) never selects the GitHub provider.
 */
export function isGitHubArbiterUrl(url: string): boolean {
	const host = arbiterHost(url);
	if (host === undefined) {
		return false;
	}
	return host === 'github.com' || host.endsWith('.github.com');
}

/**
 * Extract the bare host from an arbiter remote URL, or `undefined` for a local
 * filesystem path (`file://...` / `/abs/path`) which has no host. Mirrors the
 * `repo-mirror` URL handling (the four shapes the arbiter can take) but only
 * needs the host for provider detection.
 */
function arbiterHost(url: string): string | undefined {
	const trimmed = url.trim();

	if (!trimmed.includes('://')) {
		// scp-like ssh: [user@]host:path (no `://`, a `:` before the path, NOT a
		// plain absolute local path).
		const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/;
		const m = scp.exec(trimmed);
		if (m && !trimmed.startsWith('/')) {
			return m[1].toLowerCase();
		}
		return undefined; // a plain local path has no host
	}

	const rest = trimmed.slice(trimmed.indexOf('://') + 3);
	const slash = rest.indexOf('/');
	const authority = slash === -1 ? rest : rest.slice(0, slash);
	const host = stripUserAndPort(authority).toLowerCase();
	// `file://` yields an empty authority (file:///abs/path) → no host.
	return host === '' ? undefined : host;
}

/** Drop `user@` and `:port` from an authority, leaving the bare host. */
function stripUserAndPort(authority: string): string {
	const afterUser = authority.includes('@')
		? authority.slice(authority.lastIndexOf('@') + 1)
		: authority;
	const colon = afterUser.indexOf(':');
	return colon === -1 ? afterUser : afterUser.slice(0, colon);
}

export interface SelectProviderOptions {
	/**
	 * The arbiter remote URL (used for auto-detection). `undefined` when it
	 * cannot be resolved — detection then yields `none` (the safe default).
	 */
	arbiterUrl?: string;
	/**
	 * Explicit provider override (config `provider`). When set it WINS over URL
	 * detection: `github` forces this provider even off a local URL; `none`
	 * forces push-only even for a GitHub arbiter.
	 */
	provider?: ProviderName;
	/** The `gh` CLI binary the GitHub provider invokes (tests inject a stub). */
	ghBin?: string;
}

/**
 * Resolve the review-request provider for an integration (ADR §6). Precedence:
 *
 *   1. an explicit `provider` config value (override — `github` or `none`), else
 *   2. auto-detection from the arbiter URL (`github.com` ⇒ the GitHub provider),
 *      else
 *   3. the `none` provider (the safe default for unknown / local `--bare`
 *      arbiters, which have no review concept).
 *
 * The GitHub provider degrades to `none` behaviour at RUNTIME when `gh` is
 * absent/unauthenticated (so it is safe to select it on URL alone — the work is
 * already pushed by the seam, ADR §6); this keeps SELECTION a pure, testable
 * function of URL + config.
 */
export function selectProvider(options: SelectProviderOptions): ReviewProvider {
	const override = options.provider;
	if (override === 'none') {
		return new NoneProvider();
	}
	if (override === 'github') {
		return new GitHubProvider({ghBin: options.ghBin});
	}
	// No override: auto-detect from the arbiter URL.
	if (options.arbiterUrl && isGitHubArbiterUrl(options.arbiterUrl)) {
		return new GitHubProvider({ghBin: options.ghBin});
	}
	return new NoneProvider();
}

export interface GitHubProviderOptions {
	/**
	 * The `gh` CLI binary (default `gh` on `PATH`). Tests inject a stub script so
	 * the seam is exercised without a real model / network / GitHub.
	 */
	ghBin?: string;
	/** The base branch PRs target. Default `main`. */
	base?: string;
}

/**
 * The GitHub provider: opens a PR for an already-pushed `work/<slug>` branch via
 * `gh pr create`. It NEVER hard-fails — a missing/unauthenticated `gh` degrades
 * to the `none` behaviour (the branch is already pushed; print manual-PR
 * instructions) — and NEVER `--force`s anything. The created PR URL is parsed
 * from `gh`'s stdout and returned so the caller can record it.
 */
export class GitHubProvider implements ReviewProvider {
	readonly name = 'github';
	private readonly ghBin: string;
	private readonly base: string;

	constructor(options: GitHubProviderOptions = {}) {
		this.ghBin = options.ghBin ?? DEFAULT_GH_BIN;
		this.base = options.base ?? 'main';
	}

	/**
	 * Open a PR for `input.branch` via `gh pr create --base main --head <branch>
	 * --fill`. The branch is GUARANTEED to be on the arbiter already (the push is
	 * the seam's safety-bearing step), so any `gh` failure is non-fatal: we fall
	 * back to the same manual-instructions result the `none` provider returns. On
	 * success we parse the PR URL `gh` prints and surface it (recorded by the
	 * caller into the job record / `status`).
	 */
	openRequest(input: OpenRequestInput): OpenRequestResult {
		const result = this.runGh(
			['pr', 'create', '--base', this.base, '--head', input.branch, '--fill'],
			input.cwd,
			input.env,
		);

		// gh missing (spawn failed) OR non-zero exit (e.g. unauthenticated): the
		// work is already pushed, so degrade gracefully to manual instructions —
		// NEVER throw (ADR §6: a provider failure must not lose safe work).
		if (result === undefined || result.status !== 0) {
			return this.degrade(input);
		}

		const url = parsePrUrl(result.stdout);
		if (url === undefined) {
			// gh succeeded but we could not parse a URL — still treat the PR as
			// opened (gh exited 0) but fall back to a generic confirmation.
			return {
				opened: true,
				instruction: `Opened a GitHub PR for ${input.branch}.`,
			};
		}
		return {
			opened: true,
			url,
			instruction: `Opened a GitHub PR for ${input.branch}: ${url}`,
		};
	}

	/**
	 * Is `gh` available AND authenticated (so a PR can actually be opened)?
	 * `gh auth status` exits 0 when authenticated. A missing `gh` (spawn failure)
	 * or a non-zero exit both read as unavailable. Read-only; mutates nothing.
	 */
	available(cwd: string, env?: NodeJS.ProcessEnv): boolean {
		const result = this.runGh(['auth', 'status'], cwd, env);
		return result !== undefined && result.status === 0;
	}

	/**
	 * Run `gh <args>` in `cwd`, returning the result, or `undefined` when `gh`
	 * cannot even be spawned (binary missing). `run` throws on a spawn error; we
	 * catch it here so a missing `gh` degrades rather than crashing the runner.
	 */
	private runGh(
		args: string[],
		cwd: string,
		env: NodeJS.ProcessEnv | undefined,
	): RunResult | undefined {
		try {
			return run(this.ghBin, args, cwd, {env});
		} catch {
			return undefined; // gh binary not found / not executable
		}
	}

	/** The graceful-degradation result: identical to the `none` provider's. */
	private degrade(input: OpenRequestInput): OpenRequestResult {
		return {
			opened: false,
			instruction:
				`Pushed ${input.branch} to ${input.arbiter}. \`gh\` is unavailable ` +
				'or unauthenticated, so no PR was opened — open one manually, e.g. ' +
				`\`gh pr create --base ${this.base} --head ${input.branch} --fill\`.`,
		};
	}
}

/**
 * Parse the PR URL `gh pr create` prints to stdout. `gh` prints the PR URL as a
 * line (often the only/last line); we pick the first GitHub PR URL we find. Any
 * surrounding chatter is ignored. Returns `undefined` when no URL is present.
 */
function parsePrUrl(stdout: string): string | undefined {
	const match = stdout.match(/https?:\/\/\S+\/pull\/\d+/);
	return match ? match[0] : undefined;
}
