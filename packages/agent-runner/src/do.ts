import {performStart} from './start.js';
import {performComplete} from './complete.js';
import {resolveSlug, SlugResolutionError} from './slug-namespace.js';
import {resolveSlice, buildAgentPrompt, PromptError} from './prompt.js';
import {NullHarness, type Harness} from './harness.js';
import {PiHarness, piSessionDir} from './pi-harness.js';
import {SessionTailer} from './watch-session.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import type {IntegrationMode, ReviewProviderName} from './config.js';
import type {VerifyConfig} from './verify.js';
import {runAsync} from './git.js';

/**
 * `agent-runner do <slug>` (in-place form) — the per-repo, in-place WORKER that
 * claims + builds + gates + integrates in ONE checkout, then EXITS (ADR §3).
 * **This is the CI command** (CI has a checkout, is one repo, is one triggered
 * invocation, exits) and it ABSORBS the manual `ar-run.sh` test-driver.
 *
 * The in-place `do` is exactly `ar-run.sh`'s composition — `start` →
 * (autonomous prompt-fed harness run) → `complete` — guarded by a DIRTY-TREE
 * REFUSAL. It does NOT fork a third pipeline: it COMPOSES the existing human
 * verbs (which already do the dirty-guard-adjacent onboarding, branch switch,
 * gate, integrate, and branch tidy), with the autonomous agent invocation as the
 * ONLY new middle step. The runner owns EVERY git-state transition (claim,
 * done-move, completion commit, integration); the agent only edits code.
 *
 * The in-place ISOLATION (ADR §3): the current checkout / CI container IS the
 * isolation — no hub mirror, no external worktree. `performStart` puts the
 * checkout on `work/<slug>` cut from the freshly-fetched `<arbiter>/main` (the
 * isolation-strategy-seam's in-place strategy is the seam form of this same
 * "switch the checkout to work/<slug>" step; composing `start` reuses it
 * directly with the claim + dirty-aware onboarding already wired). `do --remote`
 * (the job-worktree strategy) is the SEPARATE `do-remote` slice; auto-pick /
 * multi-arg / `-n` is `do-autopick`.
 *
 * **CRITICAL — `do` is AUTONOMOUS, so its failure path is `run`'s, NOT
 * `complete`'s.** On a red gate / rebase conflict, `performComplete` routes the
 * item to needs-attention via the SAME seam call as `run`'s `runOneItem`, but
 * `complete` calls it WITHOUT an arbiter (the human path: a human is right
 * there). `do` runs UNATTENDED, so it MUST get the autonomous, arbiter-passed
 * surfacing like `run` (the on-`main` cherry-pick that makes a stuck CI run
 * visible to `scan`/`status`/another machine). We achieve this by passing
 * `surfaceArbiter` into `performComplete` (resolution (a) from the slice): the
 * success path reuses `complete`'s machinery; only the NEEDS-ATTENTION routing
 * becomes the autonomous variant.
 *
 * `--propose` (default) / `--merge` is resolved at integrate-time exactly like
 * `complete` (the caller threads the resolved mode in as `integration`).
 */

/** The terminal status of one in-place `do` run. */
export type DoOutcome =
	| 'completed' // claimed/onboarded → agent → gate green → integrated → exited
	| 'lost' // claim lost the race — skipped cleanly
	| 'contended' // claim push kept being rejected
	| 'needs-attention' // red gate / rebase conflict → surfaced (autonomous)
	| 'agent-failed' // the agent invocation itself errored before the gate
	| 'refused' // refused (dirty tree, wrong folder, nothing to complete, …)
	| 'usage-error' // usage / environment problem, or a slug-resolution error
	| 'prd-not-wired'; // `do prd:<slug>` — the slicing path is not built yet

export interface DoResult {
	exitCode: 0 | 1 | 2 | 3;
	outcome: DoOutcome;
	/** The resolved bare slug acted on (slice or PRD), when one was resolved. */
	slug?: string;
	/** The work branch the run operated on, when one was created/switched-to. */
	branch?: string;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/** The agent invocation: edits code in `cwd` to satisfy the prompt. */
export type DoAgentRunner = (input: {
	cwd: string;
	prompt: string;
	slug: string;
	env?: NodeJS.ProcessEnv;
}) => {ok: boolean; detail?: string};

export interface DoOptions {
	/** The raw CLI slug argument: bare (= slice), `slice:<slug>`, or `prd:<slug>`. */
	arg: string;
	/** The working clone/checkout to run in-place in. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/** Integration mode resolved at integrate-time (flag > per-repo > global > default). */
	integration?: IntegrationMode;
	/** The declared per-repo acceptance gate (string | list). */
	verify?: VerifyConfig;
	/** Review-request provider override (propose mode); auto-detect when unset. */
	provider?: ReviewProviderName;
	/**
	 * The autonomous agent invocation. Tests inject this to edit files directly;
	 * production wires the harness seam (the prompt-fed, run-to-completion launch
	 * `run` uses). When omitted, {@link harness} is used.
	 */
	agentRunner?: DoAgentRunner;
	/** The harness seam used when `agentRunner` is omitted; defaults to the null adapter. */
	harness?: Harness;
	/**
	 * `do --watch`: stream the agent's high-signal events live by tailing the pi
	 * session `.jsonl` (slice `do-watch`, option (a)). A READ-ONLY observer — it
	 * NEVER changes the run's outcome, gate, integration, git, or exit code; only a
	 * concurrent log-tail is added. REQUIRES the pi harness (the null adapter has
	 * no session log to tail) — passing it with a non-pi harness is a usage error.
	 */
	watch?: boolean;
	/** The configured agent command the harness shells out to (null adapter). */
	agentCmd?: string;
	/** The model routing intent forwarded to the harness (ADR §13). */
	model?: string;
	/** Override the read seam (slug resolution); defaults to {@link ledgerRead}. */
	read?: LedgerReadStrategy;
	/** Override the resolver's repo path (slug-namespace existence reads). Defaults to `cwd`. */
	repoPath?: string;
	/** Environment for child git/agent processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
	/**
	 * Sink for a pre-formatted block printed VERBATIM (forwarded to `complete`'s
	 * propose-mode next-step block). Defaults to `note`.
	 */
	noteBlock?: (message: string) => void;
	/** Emit ANSI color in `complete`'s (cosmetic) propose next-step block. */
	color?: boolean;
	/**
	 * Where `--watch`'s tailed events are written (defaults to stderr). Tests inject
	 * a sink to assert the surfaced lines without a real terminal.
	 */
	watchSink?: (line: string) => void;
}

const DEFAULT_ARBITER = 'origin';

/**
 * Run the in-place `do` ritual end-to-end. Never throws for the expected
 * lost/contended/refused/needs-attention cases — those are returned with the
 * appropriate exit code and outcome. The runner owns all git; the agent only
 * edits code.
 */
export async function performDo(options: DoOptions): Promise<DoResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env;

	// 0. `--watch` REQUIRES the pi harness (slice `do-watch`): only the pi adapter
	//    writes a session `.jsonl` event log to tail. The null/shell adapter has no
	//    session log / event taxonomy, so there is nothing to observe — ERROR
	//    CLEARLY here, BEFORE any git transition (no claim, no branch), rather than
	//    silently running without the view. The injected `agentRunner` (tests /
	//    custom embeddings) is its own launch path and is exempt.
	if (
		options.watch === true &&
		options.agentRunner === undefined &&
		!(options.harness instanceof PiHarness)
	) {
		return {
			exitCode: 1,
			outcome: 'usage-error',
			message:
				'`do --watch` requires the pi harness; configure `harness: pi` or drop ' +
				'`--watch`.',
		};
	}

	// 1. Resolve the slug across BOTH namespaces — `do` is the ONE command that
	//    spans them (ADR §3a): bare → slice (after a no-PRD-collision check;
	//    ERROR on collision), `slice:`/`prd:` explicit. A collision / resolution
	//    failure is a loud usage error (exit 1).
	let resolved;
	try {
		resolved = resolveSlug({
			arg: options.arg,
			repoPath: options.repoPath ?? cwd,
			read: options.read ?? ledgerRead,
		});
	} catch (err) {
		if (err instanceof SlugResolutionError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}

	// 2. `do prd:<slug>` → the PRD-SLICING path. THIS slice only wires the
	//    resolver so `do` accepts + dispatches `prd:` correctly; the actual
	//    slicing orchestration is the reshaped `autoslice-command` slice (blocked
	//    on this one). Reach the slicing-path entry with a clear "not yet wired"
	//    stub — do NOT reimplement slicing here.
	if (resolved.namespace === 'prd') {
		const message =
			`'${resolved.slug}' is a PRD; \`do prd:${resolved.slug}\` would SLICE it, ` +
			'but the PRD-slicing path is not wired yet (it lands with the ' +
			'autoslice-command slice). Slice the PRD manually for now.';
		note(message);
		return {
			exitCode: 1,
			outcome: 'prd-not-wired',
			slug: resolved.slug,
			message,
		};
	}

	const slug = resolved.slug;

	// 3. Refuse on a DIRTY working tree (ar-run.sh's first guard). `do` runs in a
	//    REAL checkout (the human's clone / the CI container); it must NOT
	//    entangle unrelated work or run over uncommitted changes. (Mirrors the
	//    bash driver: "error: working tree is dirty — commit/stash before
	//    running a slice.")
	if (await isDirtyTree(cwd, env)) {
		const message =
			`working tree is dirty — commit or stash before running '${slug}' ` +
			'(do runs in-place in this checkout and will not entangle unrelated ' +
			'changes).';
		return {exitCode: 1, outcome: 'refused', slug, message};
	}

	// 4. Onboard like `start`: claim (only if needed) AND switch the checkout to
	//    work/<slug> off the freshly-fetched <arbiter>/main (the agent edits ON
	//    the work branch). A lost/contended claim is propagated verbatim and
	//    skipped cleanly — `do` never re-claims an in-progress item.
	const started = await performStart({slug, cwd, arbiter, env, note});
	if (started.outcome === 'lost') {
		return {exitCode: 2, outcome: 'lost', slug, message: started.message};
	}
	if (started.outcome === 'contended') {
		return {exitCode: 3, outcome: 'contended', slug, message: started.message};
	}
	if (started.exitCode !== 0) {
		// refused (in-progress without --resume, done/absent, not-ready) or a
		// usage/environment error: surface verbatim. `do` does not force-resume an
		// already-claimed item.
		const outcome: DoOutcome =
			started.outcome === 'refused' ? 'refused' : 'usage-error';
		return {exitCode: 1, outcome, slug, message: started.message};
	}
	const branch = started.branch;

	// 5. Run the agent autonomously in the checkout, ON the work branch — the
	//    SAME prompt assembly `agent-runner prompt` emits (canonical wrapper +
	//    source PRD + the slice's ## Prompt). The agent only edits code (it does
	//    no git). This is the one NEW middle step `ar-run.sh` shelled out for
	//    (`prompt | pi`).
	let prompt: string;
	try {
		const slice = resolveSlice(cwd, slug);
		prompt = buildAgentPrompt(slice.slug, slice.prd, slice.slicePrompt);
	} catch (err) {
		if (err instanceof PromptError) {
			return {
				exitCode: 1,
				outcome: 'agent-failed',
				slug,
				branch,
				message: err.message,
			};
		}
		throw err;
	}

	let agent: {ok: boolean; detail?: string};
	try {
		agent = await runDoAgent(options, cwd, prompt, slug);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'agent-failed', slug, branch, message};
	}
	if (!agent.ok) {
		const message = agent.detail ?? `the agent failed to build '${slug}'.`;
		return {exitCode: 1, outcome: 'agent-failed', slug, branch, message};
	}

	// 6. Gate + done-move + commit + rebase + integrate + branch-tidy LIKE
	//    `complete` — but with the AUTONOMOUS needs-attention surfacing (pass
	//    `surfaceArbiter` so a red gate / rebase conflict surfaces on the
	//    arbiter's main, cross-machine visible — a stuck CI `do` that only routed
	//    locally would be invisible). The success path reuses `complete`'s
	//    machinery unchanged.
	const completed = await performComplete({
		slug,
		cwd,
		arbiter,
		integration: options.integration,
		verify: options.verify,
		provider: options.provider,
		// The autonomous failure-surfacing: route stuck items to the arbiter's
		// main (the `run` semantics), NOT local-only (the human `complete`).
		surfaceArbiter: arbiter,
		color: options.color,
		note,
		noteBlock: options.noteBlock,
		env,
	});

	if (completed.outcome === 'completed') {
		return {
			exitCode: 0,
			outcome: 'completed',
			slug,
			branch,
			message: completed.message,
		};
	}
	if (
		completed.outcome === 'gate-failed' ||
		completed.outcome === 'rebase-conflict'
	) {
		// Red gate / rebase conflict — routed to needs-attention (surfaced on the
		// arbiter). The work did NOT complete; the runner owns the bounce.
		return {
			exitCode: 1,
			outcome: 'needs-attention',
			slug,
			branch,
			message: completed.message,
		};
	}
	// refused (nothing to commit, wrong folder) / usage-error: surface verbatim.
	const outcome: DoOutcome =
		completed.outcome === 'refused' ? 'refused' : 'usage-error';
	return {exitCode: 1, outcome, slug, branch, message: completed.message};
}

/**
 * Run the agent against the checkout. Prefers the injected `agentRunner` (tests
 * / custom embeddings); otherwise launches `agentCmd` through the harness seam
 * (the null adapter by default), forwarding the model routing intent.
 *
 * With `--watch` (pi harness only, validated earlier), the agent is launched
 * NON-BLOCKING (`PiHarness.launchAsync` — `spawn`, not `spawnSync`) so a
 * {@link SessionTailer} can READ the growing session `.jsonl` concurrently and
 * surface the high-signal events live. The tailer is a pure observer: the
 * launch result returned here is IDENTICAL to the non-watch path, so outcome /
 * gate / git / exit code are unchanged — only a concurrent log-tail is added.
 */
async function runDoAgent(
	options: DoOptions,
	cwd: string,
	prompt: string,
	slug: string,
): Promise<{ok: boolean; detail?: string}> {
	if (options.agentRunner) {
		return options.agentRunner({cwd, prompt, slug, env: options.env});
	}
	const harness = options.harness ?? new NullHarness();

	// `--watch` (pi only): launch async + tail the session .jsonl concurrently.
	// (The non-pi case is already rejected as a usage error before any git
	// transition, so reaching here with watch ⇒ a PiHarness.)
	if (options.watch === true && harness instanceof PiHarness) {
		const tailer = new SessionTailer({
			sessionDir: piSessionDir(cwd),
			color: options.color ?? false,
			sink: options.watchSink,
		});
		tailer.start();
		try {
			const launched = await harness.launchAsync({
				dir: cwd,
				slug,
				command: options.agentCmd ?? '',
				prompt,
				model: options.model,
				env: options.env,
			});
			return {ok: launched.ok, detail: launched.detail};
		} finally {
			// Always release the tailer (one final drain) — even on a launch error —
			// so the observer never outlives the run or leaks a handle.
			await tailer.stop();
		}
	}

	const launched = harness.launch({
		dir: cwd,
		slug,
		command: options.agentCmd ?? '',
		prompt,
		model: options.model,
		env: options.env,
	});
	return {ok: launched.ok, detail: launched.detail};
}

/**
 * True when the working tree has uncommitted (unstaged OR staged) changes — the
 * dirty-tree refusal predicate (ar-run.sh: `git diff --quiet` AND
 * `git diff --cached --quiet`). Read-only.
 */
async function isDirtyTree(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	const unstaged = await runAsync('git', ['diff', '--quiet'], cwd, {env});
	if (unstaged.status !== 0) {
		return true;
	}
	const staged = await runAsync('git', ['diff', '--cached', '--quiet'], cwd, {
		env,
	});
	return staged.status !== 0;
}
