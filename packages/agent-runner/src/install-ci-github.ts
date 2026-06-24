/**
 * The thin GitHub adapter for `install-ci` (prd `runner-in-ci`, task
 * `install-ci-core-and-github-adapter`). It plugs into the provider-agnostic
 * {@link CIProviderContext} seam from `install-ci-core.ts`: the core owns the
 * wizard / config / `models.json` / `--export-config` / `--fake` / secret
 * orchestration; THIS adapter only supplies the GitHub-specific I/O (repo
 * detection, `gh secret set`, the optional `delete_branch_on_merge` repo
 * setting). Because the seam is the boundary, a second CI provider could be added
 * WITHOUT touching the core (US #7/#10).
 *
 * `install-ci` uses the SEAMS, never `gh` directly in the core: this adapter is
 * the ONLY place that shells out to `gh`, and it does so behind the seam so tests
 * stub it entirely (no network, no real `gh`, no real GitHub repo detection). The
 * adapter NEVER `--force`s and degrades gracefully when `gh` is missing.
 */

import {run, type RunResult} from './git.js';
import {DEFAULT_GH_BIN} from './github.js';
import type {CIProviderContext} from './install-ci-core.js';

/** Options for the live GitHub provider context. */
export interface GitHubCIContextOptions {
	/** The target repo's working directory. */
	workDir: string;
	/** The `owner/repo` slug; auto-detected via `gh` when omitted. */
	repo?: string;
	/** The `gh` CLI binary (default `gh` on PATH). Tests inject a stub. */
	ghBin?: string;
	/** Environment for the `gh` child. */
	env?: NodeJS.ProcessEnv;
}

/**
 * The live GitHub provider context: detects the repo + availability via `gh` and
 * sets secrets via `gh secret set`. This is the PRODUCTION seam implementation;
 * tests use a STUB context instead (see {@link MemoryCIProviderContext}). It
 * NEVER `--force`s and treats a missing `gh` as `ghAvailable: false`.
 */
export class GitHubCIContext implements CIProviderContext {
	readonly workDir: string;
	repo: string | undefined;
	readonly ghAvailable: boolean;
	private readonly ghBin: string;
	private readonly env: NodeJS.ProcessEnv | undefined;

	constructor(options: GitHubCIContextOptions) {
		this.workDir = options.workDir;
		this.ghBin = options.ghBin ?? DEFAULT_GH_BIN;
		this.env = options.env;
		this.ghAvailable = this.probeAvailable();
		this.repo = options.repo ?? this.detectRepo();
	}

	/** Is `gh` available + authenticated? (`gh auth status` exits 0 when so.) */
	private probeAvailable(): boolean {
		const result = this.runGh(['auth', 'status']);
		return result !== undefined && result.status === 0;
	}

	/** Detect `owner/repo` via `gh repo view`, or `undefined` when unavailable. */
	private detectRepo(): string | undefined {
		if (!this.ghAvailable) {
			return undefined;
		}
		const result = this.runGh([
			'repo',
			'view',
			'--json',
			'nameWithOwner',
			'--jq',
			'.nameWithOwner',
		]);
		if (result === undefined || result.status !== 0) {
			return undefined;
		}
		const slug = result.stdout.trim();
		return slug === '' ? undefined : slug;
	}

	/** Set a secret via `gh secret set <name> --body <value>`. Throws on failure. */
	async setSecret(name: string, value: string): Promise<void> {
		const args = ['secret', 'set', name, '--body', value];
		if (this.repo) {
			args.push('--repo', this.repo);
		}
		const result = this.runGh(args);
		if (result === undefined) {
			throw new Error(`gh not available; cannot set secret ${name}`);
		}
		if (result.status !== 0) {
			throw new Error(
				`gh secret set ${name} failed: ${result.stderr.trim() || 'unknown error'}`,
			);
		}
	}

	/**
	 * Set a GitHub repo-setting (the capability-F residue: `delete_branch_on_merge`)
	 * via `gh api -X PATCH repos/<repo> -f <name>=<value>`. Throws on failure. The
	 * wizard prompts before calling this — it is NEVER silently toggled.
	 */
	async setRepoSetting(name: string, value: boolean): Promise<void> {
		if (!this.repo) {
			throw new Error(`cannot set repo setting ${name}: repo unknown`);
		}
		const result = this.runGh([
			'api',
			'-X',
			'PATCH',
			`repos/${this.repo}`,
			'-f',
			`${name}=${value}`,
		]);
		if (result === undefined) {
			throw new Error(`gh not available; cannot set repo setting ${name}`);
		}
		if (result.status !== 0) {
			throw new Error(
				`gh api PATCH repos/${this.repo} ${name}=${value} failed: ` +
					(result.stderr.trim() || 'unknown error'),
			);
		}
	}

	/** Run `gh <args>` in workDir, or `undefined` when `gh` cannot be spawned. */
	private runGh(args: string[]): RunResult | undefined {
		try {
			return run(this.ghBin, args, this.workDir, {env: this.env});
		} catch {
			return undefined;
		}
	}
}

/**
 * An in-memory STUB provider context for tests + `--fake` mode: `setSecret`
 * records to memory (NO real secrets store touched), `ghAvailable` is fixed
 * (default `false`), `repo` is a fixture. This is the mechanism the task's
 * shared-write isolation requires — no network, no real `gh`, no real GitHub, no
 * real `~`, no system git config written.
 */
export class MemoryCIProviderContext implements CIProviderContext {
	readonly workDir: string;
	repo: string | undefined;
	readonly ghAvailable: boolean;
	/** Secrets recorded in memory (name → value). */
	readonly secrets = new Map<string, string>();
	/** Repo settings recorded in memory (name → value). */
	readonly repoSettings = new Map<string, boolean>();

	constructor(options: {
		workDir: string;
		repo?: string;
		ghAvailable?: boolean;
	}) {
		this.workDir = options.workDir;
		this.repo = options.repo;
		this.ghAvailable = options.ghAvailable ?? false;
	}

	async setSecret(name: string, value: string): Promise<void> {
		this.secrets.set(name, value);
	}

	async setRepoSetting(name: string, value: boolean): Promise<void> {
		this.repoSettings.set(name, value);
	}
}
