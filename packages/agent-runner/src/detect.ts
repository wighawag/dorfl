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
 * predicate `remote find` filters on.
 */

/**
 * A repo participates iff it has a `work/backlog/` directory containing at least
 * one `.md` file. This is the predicate `remote find` (ADR §1) filters on.
 */
export function isParticipatingRepo(repoPath: string): boolean {
	const backlog = workFolderPath(repoPath, 'tasks-todo');
	let entries: string[];
	try {
		entries = readdirSync(backlog);
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
