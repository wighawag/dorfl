import type {ScanReport, ScannedItem} from './scan.js';

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

/** A short description of the `blocked_by` status for one item. */
function blockedByLabel(item: ScannedItem): string {
	if (item.blockedBy.length === 0) {
		return 'none';
	}
	if (item.eligibility.blockedBy.satisfied) {
		return `satisfied (${item.blockedBy.join(', ')})`;
	}
	return `waiting on ${item.eligibility.blockedBy.missing.join(', ')}`;
}

function formatItem(item: ScannedItem): string {
	const marker = item.eligibility.eligible ? '[eligible]' : '[  -  ]   ';
	const parts = [
		`afk=${afkLabel(item.afk)}`,
		`blocked_by=${blockedByLabel(item)}`,
	];
	return `  ${marker} ${item.slug}  (${parts.join(', ')})`;
}

/**
 * Render the cross-repo queue as a readable, deterministic string: grouped by
 * repo, one line per item showing slug, AFK gate, blocked-by status, and whether
 * it is eligible now, plus a summary line.
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

	for (const repo of report.repos) {
		const eligibleHere = repo.items.filter(
			(i) => i.eligibility.eligible,
		).length;
		lines.push(`${repo.path}  (${eligibleHere}/${repo.items.length} eligible)`);
		if (repo.items.length === 0) {
			lines.push('  (no backlog items)');
		} else {
			for (const item of repo.items) {
				lines.push(formatItem(item));
			}
		}
		lines.push('');
	}

	lines.push(
		`Summary: ${report.totalEligible}/${report.totalItems} item(s) eligible across ${report.repos.length} repo(s).`,
	);

	return lines.join('\n');
}
