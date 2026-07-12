import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {run} from './git.js';
import {resolveSidecarIdentity} from './sidecar.js';
import {resolveItemPathByIdentity} from './item-path.js';
import {terminalMainPaths} from './item-lock.js';
import {workFolderPath, workFolderRel} from './work-layout.js';

/**
 * Resolve the source item's CURRENT on-disk path INCLUDING its TERMINAL resting
 * records — the orphan-sweep existence predicate.
 *
 * This deliberately WIDENS {@link resolveItemPathByIdentity} (which scans the
 * ACTIVE lifecycle folders + staging, and EXCLUDES terminals on purpose: for the
 * apply rung a terminal-reached item is `vanished`). The orphan sweep asks a
 * DIFFERENT question — "does a source item for this sidecar exist AT ALL?" — and a
 * task/spec that reached its terminal (`tasks/cancelled/`, `specs/dropped/`) is a
 * durable RESTING record that still EXISTS, so its sidecar is NOT an orphan.
 * Treating "reached a terminal" as "gone" would let a routine `gc` delete a live
 * sidecar (and any human answer it carries) — the 2026-07-12 false-positive.
 *
 * Reuses the shared {@link terminalMainPaths} (`item-lock.ts`, the SAME per-type
 * terminal set the lock/branch reapers key off) so the "where do terminals live?"
 * knowledge stays single-sourced. Returns the ACTIVE path when present, else the
 * first existing TERMINAL path, else `undefined` (a genuine orphan).
 */
function resolveSourceForOrphanSweep(
	cwd: string,
	item: string,
): string | undefined {
	const active = resolveItemPathByIdentity(cwd, item);
	if (active !== undefined) {
		return active;
	}
	const {type, slug} = resolveSidecarIdentity(item);
	for (const rel of terminalMainPaths(type, slug)) {
		if (existsSync(join(cwd, rel))) {
			return rel;
		}
	}
	return undefined;
}

/**
 * The **orphan-sidecar reaper** — the WORKING-TREE counterpart of the job-worktree
 * and remote-branch reapers (`gc.ts` / `reap-branches.ts`), folded into `dorfl gc`
 * (spec `agentic-question-resolution-retire-disposition-vocabulary`, US #10).
 *
 * A question sidecar is a tooling-owned file `work/questions/<type>-<slug>.md`
 * keyed on its source item's `(type, slug)` identity (`sidecarPathFor`). The
 * contract is that notes/sidecars leave by DELETION (git history is the archive),
 * so when a human deletes the source observation (or task/spec) out-of-band, its
 * sidecar is ORPHANED.
 *
 * WHY THIS IS A SWEEP, NOT AN APPLY STEP. An orphan's source item is GONE, so it
 * is in NO lifecycle pool. The advance driver enumerates ITEMS in the pools and
 * looks up THEIR sidecars; it never enumerates orphaned sidecars. So no per-item
 * `advance` tick (`apply`/`no-op`) ever runs on an orphan — the classifier never
 * sees it. The orphan's only on-disk trace is the sidecar file itself. Therefore
 * this reap enumerates `work/questions/` DIRECTLY and checks each sidecar's source
 * existence by IDENTITY.
 *
 * The existence check REUSES the keystone's extracted `resolveItemPathByIdentity`
 * (`item-path.ts`, the neutral re-exported seam) — the same working-tree,
 * by-identity "does the source item exist?" resolver the apply rung uses — WIDENED
 * to also count a source that has reached a TERMINAL folder (`tasks/cancelled/`,
 * `specs/dropped/`, via the shared `terminalMainPaths`) as EXISTING: a terminal is
 * a durable resting record, not "gone", so its sidecar is NOT an orphan (see
 * `resolveSourceForOrphanSweep`). A sidecar whose source EXISTS anywhere is left
 * untouched; a sidecar whose source is ABSENT from every active AND terminal
 * folder is `git rm`'d (deletion, not a `git mv`: the sidecar leaves by deletion,
 * recoverable from git history).
 */

/** A sidecar the orphan sweep reaped (its source item was absent). */
export interface ReapedSidecar {
	/** The repo-relative sidecar path that was removed (`work/questions/<type>-<slug>.md`). */
	path: string;
	/** The canonical namespaced identity the sidecar was keyed on (`<namespace>:<slug>`). */
	item: string;
}

/** A sidecar the orphan sweep retained (its source item still exists). */
export interface RetainedSidecar {
	path: string;
	item: string;
	/** The repo-relative path of the live source item the sidecar belongs to. */
	sourcePath: string;
}

export interface SweepOrphanSidecarsInput {
	/**
	 * The repo CHECKOUT to sweep — its working tree holds `work/questions/` and the
	 * lifecycle folders the existence check scans. In CI this is the checked-out
	 * repo (`process.cwd()`); the sweep operates on whatever checkout `gc` runs in.
	 */
	cwd: string;
	/** Sink for human-readable progress notes (per reaped / retained sidecar). */
	note?: (message: string) => void;
	/**
	 * Do NOT actually `git rm` — only REPORT what WOULD be reaped vs retained. A
	 * read-only preview; the existence predicate still runs so the report is exact.
	 */
	dryRun?: boolean;
	env?: NodeJS.ProcessEnv;
}

export interface SweepOrphanSidecarsResult {
	/** The sidecars reaped this sweep (source absent). Empty on dry-run. */
	reaped: ReapedSidecar[];
	/** The sidecars retained, each with the live source path it belongs to. */
	retained: RetainedSidecar[];
	/** On `dryRun`, the sidecars that WOULD be reaped (not actually removed). */
	wouldReap: ReapedSidecar[];
}

/**
 * Sweep `work/questions/` in `cwd` and `git rm` each sidecar whose
 * `(type, slug)` source item is ABSENT (working-tree existence via
 * {@link resolveItemPathByIdentity}). A sidecar whose source EXISTS is left
 * untouched. The reap is a `git rm` (the sidecar leaves by deletion; git history
 * is the archive), and each reaped/retained sidecar is reported.
 *
 * Working-tree based: it reads `work/questions/` + the lifecycle folders from the
 * checkout `gc` runs in; no arbiter ref query beyond the existence check. Idempotent
 * — a re-run over an already-clean tree reaps nothing.
 */
export function sweepOrphanSidecars(
	input: SweepOrphanSidecarsInput,
): SweepOrphanSidecarsResult {
	const note = input.note ?? (() => {});
	const env = input.env;
	const dryRun = input.dryRun === true;
	const reaped: ReapedSidecar[] = [];
	const retained: RetainedSidecar[] = [];
	const wouldReap: ReapedSidecar[] = [];

	const questionsDir = workFolderPath(input.cwd, 'questions');
	if (!existsSync(questionsDir)) {
		return {reaped, retained, wouldReap};
	}

	for (const entry of readdirSync(questionsDir)) {
		if (!entry.endsWith('.md')) {
			continue; // sidecars are `<type>-<slug>.md` — ignore stray non-md files
		}
		// The filename IS the identity: `<type>-<slug>.md`. `resolveSidecarIdentity`
		// accepts the `<type>-<slug>` form (the same resolver `sidecarPathFor`
		// derives the path FROM), giving the canonical `(type, slug, item)`.
		const stem = entry.slice(0, -'.md'.length);
		const {item} = resolveSidecarIdentity(stem.replace('-', ':'));
		const path = `${workFolderRel('questions')}/${entry}`;

		const sourcePath = resolveSourceForOrphanSweep(input.cwd, item);
		if (sourcePath !== undefined) {
			// The source item still exists (active lifecycle OR a terminal resting
			// record) ⇒ a LIVE sidecar ⇒ leave it untouched.
			retained.push({path, item, sourcePath});
			note(`Retained ${path}: source ${item} still exists (${sourcePath}).`);
			continue;
		}

		// Source ABSENT ⇒ ORPHAN ⇒ reap. Report (dry-run) or `git rm` (the real
		// sweep). Deletion, never a `git mv`: the sidecar leaves by deletion and is
		// recoverable from git history.
		if (dryRun) {
			wouldReap.push({path, item});
			note(`Would reap ${path} (orphan; source ${item} is gone).`);
			continue;
		}
		const rm = run('git', ['rm', '--quiet', '--', path], input.cwd, {env});
		if (rm.status !== 0) {
			// A failed `git rm` is NOT a reap; surface it but keep sweeping the rest.
			// Tolerate "did not match any files" (a concurrent reap / untracked file)
			// by reporting it as kept with the error, never crashing the sweep.
			note(
				`Failed to git rm ${path} (${rm.stderr.trim() || 'unknown error'}); kept.`,
			);
			continue;
		}
		reaped.push({path, item});
		note(`Reaped ${path} (orphan; source ${item} is gone).`);
	}

	return {reaped, retained, wouldReap};
}

/** The absolute `work/questions/` dir under a checkout (re-exported convenience). */
export function questionsDirPath(cwd: string): string {
	return join(cwd, workFolderRel('questions'));
}
