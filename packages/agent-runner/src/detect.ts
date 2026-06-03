import {readdirSync, existsSync, statSync} from 'node:fs';
import {join, basename, resolve} from 'node:path';

/** The subset of config that detection needs. */
export interface DetectOptions {
	roots: string[];
	include: string[];
	exclude: string[];
}

/**
 * A repo participates iff it has a `work/backlog/` directory containing at least
 * one `.md` file.
 */
export function isParticipatingRepo(repoPath: string): boolean {
	const backlog = join(repoPath, 'work', 'backlog');
	let entries: string[];
	try {
		entries = readdirSync(backlog);
	} catch {
		return false;
	}
	return entries.some((name) => name.toLowerCase().endsWith('.md'));
}

function shouldPrune(name: string): boolean {
	return name === 'node_modules' || name.startsWith('.');
}

/**
 * Does `path` match any of the given selectors? A selector matches either by
 * resolved full path or by the repo's basename (convenience for config).
 */
function matchesSelector(path: string, selectors: string[]): boolean {
	if (selectors.length === 0) {
		return false;
	}
	const resolvedPath = resolve(path);
	const base = basename(path);
	for (const selector of selectors) {
		if (selector === base || resolve(selector) === resolvedPath) {
			return true;
		}
	}
	return false;
}

/**
 * Walk a single root, collecting participating repo paths. Prunes `node_modules`
 * and dotdirs, and does not descend into a repo once it is found to participate.
 */
function walkRoot(root: string, found: Set<string>): void {
	let stack: string[] = [root];
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
 * Detect participating repos across the configured roots. `include` adds paths
 * regardless of detection; `exclude` removes them (exclude wins over include and
 * over detection). The returned list is deduplicated and sorted.
 */
export function detectRepos(options: DetectOptions): string[] {
	const found = new Set<string>();

	for (const root of options.roots) {
		if (!existsSync(root)) {
			continue;
		}
		try {
			if (!statSync(root).isDirectory()) {
				continue;
			}
		} catch {
			continue;
		}
		walkRoot(root, found);
	}

	for (const inc of options.include) {
		found.add(resolve(inc));
	}

	const result = [...found].filter(
		(repo) => !matchesSelector(repo, options.exclude),
	);

	return result.sort();
}
