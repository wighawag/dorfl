import {readdirSync, readFileSync} from 'node:fs';
import {join, basename} from 'node:path';
import type {Config} from './config.js';
import {detectRepos} from './detect.js';
import {parseFrontmatter} from './frontmatter.js';
import {resolveEligibility, type EligibilityResult} from './eligibility.js';
import {resolveRepoConfig} from './repo-config.js';

/** A backlog item with its parsed gate/deps, before eligibility resolution. */
export interface BacklogItem {
	/** Filename within `work/backlog/` (e.g. `scan.md`). */
	file: string;
	/** Resolved slug (frontmatter `slug:`, falling back to the filename). */
	slug: string;
	/** The autonomy gate: `true` (human-only) | `undefined` (undeclared). */
	humanOnly: boolean | undefined;
	/** Slugs this item is blocked by. */
	blockedBy: string[];
}

/** A backlog item plus its resolved eligibility verdict. */
export interface ScannedItem extends BacklogItem {
	eligibility: EligibilityResult;
}

/** All scanned backlog items for one participating repo. */
export interface RepoReport {
	path: string;
	items: ScannedItem[];
}

/** The full cross-repo scan result. */
export interface ScanReport {
	repos: RepoReport[];
	totalItems: number;
	totalEligible: number;
}

function listMarkdown(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.filter((name) => name.toLowerCase().endsWith('.md')).sort();
}

function slugForFile(dir: string, file: string): string {
	const content = readFileSync(join(dir, file), 'utf8');
	const fm = parseFrontmatter(content);
	return fm.slug ?? basename(file, '.md');
}

/**
 * Collect the set of slugs present in a repo's `work/done/`. Used to resolve
 * `blocked_by` (per-repo only). Falls back to the filename when an item has no
 * `slug` frontmatter.
 */
export function readDoneSlugs(repoPath: string): Set<string> {
	const dir = join(repoPath, 'work', 'done');
	const slugs = new Set<string>();
	for (const file of listMarkdown(dir)) {
		slugs.add(slugForFile(dir, file));
	}
	return slugs;
}

/** Read and parse every `work/backlog/*.md` for a repo, sorted by slug. */
export function readBacklogItems(repoPath: string): BacklogItem[] {
	const dir = join(repoPath, 'work', 'backlog');
	const items: BacklogItem[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		items.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			blockedBy: fm.blockedBy,
		});
	}
	return items.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Read-only end-to-end scan: detect participating repos, parse their backlog
 * frontmatter, and resolve eligibility per item (autonomy gate + per-repo
 * `blocked_by`). Claims and runs nothing.
 *
 * The autonomy gate's `allowAgents` policy is resolved PER REPO (flag > per-repo
 * `.agent-runner.json` > global > default), exactly like `integration` — so a
 * permissive repo and a strict repo can coexist in one scan.
 */
export function scan(config: Config): ScanReport {
	const repoPaths = detectRepos({
		roots: config.roots,
		include: config.include,
		exclude: config.exclude,
	});

	const repos: RepoReport[] = [];
	let totalItems = 0;
	let totalEligible = 0;

	for (const path of repoPaths) {
		const doneSlugs = readDoneSlugs(path);
		const allowAgents = resolveRepoConfig({repoPath: path, global: config})
			.config.allowAgents;
		const items: ScannedItem[] = readBacklogItems(path).map((item) => {
			const eligibility = resolveEligibility({
				humanOnly: item.humanOnly,
				blockedBy: item.blockedBy,
				doneSlugs,
				allowAgents,
			});
			totalItems++;
			if (eligibility.eligible) {
				totalEligible++;
			}
			return {...item, eligibility};
		});
		repos.push({path, items});
	}

	return {repos, totalItems, totalEligible};
}
