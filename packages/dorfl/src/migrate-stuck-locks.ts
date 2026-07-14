/**
 * ONE-SHOT migration of pre-existing `stuck` per-item lock refs into the
 * post-`retire-stuck-lock-state` resting shape (surface-on-`main` +
 * `needsAnswers:true` + release the lock).
 *
 * Context (spec `surface-stuck-as-questions-and-retire-stuck-lock-state`,
 * resolved decision #3, user story 5; task
 * `migrate-existing-stuck-locks-one-shot`):
 *   - Before the retirement, a bounced item was recorded as a `state: stuck`
 *     lock ref (`refs/dorfl/lock/<entry>`) with the bounce reason (+ any
 *     agent-surfaced questions) on the ref's blob body.
 *   - After the retirement (task `retire-stuck-lock-state`), `LockState`
 *     admits only `active`. {@link parseLockEntry} silently COERCES a legacy
 *     `state: stuck` blob to `active` on read, and the `stuck`-only body
 *     sections (`## Reason` / `## Questions`) are no longer emitted or
 *     parsed. So a legacy stuck ref is now invisible to the runner (it looks
 *     like a healthy in-flight `active` hold) and its reason/questions would
 *     rot forever if the state were not migrated at rollout.
 *
 * This module runs the migration ONCE per arbiter at rollout: for every held
 * lock ref whose RAW blob body still carries `state: stuck` in its
 * frontmatter, it extracts the reason (+ questions) directly from the legacy
 * body (bypassing the coercing {@link parseLockEntry}) and drives the SAME
 * ordered surface-first-release-second transition the new bounce uses
 * ({@link surfaceStuckToNeedsAttention}) — writing the `stuck`-kind
 * `work/questions/<entry>.md` sidecar + flipping `needsAnswers:true` on the
 * item body on `<arbiter>/main`, then releasing the ref. After the migration
 * no `stuck` lock ref remains and every previously-stuck item rests as a
 * `needsAnswers:true` pool item with a sidecar (the same resting shape a
 * fresh bounce produces).
 *
 * IDEMPOTENT by construction: the legacy shape is identified from the raw
 * blob's `state: stuck` frontmatter line, which the new lock module NEVER
 * writes; a re-run therefore finds no legacy stuck ref → the report has zero
 * `migrated` entries and no arbiter mutation occurs. Bare-arbiter safe (a ref
 * is a ref): every operation goes through the same lock-ref plumbing the
 * live path uses, so it works on a `--bare file://` arbiter identically to a
 * real remote.
 *
 * SCOPE FENCE: this migrates ONLY lock entries whose name reverse-derives to
 * a CURRENT item-form (`task-*` / `spec-*` / `observation-*` via
 * {@link hasCurrentItemForm}); a pre-cutover `slice-*` / `prd-*` legacy stuck
 * ref has no on-`main` body to flip and is out of scope for the surface
 * transition — such entries are reported as `skipped-no-item-form` and left
 * for the existing `release-lock --entry <literal>` escape hatch to clear (a
 * human still asserts the clear on those; the migration never `--force`s or
 * deletes them). See the CLI verb `dorfl migrate-stuck-locks` for the
 * user-facing surface + its help text.
 */

import {runAsync, type RunResult} from './git.js';
import {
	itemFromLockEntry,
	itemLockRef,
	hasCurrentItemForm,
	listItemLocks,
} from './item-lock.js';
import {
	surfaceStuckToNeedsAttention,
	type SurfaceStuckToNeedsAttentionResult,
} from './needs-attention.js';
import {resolveSidecarIdentity} from './sidecar.js';

/** Per-lock outcome of the migration sweep. */
export type MigrateStuckLockOutcome =
	| 'migrated' // legacy stuck ref → surfaced on main + released
	| 'migrated-body-absent' // legacy stuck ref → lock released, but no `main` body existed to flip (bounce D1 probe found nothing); still a no-op-safe drain of the stale lock
	| 'not-stuck' // ref present but its blob is not the legacy `state: stuck` shape (healthy active hold, or already migrated)
	| 'skipped-no-item-form' // legacy stuck ref but its `<entry>` does not reverse-derive to a current item-form (pre-cutover `slice-*` / `prd-*`); clear via `release-lock --entry <literal>`
	| 'lost' // the surface CAS or the release lost the race to a concurrent writer; reported, never `--force`d
	| 'error'; // read/plumbing fault on this ref; reported, ref left untouched

/** One lock's disposition in the {@link MigrateStuckLocksReport}. */
export interface MigrateStuckLockEntry {
	/** The lock-entry name (`<type>-<slug>` or a pre-cutover `slice-*` / `prd-*`). */
	entry: string;
	/** The lock ref (`refs/dorfl/lock/<entry>`). */
	ref: string;
	/**
	 * The namespaced item form the entry reverse-derives to (`task:<slug>` /
	 * `spec:<slug>` / `observation:<slug>`), or the raw entry when it does not
	 * carry a current item-form prefix.
	 */
	item: string;
	outcome: MigrateStuckLockOutcome;
	/** Human-readable note (why it was left, or the surface + release result). */
	message: string;
}

/** Result of {@link migrateStuckLocks}. A one-shot sweep report. */
export interface MigrateStuckLocksReport {
	entries: MigrateStuckLockEntry[];
	/** Count of legacy stuck refs surfaced on main + released. */
	migrated: number;
	/** Count of legacy stuck refs whose lock was released but had no on-`main` body
	 * to flip (body-absent D1 probe). Still a successful drain. */
	migratedBodyAbsent: number;
	/** Count of refs that were not the legacy stuck shape (healthy active holds
	 * or already-migrated). No mutation. */
	notStuck: number;
	/** Count of legacy stuck refs skipped because their entry has no current
	 * item-form (pre-cutover `slice-*` / `prd-*`). */
	skippedNoItemForm: number;
	/** Count of refs whose surface/release lost the CAS race. */
	lost: number;
	/** Count of refs where a read/plumbing fault prevented migration. */
	errors: number;
}

export interface MigrateStuckLocksOptions {
	cwd: string;
	arbiter?: string;
	env?: NodeJS.ProcessEnv;
	/** Optional progress note sink (parity with `surfaceStuckToNeedsAttention`). */
	note?: (message: string) => void;
}

/**
 * Run the one-shot migration against the arbiter. Enumerates every held
 * per-item lock ref, and for each whose RAW blob body carries `state: stuck`
 * (the legacy shape the retired `stuck` state produced) drives the shared
 * surface-first-release-second transition (reason + questions extracted from
 * the legacy body). Idempotent: a re-run finds no legacy stuck refs and is a
 * clean no-op.
 */
export async function migrateStuckLocks(
	options: MigrateStuckLocksOptions,
): Promise<MigrateStuckLocksReport> {
	const cwd = options.cwd;
	const arbiter = options.arbiter ?? 'origin';
	const env = options.env;
	const note = options.note ?? (() => {});

	const entries: MigrateStuckLockEntry[] = [];
	let migrated = 0;
	let migratedBodyAbsent = 0;
	let notStuck = 0;
	let skippedNoItemForm = 0;
	let lost = 0;
	let errors = 0;

	// Enumerate every held lock entry on the arbiter. `listItemLocks` fetches the
	// lock refs first (hard-fails on a fetch fault) so the enumeration reads a
	// fresh arbiter snapshot; if the fetch throws we surface it as a single
	// terminal error rather than degrading to `[]` (which would silently claim
	// "nothing to migrate").
	let heldEntries: string[];
	try {
		heldEntries = await listItemLocks(cwd, arbiter, env);
	} catch (err) {
		return {
			entries: [
				{
					entry: '',
					ref: '',
					item: '',
					outcome: 'error',
					message: `failed to enumerate lock refs on ${arbiter}: ${
						err instanceof Error ? err.message : String(err)
					}`,
				},
			],
			migrated: 0,
			migratedBodyAbsent: 0,
			notStuck: 0,
			skippedNoItemForm: 0,
			lost: 0,
			errors: 1,
		};
	}

	for (const entry of heldEntries) {
		const ref = itemLockRef(entry);
		const item = itemFromLockEntry(entry);
		let body: string;
		try {
			body = await readLockBlob(ref, cwd, env);
		} catch (err) {
			errors++;
			entries.push({
				entry,
				ref,
				item,
				outcome: 'error',
				message: `read failed: ${err instanceof Error ? err.message : String(err)}`,
			});
			continue;
		}
		if (!isLegacyStuckBlob(body)) {
			notStuck++;
			entries.push({
				entry,
				ref,
				item,
				outcome: 'not-stuck',
				message: `${entry} is not a legacy stuck lock (state != stuck on the ref blob) — left untouched.`,
			});
			continue;
		}
		if (!hasCurrentItemForm(entry)) {
			// A pre-cutover `slice-*` / `prd-*` stuck ref has no current
			// item-form and therefore no on-`main` body path to flip. The
			// existing `release-lock --entry <literal>` escape hatch is the
			// supported clear here; the migration NEVER `--force`s such a ref.
			skippedNoItemForm++;
			entries.push({
				entry,
				ref,
				item,
				outcome: 'skipped-no-item-form',
				message:
					`'${entry}' is a legacy stuck ref with no current item-form ` +
					`(pre-cutover slice-*/prd-*); clear via ` +
					`\`dorfl release-lock --entry ${entry}\` (no auto-force).`,
			});
			continue;
		}
		const {slug} = resolveSidecarIdentity(item);
		const reason = extractLegacyReason(body) ?? '(no reason recorded)';
		const questions = extractLegacyQuestions(body).map((q) => ({question: q}));
		let result: SurfaceStuckToNeedsAttentionResult;
		try {
			result = await surfaceStuckToNeedsAttention({
				cwd,
				slug,
				item,
				reason,
				questions,
				arbiter,
				env,
				note,
			});
		} catch (err) {
			errors++;
			entries.push({
				entry,
				ref,
				item,
				outcome: 'error',
				message: `surface transition threw: ${
					err instanceof Error ? err.message : String(err)
				}`,
			});
			continue;
		}
		if (result.surfaced && result.released) {
			migrated++;
			entries.push({
				entry,
				ref,
				item,
				outcome: 'migrated',
				message:
					`migrated '${entry}' → surfaced on ${arbiter}/main ` +
					'(needsAnswers:true + sidecar) and released the lock.',
			});
			continue;
		}
		if (!result.surfaced && result.released && result.bodyAbsent === true) {
			// D1 body-absent probe: no `main` body existed to flip. The bounce
			// primitive STILL released the lock so the legacy stuck ref no longer
			// dangles; there is just nothing to surface. Counted as a drained
			// migration (the goal — no stuck ref remains).
			migratedBodyAbsent++;
			entries.push({
				entry,
				ref,
				item,
				outcome: 'migrated-body-absent',
				message:
					`released legacy stuck lock '${entry}': no body for '${item}' on ` +
					`${arbiter}/main (D1 probe) — sidecar surface skipped, but the ` +
					'stale lock was drained (the migration goal).',
			});
			continue;
		}
		// The surface CAS or the release did not converge (contention exhausted,
		// or the leased release lost the race). Reported, never forced.
		lost++;
		entries.push({
			entry,
			ref,
			item,
			outcome: 'lost',
			message:
				result.reasonNotSurfaced ??
				`surface/release for '${entry}' did not converge (surfaced=${result.surfaced}, released=${result.released}); re-run.`,
		});
	}

	return {
		entries,
		migrated,
		migratedBodyAbsent,
		notStuck,
		skippedNoItemForm,
		lost,
		errors,
	};
}

/**
 * True iff the migration report leaves a state a human should look at: a
 * `lost` (CAS race) or an `error` (read/plumbing fault). A `not-stuck` /
 * `skipped-no-item-form` outcome is INFORMATIONAL (the former is the normal
 * healthy-hold state; the latter is deferred to `release-lock --entry`) and
 * does NOT count. A pure "0 migrated, 0 lost, 0 error" report is exit-0.
 */
export function migrateStuckLocksNeedsAttention(
	report: MigrateStuckLocksReport,
): boolean {
	return report.lost > 0 || report.errors > 0;
}

/** Format the sweep for the terminal. An empty enumeration (no lock refs at
 * all) yields no lines (silent, like the gc lock report). */
export function formatMigrateStuckLocksReport(
	report: MigrateStuckLocksReport,
): string[] {
	if (report.entries.length === 0) {
		return [
			'Migrate stuck locks: no per-item lock refs held on the arbiter — nothing to migrate.',
		];
	}
	const lines = [
		`Migrate stuck locks: migrated ${report.migrated}` +
			(report.migratedBodyAbsent > 0
				? ` (+${report.migratedBodyAbsent} body-absent — lock drained, no on-main body to surface)`
				: '') +
			`, left ${report.notStuck} healthy active hold(s) untouched` +
			(report.skippedNoItemForm > 0
				? `, skipped ${report.skippedNoItemForm} pre-cutover entry (clear via release-lock --entry)`
				: '') +
			(report.lost > 0
				? `, ${report.lost} could not converge (lease lost — re-run)`
				: '') +
			(report.errors > 0
				? `, ${report.errors} error(s) (left untouched)`
				: '') +
			':',
	];
	for (const e of report.entries) {
		const tag =
			e.outcome === 'migrated'
				? '[migrated]           '
				: e.outcome === 'migrated-body-absent'
					? '[migrated:body-absent]'
					: e.outcome === 'not-stuck'
						? '[healthy]            '
						: e.outcome === 'skipped-no-item-form'
							? '[skipped:no-item-form]'
							: e.outcome === 'lost'
								? '[lost]               '
								: '[error]              ';
		lines.push(`  ${tag} ${e.entry}  ${e.message}`);
	}
	return lines;
}

/** Read the raw `lock.md` blob body from a lock ref, or throw. Bypasses
 * {@link parseLockEntry} on purpose — the caller needs the untouched legacy
 * text (which the coercing parser strips). */
async function readLockBlob(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const show: RunResult = await runAsync(
		'git',
		['show', `${ref}:lock.md`],
		cwd,
		{env},
	);
	if (show.status !== 0) {
		throw new Error(
			`git show ${ref}:lock.md failed (exit ${show.status}): ${show.stderr.trim()}`,
		);
	}
	return show.stdout;
}

/** True iff `body` is the legacy `state: stuck` shape (the pre-retirement
 * lock-entry blob). Matched on the raw frontmatter line so this is unaffected
 * by the current parser's coercion to `active`. */
export function isLegacyStuckBlob(body: string): boolean {
	const normalized = body.replace(/\r\n/g, '\n');
	const fm = /^---\n([\s\S]*?)\n---/.exec(normalized);
	if (!fm) {
		return false;
	}
	return /^state:\s*stuck\s*$/m.test(fm[1]);
}

/**
 * Extract the bounce reason from a legacy stuck lock blob. Preference order
 * (the two shapes the retired serialiser produced):
 *   1. A `## Reason` block in the body (multi-line, blank-trimmed).
 *   2. A one-line `reason:` field in the frontmatter (pre-cutover shape).
 * Returns `undefined` when neither is present.
 */
export function extractLegacyReason(body: string): string | undefined {
	const normalized = body.replace(/\r\n/g, '\n');
	const fm = /^---\n([\s\S]*?)\n---/.exec(normalized);
	const bodyText = fm ? normalized.slice(fm[0].length) : normalized;
	const lines = bodyText.split('\n');
	const start = lines.findIndex((l) => l.trim() === '## Reason');
	if (start !== -1) {
		const collected: string[] = [];
		for (let i = start + 1; i < lines.length; i++) {
			if (/^##\s/.test(lines[i])) {
				break;
			}
			collected.push(lines[i]);
		}
		const text = collected.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
		if (text !== '') {
			return text;
		}
	}
	if (fm) {
		const m = /^reason:\s*(.*)$/m.exec(fm[1]);
		if (m && m[1].trim() !== '') {
			return m[1].trim();
		}
	}
	return undefined;
}

/** Extract the `## Questions` bulleted list from a legacy stuck lock blob (or
 * `[]` when absent). Each bullet becomes one question string. */
export function extractLegacyQuestions(body: string): string[] {
	const normalized = body.replace(/\r\n/g, '\n');
	const fm = /^---\n[\s\S]*?\n---/.exec(normalized);
	const bodyText = fm ? normalized.slice(fm[0].length) : normalized;
	const lines = bodyText.split('\n');
	const start = lines.findIndex((l) => l.trim() === '## Questions');
	if (start === -1) {
		return [];
	}
	const questions: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (/^##\s/.test(lines[i])) {
			break;
		}
		const m = /^-\s+(.*)$/.exec(lines[i].trim());
		if (m) {
			questions.push(m[1]);
		}
	}
	return questions;
}
