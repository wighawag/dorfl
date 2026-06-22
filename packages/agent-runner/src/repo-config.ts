import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {
	mergeConfig,
	warnDeprecatedConfigKeys,
	warnDeprecatedConfigValues,
	type Config,
	type PartialConfig,
} from './config.js';
import {envOverrides, type EnvMap} from './env-config.js';
import {brand} from './brand.js';
import {encodeRepoKey} from './repo-key.js';
import type {ConfigOverrideMap} from './config-override.js';
import {run} from './git.js';

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
	// `slicingIntegration` (the per-TRANSITION override for the PRD→slices SLICING
	// transition ONLY) is a genuine repo property exactly like `integration`: whether
	// THIS repo slices a PRD straight onto `main` (slice FILES land, no PR) while it
	// still BUILDS each slice as a reviewable PR is agreed by all collaborators +
	// travels with the repo. Resolved per-repo through the SAME chain as
	// `integration`, then falls back to `integration` when unset. DISTINCT from
	// intake's per-EMITTED-TYPE `{slice, prd}` resolver (front door, author-trust):
	// this is a per-lifecycle-transition knob, inside the boundary, config-resolved.
	'slicingIntegration',
	// `slicesLandIn` (the per-repo SLICE-PLACEMENT default — staging vs pool, PRD
	// `staging-pool-position-gate-and-trust-model` US #5) is a genuine repo property
	// exactly like `slicingIntegration`/`integration`: whether THIS repo's slicer
	// output lands STAGED (`pre-backlog/`, review-without-PR human-promote path) or
	// straight in the agent-eligible POOL (`backlog/`, trusted fast-path) is agreed
	// by all collaborators + travels with the repo. Resolved per-repo through the
	// SAME chain as `slicingIntegration` (flag > env > per-repo > global > built-in
	// `pre-backlog`). DISTINCT from intake's per-emitted-type stamps (front door):
	// this is a per-lifecycle PLACEMENT knob, inside the trust boundary,
	// config-resolved. Fed into the shared placement resolver as the
	// configured-default rung (`src/placement.ts`).
	'slicesLandIn',
	// `prdsLandIn` (the per-repo PRD-PLACEMENT default — staging vs pool, PRD
	// `staging-pool-position-gate-and-trust-model` US #2/#5/#6/#12) is a genuine
	// repo property exactly like `slicesLandIn`: whether THIS repo's intake-
	// authored PRDs land STAGED (`pre-prd/`, review-without-PR human-promote path)
	// or straight in the auto-slice POOL (`prd/`, trusted fast-path) is agreed by
	// all collaborators + travels with the repo. Resolved per-repo through the
	// SAME chain as `slicesLandIn` (flag > env > per-repo > global > built-in
	// `pre-prd`). Fed into the shared placement resolver as the configured-default
	// rung for the PRD lifecycle (`src/placement.ts`).
	'prdsLandIn',
	// `noPR` (the PR-INTENT axis — push the branch but deliberately skip the PR) is
	// a genuine repo property exactly like `integration`/`review`: whether this
	// repo's propose runs open a PR is agreed by all collaborators + travels with
	// the repo. Resolved per-repo through the SAME chain. (The removed `provider`
	// OVERRIDE is gone — a stale `provider` key is ignored with a deprecation
	// warning, see `loadRepoConfigFromContent`.)
	'noPR',
	'verify',
	// `prepare` (the env-prep / install step run ONCE before the first `verify` on
	// a fresh worktree) is a genuine repo property exactly like `verify` — how this
	// repo's environment is made ready (install deps / submodules / codegen) is
	// agreed by all collaborators + travels with the repo. Resolved per-repo
	// through the SAME chain as `verify`. Install belongs HERE, never baked into
	// `verify`.
	'prepare',
	'defaultArbiter',
	// `autoBuild` (may an agent auto-BUILD undeclared, not-`humanOnly` slices in
	// this repo?) is a genuine repo property — the build member of the symmetric
	// per-action gate family.
	'autoBuild',
	// `autoSlice` (may an agent auto-slice undeclared PRDs in this repo?) is a
	// genuine repo property — the slicing-autonomy mirror of `autoBuild`
	// (`work/prd/auto-slice.md`), resolved per-repo through the same chain.
	'autoSlice',
	// `observationTriage` (the 3-state `off|ask|auto` gate over the observation
	// INBOX) is a genuine repo property — the observation-side question-surfacing
	// gate (ADR `ci-config-policy-and-gate-family`), resolved per-repo through the
	// same chain as `integration`/`autoBuild`. It REPLACES the old `autoTriage`
	// boolean (no alias; no external users owed a migration window, 2026-06-12).
	'observationTriage',
	// `surfaceBlockers` (the BOOLEAN gate over DECLARED blocked work — whether a
	// slice/PRD carrying `needsAnswers:true` is rendered into a question sidecar) is a
	// genuine repo property — the blocked-work side of the question-surfacing gate
	// family (ADR `ci-config-policy-and-gate-family`), the orthogonal peer of
	// `observationTriage`, resolved per-repo through the same chain as `autoBuild`.
	'surfaceBlockers',
	// `surfaceStaging` (the BOOLEAN gate-family member that widens SURFACE into
	// STAGING — brief `staging-surface-and-apply-promote-safety` F2) is a genuine
	// repo property exactly like its siblings (`surfaceBlockers`/`autoBuild`):
	// whether THIS repo inspects staging for questions is agreed by all
	// collaborators + travels with the repo. Default `true`; resolved per-repo
	// through the SAME chain (flag > env > per-repo > global > built-in `true`).
	// Does NOT touch the BUILD/claim candidate set — staging stays non-claimable.
	'surfaceStaging',
	// `selectionOrder` (the configurable order across the four orderable auto-pick
	// pools — build/slice/surface/triage; `apply` is pinned first) is a genuine repo
	// property — the per-repo selection-order field ADR `ci-config-policy-and-gate-
	// family` specifies, resolved per-repo like `autoSlice`. SUBSUMES the removed
	// `prdsFirst` boolean (a preset keyword or an explicit pool-name list).
	'selectionOrder',
	// `model` (which model this repo's work runs on) and `harness` (which adapter)
	// are legitimate repo properties (ADR §13) — model is routing intent, not auth,
	// and a repo may prefer a given harness. `piBin`/`agentCmd` stay host-only
	// (machine paths/commands), so they are rejected below.
	'model',
	'harness',
	// Gate 2 (PR/code review) policy is a genuine repo property (GATES PRD
	// `work/prd/review.md`), resolved per-repo like `integration`/`autoBuild`:
	// whether this repo runs Gate 2 (`review`), which model the review agent runs
	// on (`reviewModel`), and the revise↔review loop bound (`reviewMaxRounds`).
	// `reviewModel` is routing intent (not auth), so — like `model` — it is
	// repo-appropriate, not host-only.
	'review',
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
	// `freshWorktreeGate` (run the acceptance gate against the REBASED tip in a
	// clean throwaway worktree, ON by default) is a genuine repo property exactly
	// like `verify`/`prepare`/`review`: whether this repo's gate tests the merged
	// artifact (and pays the per-gate install cost) is agreed by all collaborators
	// + travels with the repo. Resolved per-repo through the SAME chain.
	'freshWorktreeGate',
	// `promptGuidance` (the NUDGE namespace — prompt-text knobs that strengthen
	// the worker's in-band wrapper line, e.g. `testFirst`) is a genuine repo
	// property: "is this repo nudged toward test-first?" travels with the repo
	// and is agreed by all collaborators. CATEGORICALLY SEPARATE from the gate
	// family (`verify`/`autoBuild`/`humanOnly`) — a nudge changes the agent's
	// disposition, NEVER the acceptance bar. Resolved per-repo through the SAME
	// chain as `autoBuild` (flag > env > per-repo > global > default).
	'promptGuidance',
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

	// Drop (with a one-line warning) any DEPRECATED key (e.g. the removed `provider`
	// override) before the allow/reject split, so an existing committed config keeps
	// working — ignored, never an error, and never mistaken for an unknown key.
	warnDeprecatedConfigKeys(parsed, sourceLabel);
	warnDeprecatedConfigValues(parsed, sourceLabel);

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
	/**
	 * The per-machine {@link ConfigOverrideMap} (from `loadConfigOverride`),
	 * inserted between the committed per-repo file and env in the precedence chain
	 * (ADR `per-machine-config-override-layer`). The hub-key bucket beats the
	 * `"*"` bucket. Default: empty (no override applied) — byte-identical to the
	 * pre-override behaviour. Injectable so tests need not touch the real
	 * `~/.config/agent-runner/`.
	 */
	override?: ConfigOverrideMap;
	/**
	 * The resolved arbiter URL used to compute the hub key (via
	 * {@link encodeRepoKey}) for the override lookup. If omitted, the URL is
	 * resolved from `repoPath` + `global.defaultArbiter` (`git remote get-url`).
	 * Unresolvable ⇒ the hub-key bucket is SKIPPED and only the `"*"` bucket
	 * applies (graceful degrade, never an error).
	 */
	arbiterUrl?: string;
}

/**
 * The thin `git remote get-url <name>` reader used by {@link resolveRepoConfig}
 * to derive a CHECKOUT's arbiter URL for the override hub-key lookup. Mirrors
 * `resolveArbiterUrlFromCheckout` in `do.ts` (which is the same primitive on the
 * `do --isolated` path); duplicated here — a single-line `run('git', …)` call —
 * to avoid a `repo-config.ts` → `do.ts` dependency that would close a cycle
 * (`do.ts` → `repo-mirror.ts` → `repo-config.ts`). Returns `undefined` when the
 * remote is unset or the cwd is not a git repo — the override layer DEGRADES
 * GRACEFULLY on an unresolvable URL.
 */
function gitRemoteGetUrl(
	cwd: string,
	remote: string,
	env: NodeJS.ProcessEnv | undefined,
): string | undefined {
	const res = run('git', ['remote', 'get-url', remote], cwd, {env});
	if (res.status !== 0) {
		return undefined;
	}
	const url = res.stdout.trim();
	return url === '' ? undefined : url;
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
	const {repoPath, global, flags, env, override} = options;
	const repo = loadRepoConfig(repoPath);
	// Resolve the arbiter URL for the override hub-key lookup from the CHECKOUT's
	// configured `<defaultArbiter>` remote (the working-tree analogue of the
	// mirror's `origin`). Unresolvable (no remote, not a git repo) ⇒ hub-key
	// lookup skipped; the `"*"` bucket still applies (graceful degrade).
	const arbiterRemote = flags?.defaultArbiter ?? global.defaultArbiter;
	const arbiterUrl =
		options.arbiterUrl ?? gitRemoteGetUrl(repoPath, arbiterRemote, env);
	return resolveRepoConfigFromLoaded(repo, {
		global,
		flags,
		env,
		override,
		...(arbiterUrl !== undefined ? {arbiterUrl} : {}),
	});
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
	options: {
		global: Config;
		flags?: PartialConfig;
		env?: EnvMap;
		/**
		 * The per-machine {@link ConfigOverrideMap}; default empty (no override).
		 * Inserted between the committed per-repo file and env in the precedence
		 * chain (ADR `per-machine-config-override-layer`).
		 */
		override?: ConfigOverrideMap;
		/**
		 * The resolved arbiter URL used to look up the hub-key override bucket
		 * (via {@link encodeRepoKey}). Unresolvable ⇒ skip the hub-key bucket;
		 * the `"*"` bucket still applies (graceful degrade).
		 */
		arbiterUrl?: string;
	},
): ResolvedRepoConfig {
	const {global, flags, env, override, arbiterUrl} = options;
	// The per-machine override layer (ADR `per-machine-config-override-layer`):
	// the `"*"` (all-repos) bucket then the hub-key (this-repo) bucket, spread
	// BETWEEN the committed per-repo file and env. Hub-key beats `"*"`. An
	// unresolvable arbiter URL skips the hub-key lookup but keeps `"*"` — never
	// an error. The override may set ANY key (host-only included): it is a
	// per-machine source like env / flag / the global file, NOT subject to the
	// per-repo allow/reject split.
	const overrideStar = override?.['*'] ?? {};
	const hubKey =
		arbiterUrl !== undefined ? encodeRepoKey(arbiterUrl) : undefined;
	const overrideHub =
		hubKey !== undefined && override !== undefined
			? (override[hubKey] ?? {})
			: {};
	// mergeConfig copies `global` (spreads DEFAULT_CONFIG then assigns) so the
	// shared global object is never mutated. Layer per-repo, then the override
	// (`"*"` then hub-key — hub-key wins), then env (a per-machine source — may
	// set host-only keys), then flags on top.
	const config = mergeConfig({
		...global,
		...repo.config,
		...overrideStar,
		...overrideHub,
		...envOverrides(env),
		...(flags ?? {}),
	});
	return {
		config,
		rejected: repo.rejected,
		...(repo.message ? {message: repo.message} : {}),
	};
}
