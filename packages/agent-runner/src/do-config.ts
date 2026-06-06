import type {Config, IntegrationMode, PartialConfig} from './config.js';

/**
 * The CLI flags that select WHICH agent runs and HOW it is launched — shared,
 * verbatim, by `run` and `do`. Both commands offer `--harness`/`--agent-cmd`/
 * `--pi-bin`/`--model`; this is the single place their string→`PartialConfig`
 * mapping lives so there is exactly ONE override path (not a parallel one per
 * command). `cli.ts`'s `runFlagOverrides` and {@link doFlagOverrides} both fold
 * this in.
 */
export interface HarnessFlags {
	agentCmd?: string;
	model?: string;
	harness?: string;
	piBin?: string;
	/**
	 * The HOST-ONLY root folder under which a job's pi session FILE is generated
	 * (`--sessions-dir`). Forwarded verbatim like `piBin`; the path generator turns
	 * it into `<sessionsDir>/<unique-id>.jsonl` at launch (unset ⇒ pi's per-cwd
	 * default folder).
	 */
	sessionsDir?: string;
}

/**
 * Map the shared harness/adapter flags into a {@link PartialConfig} of overrides
 * — the per-key mapping `run` and `do` both reuse. Only flags actually present
 * contribute (absent flag ⇒ absent key), so the override layer never clobbers a
 * lower precedence source with `undefined`. `--harness` is validated against the
 * `HarnessAdapter` union (an out-of-range value is dropped, matching `run`).
 */
export function harnessFlagOverrides(flags: HarnessFlags): PartialConfig {
	const overrides: PartialConfig = {};
	if (flags.agentCmd !== undefined) {
		overrides.agentCmd = flags.agentCmd;
	}
	if (flags.model !== undefined) {
		overrides.model = flags.model;
	}
	if (flags.harness === 'null' || flags.harness === 'pi') {
		overrides.harness = flags.harness;
	}
	if (flags.piBin !== undefined) {
		overrides.piBin = flags.piBin;
	}
	if (flags.sessionsDir !== undefined) {
		overrides.sessionsDir = flags.sessionsDir;
	}
	return overrides;
}

/**
 * Build the flag-override `PartialConfig` for the `do` command. This is the FIX
 * for the silent-drop bug: `do` DECLARES `--harness`/`--agent-cmd`/`--pi-bin`/
 * `--model`, so its action MUST thread them into `resolveRepoConfig`'s `flags`
 * — not just `{integration}`. It reuses the SAME per-key mapping `run` uses
 * ({@link harnessFlagOverrides}), then folds in the integrate-time mode (the
 * already-resolved `--merge`/`--propose`, via `integrationFromFlags`) so the
 * full set rides the same precedence chain (flag > env > per-repo > global >
 * default).
 */
export function doFlagOverrides(
	flags: HarnessFlags & ReviewFlags,
	integration?: IntegrationMode,
): PartialConfig {
	const overrides = {
		...harnessFlagOverrides(flags),
		// Gate 2 (PR/code review) flags ride the SAME flag-override path so
		// `--review-pr`/`--auto-merge`/`--review-model`/`--review-max-rounds` resolve
		// flag > env > per-repo > global > default, exactly like the harness flags.
		...reviewFlagOverrides(flags),
	};
	if (integration !== undefined) {
		overrides.integration = integration;
	}
	return overrides;
}

/**
 * The Gate-2 (PR/code review) CLI flags, offered by `do` AND `complete`
 * (`--review-pr`/`--no-review-pr`, `--auto-merge`/`--no-auto-merge`,
 * `--review-model`, `--review-max-rounds`). Both commands resolve them through
 * the SAME `flag > env > per-repo > global > default` chain as `integration`, so
 * the mapping lives in ONE place (not a parallel copy per command).
 */
export interface ReviewFlags {
	/** `--review-pr` ⇒ true, `--no-review-pr` ⇒ false, absent ⇒ undefined. */
	reviewPr?: boolean;
	/** `--auto-merge` ⇒ true, `--no-auto-merge` ⇒ false, absent ⇒ undefined. */
	autoMerge?: boolean;
	/** `--review-model <id>` — the de-correlated review model (routing intent). */
	reviewModel?: string;
	/** `--review-max-rounds <n>` — the revise↔review loop bound (parsed to a number). */
	reviewMaxRounds?: string;
}

/**
 * Map the Gate-2 review flags into a {@link PartialConfig} of overrides — the
 * per-key mapping `do` and `complete` both reuse. Only flags actually present
 * contribute (absent flag ⇒ absent key), so the override layer never clobbers a
 * lower-precedence source with `undefined`. `--review-max-rounds` is parsed to a
 * number; a non-numeric value is dropped (the lower layer / default decides).
 */
export function reviewFlagOverrides(flags: ReviewFlags): PartialConfig {
	const overrides: PartialConfig = {};
	if (flags.reviewPr !== undefined) {
		overrides.reviewPr = flags.reviewPr;
	}
	if (flags.autoMerge !== undefined) {
		overrides.autoMerge = flags.autoMerge;
	}
	if (flags.reviewModel !== undefined) {
		overrides.reviewModel = flags.reviewModel;
	}
	if (flags.reviewMaxRounds !== undefined) {
		const n = Number(flags.reviewMaxRounds);
		if (flags.reviewMaxRounds.trim() !== '' && !Number.isNaN(n)) {
			overrides.reviewMaxRounds = n;
		}
	}
	return overrides;
}

/**
 * The null-default guard: the `null` adapter shells out to `agentCmd`, so it is
 * required there; the `pi` adapter invokes the pi CLI directly and does not
 * consume `agentCmd`. Returns `true` when the resolved config selects the null
 * adapter with no `agentCmd` — the case `do`/`run` must reject with a clear
 * "no agentCmd configured" error. (Same predicate both commands inline; named
 * here so the fix's no-regression test can pin it.)
 */
export function doNeedsAgentCmd(config: Config): boolean {
	return config.harness !== 'pi' && config.agentCmd.trim() === '';
}
