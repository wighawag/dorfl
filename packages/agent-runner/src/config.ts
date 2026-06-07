import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {brand} from './brand.js';

/**
 * How a completed item is integrated back to the arbiter's `main`. `merge` lands
 * it directly on `main` (ff/rebase + push); `propose` pushes a branch + requests
 * review. (`propose` is provider-neutral; the old `pr` name was GitHub jargon.
 * See ADR §6.)
 */
export type IntegrationMode = 'propose' | 'merge';

/**
 * Which harness adapter (ADR §5) launches a job's agent and reports its
 * liveness: `null` (shell out to `agentCmd`) or `pi` (the pi CLI). Selected via
 * the `harness` config field; defaults to `null`.
 */
export type HarnessAdapter = 'null' | 'pi';

/**
 * The `propose`-mode review-request provider (ADR §6): `github` (`gh pr
 * create`) or `none` (push-only + manual instructions). Normally LEFT UNSET so
 * it auto-detects from the arbiter URL (a GitHub remote ⇒ `github`, else
 * `none`); set it to force a provider (override detection). `merge` mode is
 * provider-agnostic and ignores this.
 */
export type ReviewProviderName = 'none' | 'github';

/**
 * The per-repo acceptance gate: a single shell command, or an ordered list of
 * commands run in sequence (all must pass). See `verify.ts` / ADR §8.
 */
export type VerifyConfig = string | string[];

/**
 * Resolved runner configuration. There is NO `roots`/`remotes` field: discovery
 * is the registered hub-mirror set under `<workspacesDir>/repos/` (the registry,
 * ADR `command-surface-and-journeys` §1), NOT a config roots walk. `scan` reads
 * the eligibility fields per repo; `run --once` additionally consumes the
 * execution fields (maxParallel, perRepoMax, defaultArbiter, integration,
 * agentCmd).
 */
export interface Config {
	/**
	 * Per-repo policy: may agents claim *undeclared* (not `humanOnly`) slices in
	 * this repo? `false` (default, strict) ⇒ agents claim nothing automatically;
	 * `true` ⇒ agents may claim any slice that is not `humanOnly: true`. Resolved
	 * like `integration`: flag (`--allow-agents`/`--no-allow-agents`) > per-repo >
	 * global > default.
	 */
	allowAgents: boolean;
	/**
	 * Per-repo policy: may an agent auto-slice *undeclared* (not `humanOnly`,
	 * no open questions) PRDs in this repo? `false` (default, strict, human-first)
	 * ⇒ a human must drive every PRD's slicing; `true` ⇒ an agent may auto-slice
	 * any PRD that is not `humanOnly: true` and has no `needsAnswers`. Resolved like
	 * `allowAgents`: flag > `AGENT_RUNNER_AUTO_SLICE` env > per-repo > global >
	 * default. The two-axis slicing gate (`work/prd/auto-slice.md`), one level up
	 * from the build gate's `allowAgents`.
	 */
	autoSlice: boolean;
	/** Global cap on how many items the runner claims+runs in one tick. */
	maxParallel: number;
	/** Per-repo cap on concurrent claims (≤ maxParallel in effect). */
	perRepoMax: number;
	/** Name of the git remote that serializes claims (the arbiter). */
	defaultArbiter: string;
	/**
	 * The execution working area: bare hub mirrors (`<dir>/repos/<key>.git`) and
	 * job worktrees (`<dir>/work/<work-id>/`). STATE, not cache (ADR §3) — lives
	 * under a single visible `~/.agent-runner/`, NEVER `~/.cache`. Overridable so
	 * tests (and unusual setups) can relocate it.
	 */
	workspacesDir: string;
	/**
	 * Where local `--bare` arbiters (offline source of truth) are provisioned:
	 * `<dir>/<host>/<org>/<name>.git` (hierarchical, reusing the repo→key
	 * encoding). Arbiters are precious DATA, not state/cache (ADR §7): they live
	 * under a visible `~/git/` and MUST NEVER be placed under `~/.agent-runner/`
	 * (a `gc`/cleanup mishap could nuke the only copy). Overridable so tests can
	 * relocate it.
	 */
	arbitersDir: string;
	/**
	 * Where the HUMAN `work-on` command checks out its parallel worktrees:
	 * `<dir>/<key>/<slug>/` on branch `work/<slug>`. This is a **human-only**,
	 * editor-facing area — deliberately NOT under `~/.agent-runner/` (the agents'
	 * execution state, ADR §3), so a `work-on` worktree never carries the human's
	 * secrets into an agent context. It is intentionally OPTIONAL with **no silent
	 * default**: `work-on` prompts for it on first use and saves it here (offering a
	 * sensible suggestion that does NOT share a prefix with the user's code dirs, so
	 * shell tab-completion never collides). `undefined` ⇒ not yet configured.
	 */
	humanWorktreesDir?: string;
	/** Integration mode for completed items: `propose` (default) or `merge`. */
	integration: IntegrationMode;
	/**
	 * The `propose`-mode review-request provider (ADR §6). Optional with NO
	 * default so "unset" is distinguishable from an explicit value: unset ⇒
	 * auto-detect from the arbiter URL (GitHub remote ⇒ `github`, else `none`);
	 * an explicit `github`/`none` OVERRIDES detection. `merge` mode ignores it
	 * (provider-agnostic git). The core never imports `gh`; only the GitHub
	 * adapter shells out to it.
	 */
	provider?: ReviewProviderName;
	/**
	 * The command the runner shells out to for one slice. The runner appends the
	 * built prompt on stdin; the command does NO git ops on the repo (the runner
	 * owns those). Empty string ⇒ no agent configured (run will refuse). Consumed
	 * by the **null** harness adapter (it shells out to this verbatim); the **pi**
	 * adapter ignores it (it invokes the pi CLI directly — see `harness`).
	 */
	agentCmd: string;
	/**
	 * The model a job's agent runs on (harness-agnostic ROUTING intent, ADR §13).
	 * agent-runner decides WHICH model; it never touches auth/keys (those stay the
	 * harness's job). Optional with NO default so "unset" is meaningful: unset ⇒
	 * agent-runner forces no model (the harness's own default / a model baked into
	 * `agentCmd` is used untouched). Carried through the harness seam
	 * (`LaunchInput.model`); the ADAPTER decides HOW it reaches its tool — the pi
	 * adapter passes `--model <model>` natively, the null/shell adapter substitutes
	 * a `{model}` placeholder in `agentCmd`. Resolved per-repo like `integration`:
	 * flag (`--model`) > env > per-repo > global > default (unset).
	 */
	model?: string;
	/**
	 * Which harness adapter launches + reports liveness for a job's agent (the
	 * harness seam, ADR §5): `null` (default — shells out to `agentCmd`,
	 * PID-only liveness) or `pi` (invokes the pi CLI with the work-agent prompt;
	 * liveness from PID + the pi session dir/log, never mtime). pi specifics stay
	 * behind the adapter; the core only sees the `Harness` interface.
	 */
	harness?: HarnessAdapter;
	/**
	 * The pi CLI binary the `pi` harness invokes (default `pi` on `PATH`).
	 * Overridable so an operator can pin a path; tests stub it. Ignored unless
	 * `harness` is `pi`.
	 */
	piBin?: string;
	/**
	 * The ROOT folder under which the runner generates a job's pi session FILE —
	 * the adapter passes `--session <sessionsDir>/<unique-id>.jsonl` (a literal
	 * file path pi creates + writes; never `--session-dir`). A **HOST-ONLY machine
	 * path** (same class as `piBin`/`workspacesDir`): resolved flag (`--sessions-
	 * dir`) > env (`AGENT_RUNNER_SESSIONS_DIR`) > global > default — there is NO
	 * per-repo layer (a committed repo file must not redirect where the host writes
	 * session logs), so it is in `REPO_REJECTED_KEYS`. Optional with a DYNAMIC
	 * default (NOT a `DEFAULT_CONFIG` entry): unset ⇒ the path generator derives
	 * pi's default per-cwd sessions folder at launch from the job cwd (a direct
	 * child of `~/.pi/agent/sessions/`, so the dashboard's non-recursive `listAll`
	 * scans it). Set ⇒ any folder (e.g. a dedicated `run` fleet folder).
	 */
	sessionsDir?: string;
	/**
	 * The per-repo acceptance gate run by `agent-runner verify` (a deterministic
	 * shell command, or an ordered list of commands). NOT per-slice and NOT model-
	 * interpreted — it is declared, auditable config (ADR §8). Unset (omitted) ⇒
	 * a sensible `pnpm -r build && test && format:check` default; the field is
	 * intentionally optional so "unset" is distinguishable from "empty".
	 */
	verify?: VerifyConfig;
	/**
	 * **Gate 2 — the PR/code review gate** (GATES PRD `work/prd/review.md`): run the
	 * `review` SKILL as a fresh-context judgement gate ON TOP of the deterministic
	 * `verify` floor, AFTER `verify` passes and BEFORE the done-move, on the
	 * `do`/`complete` path. Default **OFF** (it puts a model on the merge path —
	 * opt-in, ADR §8). Resolved per-repo like `integration`: flag
	 * (`--review`/`--no-review`) > env > per-repo > global > default false.
	 * `verify` is never replaced — review is layered, never a substitute.
	 */
	review: boolean;
	/**
	 * On a Gate-2 `approve`, allow the resolved `merge` integration to proceed
	 * AUTONOMOUSLY. Default **OFF**. **Repo policy only** (the `do`-path author is
	 * the operator who ran the command — no author-trust resolver here; that is the
	 * `issue-intake` concern, decoupled). A non-`approve` verdict NEVER auto-merges
	 * regardless. With `review` on but `autoMerge` off, review still gates
	 * (block/approve) but a human does the merge (`--propose` semantics). Resolved
	 * like `integration`: flag (`--auto-merge`/`--no-auto-merge`) > env > per-repo >
	 * global > default false.
	 */
	autoMerge: boolean;
	/**
	 * The model the REVIEW agent runs on (de-correlation from the builder's
	 * `model`). Optional with NO default so "unset" means "no forced review model"
	 * (the harness's own default). Carried to the review-agent launch through the
	 * EXISTING harness seam (`LaunchInput.model` / `substituteModel`) — NOT a new
	 * mechanism. Resolved like `model`: flag (`--review-model`) > env > per-repo >
	 * global > default (unset). Distinct from the builder's `model`.
	 */
	reviewModel?: string;
	/**
	 * Bound the revise↔review loop (Gate 2). On exhaustion the gate ERRORS OUT and
	 * forces `needs-attention/` (never silently merges or loops), per the maintainer
	 * decision. Default a small N (2). Resolved like `integration`: flag
	 * (`--review-max-rounds`) > env > per-repo > global > default.
	 */
	reviewMaxRounds: number;
}

/** A partial config, e.g. loaded from a JSON file or built from CLI flags. */
export type PartialConfig = Partial<Config>;

/**
 * Built-in defaults. Chosen so that zero-config is useful: stay strict about the
 * autonomy gate (agents claim nothing unless a repo opts in via `allowAgents`).
 * Discovery has no default `roots` — it is the registered hub-mirror set (empty
 * until `remote add`/`remote find` registers a target).
 */
export const DEFAULT_CONFIG: Config = {
	allowAgents: false,
	// Auto-slicing is human-first by default: an agent slices nothing unless a
	// repo opts in via `autoSlice` (mirrors `allowAgents`, one level up).
	autoSlice: false,
	maxParallel: 4,
	perRepoMax: 2,
	defaultArbiter: 'origin',
	workspacesDir: join(homedir(), brand.workdirName),
	arbitersDir: join(homedir(), 'git'),
	integration: 'propose',
	agentCmd: '',
	// Gate 2 (PR/code review) defaults OFF — it puts a model on the merge path, so
	// it is opt-in (ADR §8); its auto-merge sub-policy is OFF too. The loop bound is
	// a small N so an unattended revise↔review can never run forever.
	review: false,
	autoMerge: false,
	reviewMaxRounds: 2,
};

/** The conventional config location (`~/.config/agent-runner/config.json`). */
export function defaultConfigPath(): string {
	return join(homedir(), '.config', brand.configDirName, 'config.json');
}

/** Merge a partial config over the built-in defaults; arrays are replaced. */
export function mergeConfig(overrides: PartialConfig): Config {
	const merged: Config = {...DEFAULT_CONFIG};
	// Iterate the override's own keys (not the defaults') so optional keys like
	// `verify` (absent from DEFAULT_CONFIG, left unset by design) are carried over.
	for (const key of Object.keys(overrides) as (keyof Config)[]) {
		const value = overrides[key];
		if (value !== undefined) {
			// Assign through `unknown`: each key's value type matches by construction.
			(merged as Record<keyof Config, unknown>)[key] = value;
		}
	}
	return merged;
}

/**
 * Persist `config` to `path` as pretty JSON (creating the parent dir). Used by
 * `work-on` to SAVE the prompted `humanWorktreesDir` on first use so the human is
 * never asked again. Only the keys present in `config` are written — we round-trip
 * whatever the loader produced (defaults + file + the new key), which keeps the
 * on-disk file explicit and stable.
 */
export function saveConfig(config: PartialConfig, path: string): void {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Load config from `path`, merged over defaults. A missing file is not an error
 * (defaults make the tool work out of the box); invalid JSON is.
 */
export function loadConfig(path: string = defaultConfigPath()): Config {
	if (!existsSync(path)) {
		return mergeConfig({});
	}
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (err) {
		throw new Error(
			`Failed to read config at ${path}: ${(err as Error).message}`,
		);
	}
	let parsed: PartialConfig;
	try {
		parsed = JSON.parse(raw) as PartialConfig;
	} catch (err) {
		throw new Error(
			`Invalid JSON in config at ${path}: ${(err as Error).message}`,
		);
	}
	return mergeConfig(parsed);
}
