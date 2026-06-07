/**
 * The **brand / protocol identity** single source of truth (ADR-class load-
 * bearing strings).
 *
 * agent-runner's name leaks into a handful of strings that are a CONTRACT with
 * the user, the filesystem, and CI — and that BREAK SILENTLY if they drift out
 * of sync on a rename:
 *
 *   - the `AGENT_RUNNER_` env-var prefix (a missed one is read as "unset" — the
 *     worst kind of failure: silent);
 *   - the `.agent-runner.json` per-repo config filename;
 *   - the `~/.agent-runner/` workspaces-dir default + the `agent-runner` config
 *     dir name;
 *   - the `.agent-runner-job.json` per-job record filename;
 *   - the `agent-runner` binary / package name where referenced FROM CODE.
 *
 * This module derives EVERY one of those from a SINGLE base string ({@link BASE})
 * using the same case transforms the `change-name` tool understands
 * (https://github.com/wighawag/change-name — camelCase/constantCase/paramCase/…).
 * Renaming the project later is then ONE edit here, not a scattered (and
 * silently-breakable) find/replace across the codebase.
 *
 * SCOPE: only the PROTOCOL surface (where a miss BREAKS things). The ~600
 * cosmetic doc/prose mentions of "agent-runner" (ADRs, PRDs, CONTEXT.md, slices,
 * comments) are NOT indirected through this module — they should read as the real
 * name and are handled at actual rebrand time by `change-name` (multi-case-aware
 * recursive rename of file names + contents). The two are complementary: this
 * centralizes the breakable protocol surface; `change-name` covers the cosmetic
 * bulk. Likewise `package.json`'s `name`/`bin` are NOT indirected through a
 * runtime constant (that is also `change-name`'s job) — {@link Brand.bin} merely
 * exposes the SAME derived value for the code sites that reference the binary.
 */

/**
 * The ONE base identity string, in `paramCase` (the natural form of the binary
 * name). Change THIS and every derived protocol form below flips in lockstep.
 */
export const BASE = 'agent-runner';

// --- Case transforms (the subset of `change-name`'s vocabulary we derive from).
//
// Implemented locally (no runtime dependency) but NAMED for the `change-name`
// conventions so the mapping is obvious at rebrand time. Each splits the input
// into lowercase words, then re-joins per the target case. The base is already
// `paramCase`, but we go through `words()` so a future base in any case still
// derives correctly.

/** Split an identifier (any case) into its lowercase words. */
function words(input: string): string[] {
	return input
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase / PascalCase boundary
		.replace(/[-_\s.]+/g, ' ') // param/snake/dot/space separators
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w !== '');
}

/** `agent-runner` (lowercase words joined by `-`). */
export function paramCase(input: string): string {
	return words(input).join('-');
}

/** `AGENT_RUNNER` (uppercase words joined by `_`). */
export function constantCase(input: string): string {
	return words(input)
		.map((w) => w.toUpperCase())
		.join('_');
}

/**
 * The derived brand surface. Every field is computed from {@link BASE}; none is
 * an independent literal, so they can never drift apart.
 */
export interface Brand {
	/** The base identity string (paramCase): `agent-runner`. */
	readonly base: string;
	/** The shared env-var prefix: `constantCase(base) + '_'` ⇒ `AGENT_RUNNER_`. */
	readonly envPrefix: string;
	/** The per-repo config filename: `.{paramCase(base)}.json` ⇒ `.agent-runner.json`. */
	readonly repoConfigFilename: string;
	/** The workspaces-dir name (a dotfile dir): `.{paramCase(base)}` ⇒ `.agent-runner`. */
	readonly workdirName: string;
	/** The per-job record filename: `.{paramCase(base)}-job.json` ⇒ `.agent-runner-job.json`. */
	readonly jobRecordFilename: string;
	/** The config-dir name (under `~/.config/`): `paramCase(base)` ⇒ `agent-runner`. */
	readonly configDirName: string;
	/** The binary / package name (paramCase): `agent-runner`. */
	readonly bin: string;
}

/** Derive the full {@link Brand} surface from one base string. */
export function deriveBrand(base: string): Brand {
	const param = paramCase(base);
	return {
		base,
		envPrefix: constantCase(base) + '_',
		repoConfigFilename: `.${param}.json`,
		workdirName: `.${param}`,
		jobRecordFilename: `.${param}-job.json`,
		configDirName: param,
		bin: param,
	};
}

/**
 * The live brand surface for THIS project, derived from {@link BASE}. Import the
 * fields you need (e.g. `brand.envPrefix`, `brand.workdirName`) instead of
 * hardcoding the literal — that is the whole point of this module.
 */
export const brand: Brand = deriveBrand(BASE);
