import type {ScanReport, ScannedItem} from './scan.js';
import {
	categoriseItems,
	summariseGroups,
	CATEGORY_ORDER,
	CATEGORY_LABELS,
	type CategorisedItem,
	type CategorisedGroups,
} from './categorise.js';

/** Human label for the three-state AFK gate. */
export function afkLabel(afk: boolean | undefined): string {
	if (afk === true) {
		return 'true';
	}
	if (afk === false) {
		return 'false';
	}
	return 'unspecified';
}

/** A short description of the `blocked_by` readiness for one item. */
function readinessLabel(item: ScannedItem): string {
	if (item.blockedBy.length === 0) {
		return 'deps: satisfied (none)';
	}
	if (item.eligibility.blockedBy.satisfied) {
		return `deps: satisfied (${item.blockedBy.join(', ')})`;
	}
	return `deps: waiting on ${item.eligibility.blockedBy.missing.join(', ')}`;
}

/** Ready items get a filled marker, blocked ones an open one. */
function readinessMarker(entry: CategorisedItem): string {
	return entry.ready ? '*' : 'o';
}

function formatItem(entry: CategorisedItem): string {
	return `      ${readinessMarker(entry)} ${entry.item.slug}   ${readinessLabel(entry.item)}`;
}

/** Render one repo's three labelled groups; empty groups show `(none)`. */
function formatRepo(path: string, groups: CategorisedGroups): string[] {
	const lines: string[] = [];
	lines.push(`  ${path}`);
	lines.push('');
	for (const category of CATEGORY_ORDER) {
		lines.push(`    ${CATEGORY_LABELS[category]}:`);
		const entries = groups[category];
		if (entries.length === 0) {
			lines.push('      (none)');
		} else {
			for (const entry of entries) {
				lines.push(formatItem(entry));
			}
		}
	}
	lines.push('');
	return lines;
}

function pluralRepos(n: number): string {
	return n === 1 ? 'repo' : 'repos';
}

/**
 * Render the cross-repo queue as a human decision dashboard: under each repo,
 * every backlog item is grouped by who-can-take-it (Runner-eligible now /
 * Claimable if allowed / Human-only), with empty groups shown as `(none)`.
 * Within a group, ready (deps-satisfied) items sort above blocked ones.
 *
 * The set of groups shown is INDEPENDENT of `allowUnspecifiedGate`; only the
 * eligibility *verdict* line reflects the flag (`report.totalEligible` already
 * counts "claimable if allowed" items only when the flag is on).
 */
export function formatReport(report: ScanReport): string {
	const lines: string[] = [];

	if (report.repos.length === 0) {
		lines.push('No participating repos found.');
		lines.push(
			'(A repo participates iff it has a work/backlog/ with >= 1 .md file.)',
		);
		return lines.join('\n');
	}

	const allGroups: CategorisedGroups[] = [];
	for (const repo of report.repos) {
		const groups = categoriseItems(repo.items);
		allGroups.push(groups);
		lines.push(...formatRepo(repo.path, groups));
	}

	const s = summariseGroups(allGroups);
	const repoCount = report.repos.length;
	lines.push(
		`Summary: ${report.totalItems} item(s) across ${repoCount} ${pluralRepos(repoCount)} — ` +
			`${s.runnerEligible} runner-eligible, ${s.ifAllowed} if-allowed, ${s.humanOnly} human-only ` +
			`(${s.ready} ready, ${s.blocked} blocked).`,
	);
	lines.push(
		`Runner verdict: ${report.totalEligible}/${report.totalItems} item(s) eligible now ` +
			`(under the current --allow-unspecified-gate policy).`,
	);

	return lines.join('\n');
}
