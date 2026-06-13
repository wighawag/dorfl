import {discoverJobs, type GcJob} from './gc.js';
import {resolveHarness, type Harness} from './harness.js';
// Import for the registration side-effect: ensures the `pi` adapter is in the
// harness registry so `resolveHarness` dispatches pi jobs' liveness to it.
import './pi-harness.js';
import {type JobState} from './workspace.js';
import {ledgerRead} from './ledger-read.js';
import {fetchMirrorMainOrWarn} from './repo-mirror.js';
import {extractReason} from './needs-attention.js';
import {type NeedsAttentionItem} from './needs-attention.js';
import {formatArbiterStatus, type ArbiterStatusReport} from './arbiter.js';
import {formatCwdSection} from './format.js';
import type {CwdSection} from './cwd-section.js';
import {
	lintRefLedger,
	formatDuplicateWarnings,
	type DuplicateSlug,
} from './ledger-lint.js';

/**
 * `agent-runner status` — the **operational dashboard of jobs** (ADR §4/§5/§12
 * in `docs/adr/execution-substrate-decisions.md`). Split out of
 * `agent-workspaces` so the substrate stays thin; this module owns the view.
 *
 * It lists the jobs under `<workspacesDir>/work/*` from their
 * `.agent-runner-job.json` records + worktree state, grouped by state:
 *
 *   - **active** — `running` AND the harness reports the job still alive.
 *   - **failed / retained** — everything that wants a human's eye: a job the
 *     `needs-attention` mechanism flagged (with its reason, ADR §12), a `done`
 *     job whose worktree was never reaped (awaiting cleanup), or a `running`
 *     job whose harness reports it DEAD (crashed — the runner died mid-flight).
 *
 * **Liveness comes from the harness seam (PID / session), NOT filesystem mtime**
 * (ADR §5): a live agent can think for minutes without writing files, so mtime
 * would mistake a thinking agent for a dead one. The harness answers liveness
 * from the real signal.
 *
 * **Fetch-first (ADR §5/§6):** the folder-native needs-attention surface is read
 * from each registered hub mirror's `main` ref AFTER refreshing that ref — the
 * old "scan is always offline" framing is RETIRED (it was the roots-local model).
 * A failed mirror fetch is NOT fatal: it WARNS and falls back to that mirror's
 * last-known `main`. The ledger read STRATEGY is unchanged
 * (`claim-ledger-vs-protected-main.md`); `status` only ensures the ref is fresh.
 *
 * It is strictly **read-only**: it inspects records/worktrees; it never claims,
 * runs, moves, or deletes (deletion is `gc`; the needs-attention move is the
 * runner's). It reuses the `gc` `discoverJobs` primitive to enumerate jobs (it
 * does NOT re-implement the work-area layout).
 *
 * Distinct from `scan`: `scan` answers "what work is in the *backlog* and who
 * can take it"; `status` answers "what is *running / stuck / awaiting cleanup*
 * right now". The retained-worktree + needs-attention items are the "look here"
 * set.
 */

/** One job as the operational dashboard sees it (a record + its liveness). */
export interface JobStatus {
	/** The work slug being processed. */
	slug: string;
	/** The encoded repo key the job's hub mirror was cut from. */
	repo: string;
	/** The work branch checked out in the worktree (`work/<slug>`). */
	branch: string;
	/** ISO timestamp the job worktree was created. */
	startedAt: string;
	/** The persisted lifecycle state. */
	state: JobState;
	/** Liveness FROM THE HARNESS SEAM (PID/session), never mtime (ADR §5). */
	alive: boolean;
	/**
	 * Why the job is stuck (ADR §12), when known — surfaced for the
	 * failed/retained group. Present for `needs-attention` jobs that recorded a
	 * reason; absent otherwise.
	 */
	reason?: string;
	/**
	 * The review-request URL (e.g. a GitHub PR) opened for this job, when a
	 * `propose`-mode provider opened one (ADR §6). Surfaced so the human can jump
	 * straight to the PR. Absent otherwise.
	 */
	prUrl?: string;
	/** Absolute path to the job worktree (for the human to look). */
	dir: string;
}

/** One repo's `work/needs-attention/` folder, surfaced for the dashboard. */
export interface RepoNeedsAttention {
	/** The repo path whose `work/needs-attention/` was read (a hub-mirror path). */
	repoPath: string;
	/** The stuck items (slug + recorded reason) in that folder. */
	items: NeedsAttentionItem[];
}

/** One repo's one-slug-one-folder LINT result, surfaced for the dashboard. */
export interface RepoLedgerDuplicates {
	/** The repo path whose `work/` ledger was linted (a hub-mirror path). */
	repoPath: string;
	/** The slugs present in more than one status folder (non-empty here). */
	duplicates: DuplicateSlug[];
}

/** The operational groups `status` reports. */
export interface StatusReport {
	/** Running jobs the harness reports still alive. */
	active: JobStatus[];
	/** Stuck (needs-attention), crashed (running-but-dead), or un-reaped (done) jobs. */
	attention: JobStatus[];
	/**
	 * The folder-native needs-attention surface (ADR §12): each registered hub
	 * mirror's `work/needs-attention/<slug>.md` items (read from the mirror's `main`
	 * ref) with their recorded reason. This is the durable "look here" set in the
	 * repo's `work/` tree (distinct from the transient job worktrees above). Empty
	 * when no `mirrorPaths` were given. Optional in the type so the older job-only
	 * literals stay valid; `status()` always populates it (possibly empty).
	 */
	needsAttention?: RepoNeedsAttention[];
	/**
	 * The one-slug-one-folder LINT (PRD `ledger-integrity` story 3): per registered
	 * hub mirror, any slug present in MORE THAN ONE `work/` status folder (a corrupt
	 * ledger). Read from the mirror's bare `main` ref (the SAME `ls-tree` source the
	 * needs-attention surface uses). Only repos WITH a duplicate appear. `status`
	 * WARNS loudly about each (never a silent pass); a human resolves it. Empty when
	 * no `mirrorPaths` were given or every ledger is clean.
	 */
	ledgerDuplicates?: RepoLedgerDuplicates[];
	/**
	 * The current repo's arbiter state (folded in from the old `arbiter status`,
	 * ADR §1/§7): which remote, URL/path, exists/bare, main reachable, and the
	 * unsafe non-bare-with-main flag. Present only when the CLI resolved one (it is
	 * a current-checkout concern); absent for the pure job-area dashboard.
	 */
	arbiter?: ArbiterStatusReport;
	/**
	 * The CWD-LOCAL section (the `scan-status-read-cwd-repo` slice): when `status`
	 * runs INSIDE a participating repo, this is that CURRENT repo read from its
	 * LOCAL WORKING TREE (fetch-its-arbiter-first), reported as a DISTINCT,
	 * separately-counted block alongside (never merged into) the registry view.
	 * Absent when the cwd does not participate or the caller did not resolve it.
	 */
	cwd?: CwdSection;
}

export interface StatusOptions {
	/** The execution working area to inspect (config `workspacesDir`). */
	workspacesDir: string;
	/**
	 * The harness used to answer liveness (PID/session — never mtime). When given,
	 * it answers liveness for EVERY job (tests inject a stub here). When omitted,
	 * each job's liveness is answered by the adapter that OWNS its record
	 * (`resolveHarness` keyed off the record's `adapter`) — so a `pi` job reports
	 * via the pi adapter (PID + session pointer) and a `null` job via the null
	 * adapter, never mtime.
	 */
	harness?: Harness;
	/**
	 * Hub-mirror PATHS whose `work/needs-attention/` to surface (ADR §12), read
	 * from each mirror's BARE `main` ref THROUGH the read seam (mirrors have no
	 * working tree). The CLI wires these from the registry's {@link listMirrors}.
	 * `status` FETCHES each mirror's `main` first (ADR §5/§6 — the registry's remote
	 * is the source of truth); a failed fetch WARNS and falls back to last-known
	 * (never errors). Omitted ⇒ the folder-native surface is skipped (only the job
	 * worktrees are reported).
	 */
	mirrorPaths?: string[];
	/**
	 * Sink for the fetch-first fall-back warning (ADR §5/§6): when a mirror's `main`
	 * cannot be fetched, `status` warns through this and reads that mirror's
	 * last-known state. The CLI wires it to the standard `>>` stderr note.
	 */
	warn?: (message: string) => void;
	/**
	 * The current repo's arbiter state to fold into the dashboard (the old `arbiter
	 * status`, ADR §1). The CLI resolves it via `arbiterStatus` for the current
	 * checkout; omitted ⇒ no arbiter section.
	 */
	arbiter?: ArbiterStatusReport;
	/**
	 * The pre-resolved CWD-LOCAL section (the `scan-status-read-cwd-repo` slice).
	 * The CLI resolves it via `resolveCwdSection` (cwd participation + fetch-first
	 * divergence + registry de-dup) and hands it here; `status` carries it onto the
	 * report and `formatStatus` renders it as a distinct local block. Omitted ⇒ no
	 * local section.
	 */
	cwd?: CwdSection;
	env?: NodeJS.ProcessEnv;
}

/**
 * Build the operational status of every job under `<workspacesDir>/work/*`
 * (ADR §4/§5/§12). READ-ONLY: enumerates job records via the `gc` `discoverJobs`
 * primitive, asks the harness for liveness (NOT mtime), and groups each job as
 * **active** (running + alive) or **failed/retained** (needs-attention, a
 * crashed running-but-dead job, or a done-but-un-reaped one). Mutates nothing —
 * no claim/run/move/delete.
 */
export async function status(options: StatusOptions): Promise<StatusReport> {
	const active: JobStatus[] = [];
	const attention: JobStatus[] = [];

	for (const job of discoverJobs(options.workspacesDir)) {
		const view = toJobStatus(job, options.harness);
		// Active iff the runner believes the job is in flight (`running`) AND the
		// harness confirms it is still alive. Everything else is "look here":
		//   - needs-attention: the runner flagged it (gate red, conflict, …)
		//   - done: landed but the worktree wasn't reaped (awaiting cleanup)
		//   - running but NOT alive: the process died mid-flight (crashed)
		if (view.state === 'running' && view.alive) {
			active.push(view);
		} else {
			attention.push(view);
		}
	}

	active.sort(bySlug);
	attention.sort(bySlug);

	// The folder-native needs-attention surface (ADR §12), read from each hub
	// mirror's BARE `main` ref THROUGH the read seam (mirrors have no working tree).
	const needsAttention: RepoNeedsAttention[] = [];
	const ledgerDuplicates: RepoLedgerDuplicates[] = [];
	for (const mirrorPath of options.mirrorPaths ?? []) {
		// Fetch-first (ADR §5/§6): refresh this mirror's `main` so the surface
		// reflects the remote truth. Never fatal — a failed fetch WARNS and falls
		// back to the mirror's last-known `main` (the read strategy is unchanged).
		fetchMirrorMainOrWarn({mirrorPath, warn: options.warn, env: options.env});
		const state = await ledgerRead.resolveMirrorState({
			mirrorPath,
			env: options.env,
		});
		const items: NeedsAttentionItem[] = state.needsAttention.map((item) => ({
			file: item.file,
			slug: item.slug,
			reason: extractReason(item.content),
		}));
		if (items.length > 0) {
			needsAttention.push({repoPath: mirrorPath, items});
		}
		// The one-slug-one-folder LINT (PRD story 3): derive any slug residing in >1
		// status folder from the SAME freshly-fetched `main` ref, surfaced LOUDLY.
		const dups = lintRefLedger('main', mirrorPath, options.env);
		if (dups.length > 0) {
			ledgerDuplicates.push({repoPath: mirrorPath, duplicates: dups});
		}
	}
	needsAttention.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
	ledgerDuplicates.sort((a, b) => a.repoPath.localeCompare(b.repoPath));

	return {
		active,
		attention,
		needsAttention,
		ledgerDuplicates,
		...(options.arbiter ? {arbiter: options.arbiter} : {}),
		...(options.cwd ? {cwd: options.cwd} : {}),
	};
}

function bySlug(a: JobStatus, b: JobStatus): number {
	return a.slug.localeCompare(b.slug);
}

/**
 * Project a discovered job + its harness liveness into a `JobStatus`. When no
 * harness is forced (the normal case), each record's liveness is answered by the
 * adapter that OWNS it (`resolveHarness`) — a pi job via the pi adapter (PID +
 * session), never mtime.
 */
function toJobStatus(job: GcJob, forced: Harness | undefined): JobStatus {
	const record = job.record;
	const harness =
		forced ?? (record ? resolveHarness(record.harness) : undefined);
	const alive =
		record !== undefined && harness !== undefined
			? harness.isAlive(record.harness)
			: false;
	return {
		slug: job.slug,
		repo: record?.repoKey ?? '(unknown)',
		branch: job.branch,
		startedAt: record?.startedAt ?? '(unknown)',
		state: record?.state ?? 'running',
		alive,
		reason: record?.reason,
		prUrl: record?.prUrl,
		dir: job.dir,
	};
}

/**
 * Render the operational status for the terminal: an **Active jobs** section and
 * a **Failed / retained jobs** section, each line carrying slug, repo, branch,
 * and started-at — plus, for stuck jobs, the recorded reason, and for a
 * running-but-dead job a `(crashed — no longer alive)` marker.
 *
 * Deliberately framed in terms of **jobs** (running / stuck / awaiting cleanup),
 * NOT the backlog *queue* — that is what keeps it visibly distinct from `scan`.
 */
export function formatStatus(report: StatusReport): string {
	const lines: string[] = [];

	// The cwd-local section (the `scan-status-read-cwd-repo` slice): a DISTINCT,
	// separately-counted block for the CURRENT repo's working tree, ABOVE the
	// job/registry dashboard (never merged into the job counts).
	const cwdLines = report.cwd !== undefined ? formatCwdSection(report.cwd) : [];

	const needsAttention = report.needsAttention ?? [];
	const naCount = needsAttention.reduce((sum, r) => sum + r.items.length, 0);
	const ledgerDuplicates = report.ledgerDuplicates ?? [];
	const dupCount = ledgerDuplicates.reduce(
		(sum, r) => sum + r.duplicates.length,
		0,
	);
	if (
		report.active.length === 0 &&
		report.attention.length === 0 &&
		naCount === 0 &&
		dupCount === 0 &&
		report.arbiter === undefined &&
		cwdLines.length === 0
	) {
		return 'No jobs running or retained (the work area is empty).';
	}

	if (cwdLines.length > 0) {
		lines.push(...cwdLines);
		lines.push('');
	}

	lines.push('Active jobs (running):');
	if (report.active.length === 0) {
		lines.push('  (none)');
	} else {
		for (const job of report.active) {
			lines.push(formatJobLine(job));
		}
	}
	lines.push('');

	lines.push('Failed / retained jobs (look here):');
	if (report.attention.length === 0) {
		lines.push('  (none)');
	} else {
		for (const job of report.attention) {
			lines.push(formatJobLine(job));
		}
	}

	// The folder-native needs-attention surface (ADR §12): items the runner
	// bounced from in-progress/done to work/needs-attention/, each with its reason.
	if (naCount > 0) {
		lines.push('');
		lines.push('Needs attention (work/needs-attention/ — a human must look):');
		for (const repo of needsAttention) {
			lines.push(`  ${repo.repoPath}`);
			for (const item of repo.items) {
				const reason =
					item.reason !== '' ? item.reason : '(no reason recorded)';
				lines.push(`    ${item.slug}`);
				lines.push(`      reason: ${reason}`);
			}
		}
	}

	// The one-slug-one-folder LINT (PRD `ledger-integrity` story 3): WARN LOUDLY
	// about every slug residing in >1 status folder of a registered mirror's ledger
	// (a corrupt ledger — never a silent pass). A human must resolve each.
	if (dupCount > 0) {
		lines.push('');
		for (const repo of ledgerDuplicates) {
			lines.push(`  ${repo.repoPath}`);
			for (const w of formatDuplicateWarnings(repo.duplicates)) {
				lines.push(`  ${w}`);
			}
		}
	}

	lines.push('');
	lines.push(
		`Summary: ${report.active.length} active, ${report.attention.length} failed/retained job(s)` +
			(naCount > 0 ? `, ${naCount} needs-attention item(s)` : '') +
			(dupCount > 0 ? `, ${dupCount} one-slug-one-folder violation(s)` : '') +
			'.',
	);

	// The folded-in arbiter state (ADR §1/§7, the old `arbiter status`).
	if (report.arbiter !== undefined) {
		lines.push('');
		lines.push(formatArbiterStatus(report.arbiter));
	}

	return lines.join('\n');
}

/** One `slug  repo  branch  started-at  [marker]` job line, with reason below. */
function formatJobLine(job: JobStatus): string {
	const marker = jobMarker(job);
	const head = `  ${job.slug}   ${job.repo}   ${job.branch}   started ${job.startedAt}${marker}`;
	const extra: string[] = [];
	if (job.reason !== undefined && job.reason !== '') {
		extra.push(`      reason: ${job.reason}`);
	}
	if (job.prUrl !== undefined && job.prUrl !== '') {
		extra.push(`      PR: ${job.prUrl}`);
	}
	return extra.length > 0 ? [head, ...extra].join('\n') : head;
}

/**
 * A trailing marker that explains WHY a non-active job is in the look-here group:
 * a `running` job the harness reports dead is a **crashed** runner; a `done` job
 * is **awaiting cleanup** (`gc` will reap it); a `needs-attention` job is
 * **stuck** (its reason is rendered separately).
 */
function jobMarker(job: JobStatus): string {
	if (job.state === 'running' && !job.alive) {
		return '   (crashed — no longer alive)';
	}
	if (job.state === 'done') {
		return '   (done — awaiting cleanup)';
	}
	if (job.state === 'needs-attention') {
		return '   (needs attention)';
	}
	return '';
}
