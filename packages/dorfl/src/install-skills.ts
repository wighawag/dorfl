/**
 * The dorfl-side wrapper around the VENDORED `incur/agents.ts` (MIT — see
 * `./vendor/incur/`, and the ADR `docs/adr/skill-install-vendors-incur-agents-map.md`).
 * The vendored file provides the ~22-harness destination map, `detect()`, and
 * `install(sourceDir, options)` that copies each skill into the canonical
 * `~/.agents/skills/` and symlinks non-universal harnesses. This module is the
 * dorfl-authored code AROUND it: it resolves the packaged-skills SOURCE dir
 * and drives the vendored `install()` — nothing more. Keep the vendored file
 * untouched (byte-close to upstream) so future incur updates stay a mechanical
 * re-copy.
 *
 * ## Decisions (in-scope, non-obvious)
 *
 * - **Sibling script over merged.** The build-time packaging lives in
 *   `scripts/vendor-skills.mjs`, a SIBLING of the existing `vendor-protocol.mjs`
 *   rather than an appended block on it. The two scripts copy DIFFERENT concept
 *   sets (contract docs vs. hand-authored skills) into different dest subtrees;
 *   each has its own set that evolves independently. See the header of
 *   `vendor-skills.mjs` for the rationale (mirrors the wording here).
 * - **Vendored file location.** `src/vendor/incur/agents.ts` (co-located with
 *   its MIT `LICENSE` + a `README.md` provenance note). Under `src/` so `tsc`
 *   compiles it into `dist/vendor/incur/agents.js`; under `vendor/incur/` so
 *   the upstream origin is CLEAR from the path, and a future re-copy is a
 *   drop-in overwrite. All dorfl wrapper code lives OUTSIDE that directory.
 * - **Resolver home.** {@link resolveSkillsSourceDir} lives IN this module
 *   (not in `prompt.ts` next to `resolveProtocolDoc`) because "the packaged
 *   skills source" is a concept OWNED by skill-install; `resolveProtocolDoc`
 *   is owned by the runner's prompt-assembly. Same SHAPE, different concept —
 *   duplicating the small resolver body keeps the ownership boundary clean.
 */

import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {install, type Agent} from './vendor/incur/agents.js';

/**
 * Locate the SOURCE directory of the vendored skills the installer copies
 * from. Resolution order, highest authority first:
 *
 *   1. `override` — explicit, for tests / unusual layouts (short-circuits).
 *   2. `dist/skills/` — a copy VENDORED inside this package (by the
 *      `vendor-skills` build step). The published-CLI primary: an installed
 *      CLI has no sibling monorepo-root `skills/` tree.
 *   3. the legacy monorepo-relative `skills/` walk — DEV-only, kept LAST (it
 *      only resolves inside this dev monorepo; an installed CLI's walks escape
 *      into the consumer's filesystem \u2192 nothing there, which is why it cannot
 *      be the primary source).
 *
 * Mirrors the shape of {@link import('./prompt.js').resolveProtocolDoc} — the
 * prefer-`dist/`-then-dev-walk order. Returns the first existing candidate;
 * when nothing exists, returns the first candidate (the caller then hits a
 * clean ENOENT rather than a silent no-op).
 */
export function resolveSkillsSourceDir(override?: string): string {
	if (override) {
		return override;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	// here = .../packages/dorfl/{src,dist}.
	const candidates: string[] = [
		// 2. Package-vendored copy (published-CLI primary). From `src/` (tsx)
		//    `dist/` is a sibling; from `dist/` it is the dir itself.
		resolve(here, '..', 'dist', 'skills'),
		resolve(here, 'skills'),
		// 3. Legacy monorepo-root walk \u2014 DEV-only, LAST.
		resolve(here, '..', '..', '..', 'skills'),
		resolve(here, '..', '..', '..', '..', 'skills'),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return candidates[0];
}

/**
 * Options threaded through {@link installSkills} to the vendored `install()`.
 * The shape mirrors incur's `install.Options` verbatim, plus a `sourceDir`
 * override for the resolver seam. Everything is optional; a bare call
 * `installSkills()` performs the "install every packaged skill, globally,
 * into every detected harness" default.
 */
export interface InstallSkillsOptions {
	/**
	 * Override the resolved packaged-skills source dir. Tests pin this to a
	 * scratch dir with fake skill folders; production callers omit it and take
	 * whatever {@link resolveSkillsSourceDir} returns.
	 */
	sourceDir?: string;
	/**
	 * `false` \u21d2 project-local placement (canonical base is `<cwd>/.agents/skills/`,
	 * and non-universal harnesses use their PROJECT-relative dirs). Default
	 * `true` (or omitted) \u21d2 global placement under `~/.agents/skills/`.
	 */
	global?: boolean;
	/**
	 * Working directory for project-local installs. Ignored when `global` is not
	 * `false`. Defaults (in the vendored file) to `process.cwd()`.
	 */
	cwd?: string;
	/**
	 * Override the detected harnesses. Tests use this to force a deterministic
	 * set; production callers omit it and let the vendored `detect()` pick.
	 */
	agents?: Agent[];
}

/**
 * The per-harness install detail returned by the vendored `install()` (for
 * NON-UNIVERSAL harnesses only \u2014 universal harnesses read from the canonical
 * `.agents/skills/` directly and need no per-harness entry).
 */
export interface InstalledAgent {
	/** Harness display name (e.g. `'Claude Code'`, `'Windsurf'`). */
	agent: string;
	/** Absolute path the skill was placed at for this harness. */
	path: string;
	/** How the placement was materialised. Symlink is the norm; copy is the
	 *  Windows/no-permission fallback. */
	mode: 'symlink' | 'copy';
}

/** The report {@link installSkills} returns to its CLI caller. */
export interface InstallSkillsResult {
	/**
	 * The SOURCE directory the vendored `install()` was driven from (the value
	 * {@link resolveSkillsSourceDir} chose). Included so `dorfl skills add`
	 * can print WHERE the skills were read from, and tests can assert the
	 * resolver picked what they expected.
	 */
	sourceDir: string;
	/** Canonical install paths (one per skill directory copied). */
	paths: string[];
	/** Per-harness placements for non-universal harnesses. */
	agents: InstalledAgent[];
}

/**
 * Resolve the packaged-skills source, drive the vendored `install()`, return
 * the source + canonical paths + per-harness report. Global by default; pass
 * `global: false` for project-local placement. Tests pin `sourceDir`/`agents`
 * to keep the run hermetic; production callers pass nothing.
 *
 * The vendored `install()` reads `os.homedir()` (etc.) at MODULE LOAD, so
 * shared-write isolation for `global: true` (the default) has to happen BEFORE
 * this module is loaded (e.g. by pointing `HOME` at a scratch dir). Tests use
 * `global: false` + a scratch `cwd` for the common path (no env dance needed);
 * see `test/install-skills.test.ts`.
 */
export function installSkills(
	options: InstallSkillsOptions = {},
): InstallSkillsResult {
	const sourceDir = resolveSkillsSourceDir(options.sourceDir);
	const result = install(sourceDir, {
		global: options.global,
		cwd: options.cwd,
		agents: options.agents,
	});
	return {
		sourceDir,
		paths: result.paths,
		agents: result.agents,
	};
}
