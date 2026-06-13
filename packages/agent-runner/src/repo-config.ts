import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {mergeConfig, type Config, type PartialConfig} from './config.js';
import {envOverrides, type EnvMap} from './env-config.js';
import {brand} from './brand.js';

/**
 * The per-repo config layer.
 *
 * A repo may commit a `.agent-runner.json` at its root. It travels WITH the repo
 * (it is committed) and overrides the global `~/.config/agent-runner/config.json`
 * FOR THAT REPO ONLY — so repo-local properties (how this repo integrates, its
 * acceptance `verify` gate, which remote arbitrates its claims) are agreed by all
 * collaborators and agents rather than living in one person's global config.
 *
 * Resolution is per-key, highest wins:
 *
 *   flag (where a command offers one) > ENV (AGENT_RUNNER_*) > per-repo file >
 *   global > built-in default
 *
 * The mechanism is multi-repo aware: each repo resolves against its OWN
 * `.agent-runner.json`, so repo A can be `merge` while repo B is `propose` in the
 * SAME run (see {@link resolveRepoConfig}).
 *
 * Only keys that are genuinely repo properties are honoured in the COMMITTED
 * per-repo file. Runner/host-only keys (`piBin`, `agentCmd`, `maxParallel`, …)
 * describe the runner or the host machine, NOT a single repo;
 * if present in a per-repo file they are ignored and reported with a clear
 * message ({@link loadRepoConfig}).
 *
 * The sharpened host-only principle (ADR §13): **host-only keys must come from a
 * per-machine source — a CLI flag, an `AGENT_RUNNER_*` env var, or the global
 * config file — NEVER the committed repo file.** The allow/reject split below
 * therefore governs ONLY the committed repo file; env (a per-machine source like
 * the global file / a flag) may set ANY key, host-only included (see
 * {@link envOverrides}).
 *
 * A repo with no `.agent-runner.json` resolves to exactly the global config —
 * behaviour is unchanged from before this layer existed.
 */

/**
 * The conventional per-repo config filename, committed at the repo root. Derived
 * from the single brand identity (`.{base}.json`) so a rename flips it in lockstep
 * (see `brand.ts`).
 */
export const REPO_CONFIG_FILENAME = brand.repoConfigFilename;

/**
 * Config keys that are genuinely repo properties and so are honoured in a
 * per-repo `.agent-runner.json`. Deliberately a subset of {@link Config};
 * extend this list as more keys become legitimately repo-scoped.
 */
export const REPO_ALLOWED_KEYS = [
	'integration',
	'provider',
	'verify',
	'defaultArbiter',
	// `autoBuild` (may an agent auto-BUILD undeclared, not-`humanOnly` slices in
	// this repo?) is a genuine repo property — the build member of the symmetric
	// per-action gate family.
	'autoBuild',
	// `autoSlice` (may an agent auto-slice undeclared PRDs in this repo?) is a
	// genuine repo property — the slicing-autonomy mirror of `autoBuild`
	// (`work/prd/auto-slice.md`), resolved per-repo through the same chain.
	'autoSlice',
	// `autoTriage` (may an agent auto-disposition an observation in the conservative
	// no-question cases?) is a genuine repo property — the THIRD member of the flat
	// per-action gate family (PRD `advance-loop`), the observation-triage mirror of
	// `autoBuild`/`autoSlice`, resolved per-repo through the same chain.
	'autoTriage',
	// `prdsFirst` (does an auto-pick/-n/multi selection take sliceable PRDs before
	// eligible slices?) is a genuine repo property — the per-repo toggle ADR §3
	// specifies for the slices-first priority, resolved per-repo like `autoSlice`.
	'prdsFirst',
	// `model` (which model this repo's work runs on) and `harness` (which adapter)
	// are legitimate repo properties (ADR §13) — model is routing intent, not auth,
	// and a repo may prefer a given harness. `piBin`/`agentCmd` stay host-only
	// (machine paths/commands), so they are rejected below.
	'model',
	'harness',
	// Gate 2 (PR/code review) policy is a genuine repo property (GATES PRD
	// `work/prd/review.md`), resolved per-repo like `integration`/`autoBuild`:
	// whether this repo runs Gate 2 (`review`), whether an approve may auto-merge
	// (`autoMerge`), which model the review agent runs on (`reviewModel`), and the
	// revise↔review loop bound (`reviewMaxRounds`). `reviewModel` is routing intent
	// (not auth), so — like `model` — it is repo-appropriate, not host-only.
	'review',
	'autoMerge',
	'reviewModel',
	'reviewMaxRounds',
	// The slicer IMPROVER-loop family (`slicerLoop` on/off, `slicerLoopMax` hard
	// cap on in-context review passes, `slicerLoopModel` the loop reviewer's
	// de-correlated model) are genuine repo properties — like `review`/`reviewModel`
	// they tune the per-repo review discipline, resolved per-repo through the same
	// chain. They live on the LOOP (slice-generation review), not on a gate, and are
	// DISTINCT from the acceptance gate's `--review*` family.
	'slicerLoop',
	'slicerLoopMax',
	'slicerLoopModel',
] as const satisfies readonly (keyof Config)[];

/** A key honoured in a per-repo file. */
export type RepoAllowedKey = (typeof REPO_ALLOWED_KEYS)[number];

/**
 * Config keys that describe the RUNNER or the HOST machine, not a single repo,
 * and so are rejected (ignored + reported) in a per-repo file. These remain the
 * domain of the global config / CLI flags.
 */
export const REPO_REJECTED_KEYS = [
	'maxParallel',
	'perRepoMax',
	'agentCmd',
	// `piBin` is a machine PATH/command, not repo policy, so it is host-only and
	// rejected per-repo (ADR §13). It must come from a per-machine source — a
	// flag, an `AGENT_RUNNER_PI_BIN` env var, or the global file — never a
	// committed repo file. (`harness`, by contrast, is repo-appropriate and so is
	// deliberately NOT rejected.)
	'piBin',
	// `sessionsDir` is a machine PATH (where the host writes pi session logs), not
	// repo policy, so it is host-only and rejected per-repo: a committed repo file
	// must NOT redirect where the host writes sessions. It must come from a per-
	// machine source — a flag (`--sessions-dir`), `AGENT_RUNNER_SESSIONS_DIR`, or
	// the global file (exactly like `piBin`).
	'sessionsDir',
	// `identity` carries SECRETS (a `gh` token, an SSH key path) and is a per-
	// MACHINE concept (a bot's credentials), never repo policy — so a committed
	// repo file must NOT supply it. Host-only: it comes from the global config
	// only. Rejected per-repo (ADR identity §; same class as `piBin`).
	'identity',
	// Reserved/future host-only keys callers may name; rejected proactively so a
	// typo or a copy-pasted global config never silently leaks host policy into a
	// repo. (`humanWorktreesDir` is a planned host-only path.)
	'humanWorktreesDir',
] as const;

/** A key rejected from a per-repo file. */
export type RepoRejectedKey = (typeof REPO_REJECTED_KEYS)[number];

const ALLOWED_SET = new Set<string>(REPO_ALLOWED_KEYS);

/** The path to a repo's `.agent-runner.json` (repo root + filename). */
export function repoConfigPath(repoPath: string): string {
	return join(repoPath, REPO_CONFIG_FILENAME);
}

/** The result of reading (and filtering) a repo's `.agent-runner.json`. */
export interface LoadedRepoConfig {
	/** Where we looked (whether or not the file exists). */
	path: string;
	/**
	 * Only the repo-appropriate keys found in the file, ready to layer over the
	 * global config. Unknown and rejected keys are NOT present here.
	 */
	config: PartialConfig;
	/**
	 * Runner/host-only keys that WERE present in the file and were ignored. Empty
	 * when nothing was rejected.
	 */
	rejected: string[];
	/**
	 * A clear, human-facing message naming the rejected keys and the file they
	 * came from. `undefined` when nothing was rejected.
	 */
	message?: string;
}

/**
 * Read a repo's `.agent-runner.json` and split it into the honoured subset and
 * the rejected runner/host-only keys. A missing file is not an error (the repo
 * simply resolves to the global config); invalid JSON is. Unknown keys are
 * silently dropped (neither honoured nor reported as rejected). Only keys in
 * {@link REPO_ALLOWED_KEYS} are carried into `config`.
 */
export function loadRepoConfig(repoPath: string): LoadedRepoConfig {
	const path = repoConfigPath(repoPath);
	if (!existsSync(path)) {
		return {path, config: {}, rejected: []};
	}

	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (err) {
		throw new Error(`Failed to read ${path}: ${(err as Error).message}`);
	}

	return loadRepoConfigFromContent(raw, path);
}

/**
 * The content-based half of {@link loadRepoConfig}: parse + apply the SAME
 * allow/reject split to ALREADY-READ `.agent-runner.json` bytes, labelling the
 * source as `sourceLabel` (a path, or e.g. `<arbiter>/main:.agent-runner.json`)
 * in the rejected-key message. Used wherever the committed repo file is sourced
 * from somewhere OTHER than a working-tree path — notably `do --remote`, which
 * reads it from the arbiter's `main` (`git show`) since there is no checkout.
 * Reuses the allow/reject SET verbatim (no parallel split), so a host-only key
 * is rejected identically however the bytes were sourced. Invalid JSON throws.
 */
export function loadRepoConfigFromContent(
	content: string,
	sourceLabel: string,
): LoadedRepoConfig {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(content) as Record<string, unknown>;
	} catch (err) {
		throw new Error(
			`Invalid JSON in ${sourceLabel}: ${(err as Error).message}`,
		);
	}

	const config: PartialConfig = {};
	const rejected: string[] = [];
	for (const key of Object.keys(parsed)) {
		const value = parsed[key];
		if (value === undefined) {
			continue;
		}
		if (ALLOWED_SET.has(key)) {
			// Type matches by construction: key ∈ REPO_ALLOWED_KEYS ⊂ keyof Config.
			(config as Record<string, unknown>)[key] = value;
		} else if (isRejectedKey(key)) {
			rejected.push(key);
		}
		// else: unknown key ⇒ silently ignored.
	}

	const rejectedMessage =
		rejected.length > 0
			? `Ignoring runner/host-only key(s) in ${REPO_CONFIG_FILENAME} ` +
				`(${sourceLabel}): ${rejected.join(', ')}. ` +
				`These describe the runner/host, not a single repo, and belong in ` +
				`the global config or a CLI flag.`
			: undefined;

	const message = rejectedMessage;

	return {path: sourceLabel, config, rejected, ...(message ? {message} : {})};
}

function isRejectedKey(key: string): boolean {
	return (REPO_REJECTED_KEYS as readonly string[]).includes(key);
}

/** Inputs to {@link resolveRepoConfig}. */
export interface ResolveRepoConfigOptions {
	/** Absolute path to the repo root (where `.agent-runner.json` would live). */
	repoPath: string;
	/**
	 * The fully-resolved GLOBAL config (already merged over built-in defaults,
	 * e.g. via {@link mergeConfig} / `loadConfig`). The per-repo file and any
	 * flags layer OVER this; it provides the global + default layers of the
	 * precedence chain.
	 */
	global: Config;
	/**
	 * Command-level flag overrides (where a command offers one). These sit at the
	 * TOP of the precedence chain: flag > env > per-repo > global > default. Only
	 * keys a command actually exposes need appear here.
	 */
	flags?: PartialConfig;
	/**
	 * The raw environment map the `AGENT_RUNNER_*` layer is read from (defaults to
	 * `process.env`). Env sits ABOVE the per-repo file and BELOW a flag, and — as
	 * a per-machine source — may set ANY key, host-only included (it is NOT subject
	 * to the per-repo allow/reject split). Injectable so tests need not mutate the
	 * real `process.env`.
	 */
	env?: EnvMap;
}

/** The effective config for one repo, plus any rejected-key diagnostics. */
export interface ResolvedRepoConfig {
	/** The layered, effective {@link Config} for this repo. */
	config: Config;
	/** Runner/host-only keys ignored in this repo's file (see {@link loadRepoConfig}). */
	rejected: string[];
	/** Clear message for the rejected keys, if any. */
	message?: string;
}

/**
 * Resolve the effective config for ONE repo by layering, per key:
 *
 *   flag > ENV (AGENT_RUNNER_*) > per-repo `.agent-runner.json` > global >
 *   built-in default
 *
 * The `global` argument already carries the global + default layers (it is the
 * output of `loadConfig`/`mergeConfig`). We layer the repo's honoured keys over
 * it, then the `AGENT_RUNNER_*` env layer over that (env may set host-only keys
 * the per-repo file rejected — it is a per-machine source), then any flags on
 * top. The shared `global` object is never mutated, so calling this once per repo
 * in a multi-repo run yields INDEPENDENT results — repo A can be `merge` while
 * repo B is `propose` in the same run.
 *
 * A repo with no `.agent-runner.json` (and no env) resolves to exactly `global`
 * (unchanged behaviour).
 */
export function resolveRepoConfig(
	options: ResolveRepoConfigOptions,
): ResolvedRepoConfig {
	const {repoPath, global, flags, env} = options;
	const repo = loadRepoConfig(repoPath);
	return resolveRepoConfigFromLoaded(repo, {global, flags, env});
}

/**
 * Layer an ALREADY-LOADED {@link LoadedRepoConfig} (the honoured subset + its
 * rejected-key diagnostics) into the SAME precedence chain {@link resolveRepoConfig}
 * applies:
 *
 *   flag > ENV (AGENT_RUNNER_*) > per-repo > global > built-in default
 *
 * This is the source-agnostic core: {@link resolveRepoConfig} feeds it a
 * working-tree read ({@link loadRepoConfig}); `do --remote` feeds it the arbiter's
 * committed file read from `main` via {@link loadRepoConfigFromContent}. EITHER
 * way the layering + the rejected-key passthrough are IDENTICAL — only the bytes'
 * origin differs (the slice's one genuinely-new seam).
 */
export function resolveRepoConfigFromLoaded(
	repo: LoadedRepoConfig,
	options: {global: Config; flags?: PartialConfig; env?: EnvMap},
): ResolvedRepoConfig {
	const {global, flags, env} = options;
	// mergeConfig copies `global` (spreads DEFAULT_CONFIG then assigns) so the
	// shared global object is never mutated. Layer per-repo, then env (a
	// per-machine source — may set host-only keys), then flags on top.
	const config = mergeConfig({
		...global,
		...repo.config,
		...envOverrides(env),
		...(flags ?? {}),
	});
	return {
		config,
		rejected: repo.rejected,
		...(repo.message ? {message: repo.message} : {}),
	};
}
