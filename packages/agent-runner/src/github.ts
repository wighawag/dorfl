import {run, type RunResult} from './git.js';
import {ghFailureDetail} from './gh-failure.js';
import {realSleep, retryWithBackoff} from './retry-backoff.js';
import {
	NoneProvider,
	manualRequestText,
	type ReviewProvider,
	type OpenRequestInput,
	type OpenRequestResult,
	type PostPRCommentInput,
	type PostPRCommentOnBranchInput,
	type PostPRCommentResult,
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
	 * Open a PR for `input.branch` via `gh pr create --base main --head <branch>`,
	 * passing an explicit `--title`/`--body` when the caller supplied them (the
	 * synthesised single-line title + the agent's summary body) and falling back to
	 * `--fill` ONLY when BOTH are absent (today's behaviour — no regression). A
	 * partial set (one present) still drops `--fill`: `--fill` and an explicit
	 * `--title`/`--body` are mutually exclusive to `gh`, so once we override either
	 * field we must supply both explicitly (the other defaults to the slug-derived
	 * title / an empty body rather than re-deriving a run-on subject). The branch
	 * is GUARANTEED to be on the arbiter already (the push is the seam's safety-
	 * bearing step), so any `gh` failure is non-fatal: we fall back to the same
	 * manual-instructions result the `none` provider returns. On success we parse
	 * the PR URL `gh` prints and surface it (recorded by the caller into the job
	 * record / `status`).
	 */
	async openRequest(input: OpenRequestInput): Promise<OpenRequestResult> {
		const args = [
			'pr',
			'create',
			'--base',
			this.base,
			'--head',
			input.branch,
			...prCreateContentArgs(input),
		];

		// First attempt. A non-zero / missing `gh` can mean two VERY different things:
		//   - DETERMINISTIC: `gh` is missing or unauthenticated — retrying is pointless
		//     (every attempt fails identically); degrade IMMEDIATELY (today's
		//     behaviour, no wasted backoff).
		//   - TRANSIENT (OUTAGE): `gh` is present + authed but the network/API is down
		//     — RETRY with bounded backoff (the same shared helper the push uses)
		//     before degrading. This is a LOW-severity mode: the branch is already
		//     pushed (the seam's safety step), so the work is safe — only the review
		//     surface is missing. We do NOT gate requeue on it.
		const first = this.runGh(args, input.cwd, input.env);
		if (first !== undefined && first.status === 0) {
			return this.parseOpened(input, first);
		}

		// Failed once — distinguish DETERMINISTIC (missing/unauth) from a TRANSIENT
		// outage by an availability probe. Missing/unauth ⇒ degrade now (no retry).
		// Thread the FAILED first attempt so the degrade surfaces the REAL `gh` cause
		// (its stderr / the missing-binary detail), not a hard-coded auth guess.
		if (!this.available(input.cwd, input.env)) {
			return this.degrade(input, 'unavailable', first);
		}

		// `gh` IS available but the create failed — a transient outage. Retry the
		// create with bounded backoff before a clean give-up into the OUTAGE degrade.
		const attempt = await retryWithBackoff(
			async () => {
				const r = this.runGh(args, input.cwd, input.env);
				if (r !== undefined && r.status === 0) {
					return {ok: true as const, value: r};
				}
				return {
					ok: false as const,
					error: r?.stderr.trim() || 'gh pr create failed',
				};
			},
			{sleep: input.sleep ?? realSleep, ...input.backoff},
		);
		if (!attempt.ok) {
			return this.degrade(input, 'outage');
		}
		return this.parseOpened(input, attempt.value);
	}

	/** Map a successful `gh pr create` RunResult to an OpenRequestResult. */
	private parseOpened(
		input: OpenRequestInput,
		result: RunResult,
	): OpenRequestResult {
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
	 * Post a follow-up COMMENT on an already-opened PR via
	 * `gh pr comment <url> --body <text>` (slice `review-gate-pr-comment`),
	 * threading the PR by the `url` {@link openRequest} returned. The PR already
	 * exists (this runs AFTER the propose integrate), so any `gh` failure is
	 * non-fatal: a missing/unauthenticated `gh` DEGRADES to the same surface-the-
	 * text result the `none` provider returns — NEVER throws (ADR §6). The comment
	 * is ADVISORY: it changes no gate/verdict/merge logic. NEVER `--force`s.
	 */
	postPRComment(input: PostPRCommentInput): PostPRCommentResult {
		const result = this.runGh(
			['pr', 'comment', input.url, '--body', input.body],
			input.cwd,
			input.env,
		);
		// gh missing (spawn failed) OR non-zero exit (e.g. unauthenticated): the PR
		// already exists and the review is in the run output, so degrade gracefully
		// — NEVER throw (the comment is advisory; a failure must not lose work).
		if (result === undefined || result.status !== 0) {
			// Surface the REAL `gh` cause (its stderr, with the missing-binary special
			// case) — NOT a hard-coded "unavailable or unauthenticated" guess that sends
			// the operator chasing a phantom auth problem (mirrors `issue-provider.ts`).
			const reason = ghFailureDetail(result);
			return {
				posted: false,
				instruction:
					`${reason} The review was not posted as a comment on ` +
					`${input.url}. The review:\n${input.body}`,
			};
		}
		return {
			posted: true,
			instruction: `Posted the review as a comment on ${input.url}.`,
		};
	}

	/**
	 * Post the review comment by RESOLVING the PR from the pushed `work/<slug>`
	 * BRANCH (slice `review-comment-fallback-on-unparsed-pr-url`), the FALLBACK for
	 * when `gh pr create` opened a PR (exit 0) but its stdout url was unparseable so
	 * {@link openRequest} returned `{opened: true}` with NO `url`. We first RESOLVE
	 * the open PR's url from the branch (`gh pr view <branch> --json url --jq .url`):
	 *
	 *  - a url comes back ⇒ a PR genuinely exists — post the comment on it via the
	 *    url-keyed {@link postPRComment} (the audit trail is preserved);
	 *  - nothing resolvable (no PR for the branch, or `gh` missing/unauthenticated)
	 *    ⇒ an HONEST clean no-op (`posted: false`) — but only AFTER trying. The
	 *    "no PR ⇒ no comment" rule holds; what changes is we no longer drop the
	 *    comment when a PR DID open.
	 *
	 * Resolving the url first (rather than commenting on the branch directly) keeps
	 * the no-PR case a deterministic no-op and reuses the exact same comment
	 * mechanics as the url path. NEVER throws, NEVER `--force`s (ADR §6).
	 */
	postPRCommentOnBranch(
		input: PostPRCommentOnBranchInput,
	): PostPRCommentResult {
		const url = this.resolvePrUrlForBranch(input.branch, input.cwd, input.env);
		if (url === undefined) {
			// No PR resolvable from the branch (truly none, or `gh` unavailable): an
			// honest no-op — but only after trying. Surface the review text so it is
			// never lost; nothing was posted.
			return {
				posted: false,
				instruction:
					`No open PR could be resolved for ${input.branch}, so the review ` +
					`was not posted as a comment. The review:\n${input.body}`,
			};
		}
		// A PR genuinely exists for the branch — comment on it via the url path.
		return this.postPRComment({
			cwd: input.cwd,
			url,
			body: input.body,
			env: input.env,
		});
	}

	/**
	 * Resolve the open PR's url for `branch` via `gh pr view <branch> --json url
	 * --jq .url`, or `undefined` when no PR is found / `gh` is missing or
	 * unauthenticated (a non-zero exit or a spawn failure). Read-only; mutates
	 * nothing. The result is parsed for a PR url (any surrounding chatter ignored)
	 * so a stray warning line never defeats the resolution.
	 */
	private resolvePrUrlForBranch(
		branch: string,
		cwd: string,
		env: NodeJS.ProcessEnv | undefined,
	): string | undefined {
		const result = this.runGh(
			['pr', 'view', branch, '--json', 'url', '--jq', '.url'],
			cwd,
			env,
		);
		if (result === undefined || result.status !== 0) {
			return undefined; // no PR for the branch, or gh missing/unauthenticated
		}
		return parsePrUrl(result.stdout);
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

	/**
	 * The graceful-degradation result (identical SHAPE to the `none` provider's):
	 * the branch is already pushed (safe), only the PR is missing. The `reason`
	 * distinguishes the two LOW-severity degrade causes so the operator knows what
	 * to do: `unavailable` (`gh` missing/unauth — fix `gh`/auth) vs `outage`
	 * (transient network/API failure that survived the bounded retry — just re-run
	 * / open it manually). Both print the SAME manual `gh pr create` suggestion.
	 */
	private degrade(
		input: OpenRequestInput,
		reason: 'unavailable' | 'outage',
		/**
		 * The FAILED `gh pr create` result that triggered the `unavailable` degrade
		 * (`undefined` = `gh` binary missing). Threaded in so the `unavailable` arm
		 * surfaces the REAL cause rather than a hard-coded auth guess. The `outage`
		 * arm does not need it (its wording is already honest about the retried
		 * transient failure).
		 */
		result?: RunResult,
	): OpenRequestResult {
		// Echo the explicit title/body in the suggested manual command when present,
		// so a human opening the PR by hand reuses the same content the autonomous
		// path would have set (else fall back to the bare `--fill` suggestion).
		const contentArgs = prCreateContentArgs(input);
		const suggestion =
			`gh pr create --base ${this.base} --head ${input.branch} ${contentArgs.join(' ')}`.trim();
		const cause =
			reason === 'outage'
				? '`gh pr create` failed after retries (a transient outage), so no PR ' +
					'was opened — the branch is pushed and the work is SAFE; re-run or ' +
					'open one manually, e.g. '
				: // Surface the REAL `gh` cause (its stderr, with the missing-binary
					// special case) — NOT a hard-coded "unavailable or unauthenticated"
					// guess (mirrors `issue-provider.ts`).
					`${ghFailureDetail(result)} No PR was opened — open one manually, e.g. `;
		return {
			opened: false,
			instruction:
				`Pushed ${input.branch} to ${input.arbiter}. ${cause}` +
				`\`${suggestion}\`.` +
				manualRequestText(input),
		};
	}
}

/**
 * The CONTENT args for `gh pr create`: an explicit `--title`/`--body` when the
 * caller supplied either (a partial set is completed so `--fill` is never mixed
 * with an explicit field — `gh` forbids that), else the lone `--fill` (today's
 * behaviour, no regression). Returned as a flat arg array so both the live
 * invocation and the degraded suggestion build from one source of truth.
 */
export function prCreateContentArgs(input: {
	title?: string;
	body?: string;
}): string[] {
	if (input.title === undefined && input.body === undefined) {
		return ['--fill'];
	}
	return ['--title', input.title ?? '', '--body', input.body ?? ''];
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
