import type {ScanReport, ScannedItem} from './scan.js';
import {
	categoriseItems,
	summariseGroups,
	CATEGORY_ORDER,
	CATEGORY_LABELS,
	type CategorisedItem,
	type CategorisedGroups,
} from './categorise.js';

/**
 * Human label for the two autonomy axes. `humanOnly` is reported first when both
 * are set, so the REASON an agent is gated is always visible and distinct from
 * `needsAnswers`.
 */
export function gateLabel(
	humanOnly: boolean | undefined,
	needsAnswers?: boolean | undefined,
): string {
	if (humanOnly === true) {
		return 'human-only';
	}
	if (needsAnswers === true) {
		return 'needs-answers';
	}
	return 'undeclared';
}

/** A short description of the `blockedBy` readiness for one item. */
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
 * every backlog item is grouped by who-can-take-it (Agent-claimable now /
 * Human-only / Blocked), with empty groups shown as `(none)`. Within a group,
 * ready (deps-satisfied) items sort above blocked ones.
 *
 * The set of groups shown is INDEPENDENT of `allowAgents`; only the eligibility
 * *verdict* line reflects the policy (`report.totalEligible` counts an
 * agent-claimable item only when `allowAgents` is on).
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
			`${s.agentClaimable} agent-claimable, ${s.humanOnly} human-only, ` +
			`${s.needsAnswers} needs-answers, ${s.blocked} blocked ` +
			`(${s.ready} ready).`,
	);
	lines.push(
		`Runner verdict: ${report.totalEligible}/${report.totalItems} item(s) eligible now ` +
			`(under the current --allow-agents policy).`,
	);

	return lines.join('\n');
}
