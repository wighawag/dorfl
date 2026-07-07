import {readdirSync, existsSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {workFolderPath, isWorkItemFile} from './work-layout.js';

/**
 * Discovery of `work/`-participating repos in a FOLDER. In the registry model
 * (ADR `command-surface-and-journeys` §1) the registered set IS the hub-mirror
 * set on disk — there is NO config `roots`/`remotes` walk. This module is no
 * longer implicit discovery; its sole remaining job is to serve
 * **`remote find <folder>`** (ADR §1): walk ONE folder, find the participating
 * repos, and let the user toggle-add them. `isParticipatingRepo` is the same
 * predicate `remote find` filters on. A repo participates when it holds dorfl
 * WORK content in any lifecycle pool (see {@link isParticipatingRepo}), not only
 * a non-empty `tasks/ready/`.
 */

/**
 * The `work/` pools whose presence makes a repo a dorfl WORK repo. Participation
 * is NOT "has a claimable task": a repo whose `tasks/ready/` build pool is drained
 * but whose LIFECYCLE queues are full (answered `questions/` sidecars awaiting
 * apply, `needsAnswers` observations awaiting surface, staged prds/tasks awaiting
 * promotion) is still very much participating — the lifecycle rungs
 * (triage / surface / apply / promote) act on exactly those pools. Gating
 * participation on `tasks/ready/` ALONE made such a repo read as non-participating,
 * so `scan --here` returned empty lifecycle buckets and the CI enumerate step found
 * nothing to do (a silent green no-op while real work sat in `questions/`).
 *
 * The predicate therefore mirrors what `enumerate`/`scan` can actually produce
 * items from: it stays a CHEAP, fetch-free local `readdirSync` (no network — it is
 * the pre-gate `remote find` and the cwd-section resolver call before paying for a
 * fetch), just no longer NARROWER than the lifecycle it guards.
 */
const PARTICIPATING_POOLS = [
	'tasks-ready',
	'tasks-backlog',
	'prds-proposed',
	'prds-ready',
	'observations',
	'questions',
] as const;

/**
 * A repo participates iff any of its lifecycle-bearing `work/` pools
 * ({@link PARTICIPATING_POOLS}) contains at least one `.md` file. This is the
 * predicate `remote find` (ADR §1) filters on AND the fetch-free gate
 * `scan`/`status` use before resolving the (expensive) cwd section.
 */
export function isParticipatingRepo(repoPath: string): boolean {
	return PARTICIPATING_POOLS.some((key) => folderHasWorkItem(repoPath, key));
}

/** True iff the named work folder exists and holds at least one work-item `.md`. */
function folderHasWorkItem(
	repoPath: string,
	key: (typeof PARTICIPATING_POOLS)[number],
): boolean {
	let entries: string[];
	try {
		entries = readdirSync(workFolderPath(repoPath, key));
	} catch {
		return false;
	}
	return entries.some((name) => isWorkItemFile(name));
}

function shouldPrune(name: string): boolean {
	return name === 'node_modules' || name.startsWith('.');
}

/**
 * Walk a single folder, collecting participating repo paths. Prunes
 * `node_modules` and dotdirs, and does not descend into a repo once it is found
 * to participate (a participating repo's own subtree yields no more repos).
 */
function walkFolder(folder: string, found: Set<string>): void {
	const stack: string[] = [folder];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		if (isParticipatingRepo(dir)) {
			found.add(dir);
			// Don't descend further into a participating repo.
			continue;
		}
		let entries: import('node:fs').Dirent[];
		try {
			entries = readdirSync(dir, {withFileTypes: true});
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			if (shouldPrune(entry.name)) {
				continue;
			}
			stack.push(join(dir, entry.name));
		}
	}
}

/**
 * Find every `work/`-participating repo under `folder` (recursively), pruning
 * `node_modules`/dotdirs and not descending into a participating repo. The
 * returned list is deduplicated and sorted (deterministic). This is the
 * discovery primitive behind `remote find <folder>` (ADR §1): the caller filters
 * on {@link isParticipatingRepo} and toggle-adds the chosen ones via `remote
 * add`. A non-existent / non-directory `folder` yields `[]` (never throws).
 */
export function findParticipatingRepos(folder: string): string[] {
	const found = new Set<string>();
	if (!existsSync(folder)) {
		return [];
	}
	try {
		if (!statSync(folder).isDirectory()) {
			return [];
		}
	} catch {
		return [];
	}
	walkFolder(folder, found);
	return [...found].sort();
}
