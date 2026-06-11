import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {
	JOB_RECORD_FILENAME,
	writeJobRecord,
	type JobRecord,
} from '../src/workspace.js';
import {status, formatStatus} from '../src/status.js';
import type {Harness, HarnessRecord} from '../src/harness.js';
import {
	makeScratch,
	registerMirrorWithWork,
	pushWorkToMirrorOrigin,
	breakMirrorOrigin,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-status-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Workspaces dir whose `work/` we seed with bare fixture job records. */
function workspacesDir(): string {
	return join(scratch.root, '.agent-runner');
}

/**
 * Write a fixture `.agent-runner-job.json` directly into a `work/<work-id>/`
 * dir — NO real git worktree. `status` is read-only over records + a harness
 * for liveness, so fixtures alone exercise its rendering.
 */
function seedJob(workId: string, record: JobRecord): string {
	const dir = join(workspacesDir(), 'work', workId);
	mkdirSync(dir, {recursive: true});
	writeJobRecord(dir, record);
	return dir;
}

function record(over: Partial<JobRecord> = {}): JobRecord {
	return {
		slug: 'feat',
		repoKey: 'github-com/wighawag/agent-runner',
		branch: 'work/slice-feat',
		startedAt: '2026-06-04T07:00:00.000Z',
		state: 'running',
		harness: {adapter: 'null', pid: 1234},
		...over,
	};
}

/** A stub harness whose liveness is dictated by a PID allow-list. */
function stubHarness(alivePids: number[]): Harness {
	return {
		adapter: 'stub',
		launch() {
			throw new Error('stub harness does not launch');
		},
		launchInteractive() {
			throw new Error('stub harness does not launch interactively');
		},
		isAlive(rec: HarnessRecord): boolean {
			return rec.pid !== undefined && alivePids.includes(rec.pid);
		},
	};
}

describe('status — grouping active vs failed/retained', () => {
	it('a running job whose harness reports alive is ACTIVE', async () => {
		seedJob(
			'github-com__wighawag__agent-runner__feat',
			record({
				slug: 'feat',
				state: 'running',
				harness: {adapter: 'stub', pid: 7},
			}),
		);
		const report = await status({
			workspacesDir: workspacesDir(),
			harness: stubHarness([7]),
		});
		expect(report.active.map((j) => j.slug)).toEqual(['feat']);
		expect(report.attention).toHaveLength(0);
		expect(report.active[0].alive).toBe(true);
	});

	it('a running job whose harness reports dead is FAILED/RETAINED (crashed)', async () => {
		seedJob(
			'github-com__wighawag__agent-runner__feat',
			record({
				slug: 'feat',
				state: 'running',
				harness: {adapter: 'stub', pid: 7},
			}),
		);
		const report = await status({
			workspacesDir: workspacesDir(),
			harness: stubHarness([]), // 7 is not alive
		});
		expect(report.active).toHaveLength(0);
		expect(report.attention.map((j) => j.slug)).toEqual(['feat']);
		expect(report.attention[0].alive).toBe(false);
	});

	it('a needs-attention job is FAILED/RETAINED and carries its reason', async () => {
		seedJob(
			'github-com__wighawag__agent-runner__stuck',
			record({
				slug: 'stuck',
				state: 'needs-attention',
				reason: 'acceptance gate failed: build red',
				harness: {adapter: 'stub', pid: 99},
			}),
		);
		const report = await status({
			workspacesDir: workspacesDir(),
			harness: stubHarness([]),
		});
		expect(report.active).toHaveLength(0);
		expect(report.attention).toHaveLength(1);
		const job = report.attention[0];
		expect(job.slug).toBe('stuck');
		expect(job.reason).toBe('acceptance gate failed: build red');
	});

	it('a done-but-un-reaped job is FAILED/RETAINED (awaiting cleanup)', async () => {
		seedJob(
			'github-com__wighawag__agent-runner__landed',
			record({slug: 'landed', state: 'done', harness: {adapter: 'stub'}}),
		);
		const report = await status({
			workspacesDir: workspacesDir(),
			harness: stubHarness([]),
		});
		expect(report.active).toHaveLength(0);
		expect(report.attention.map((j) => j.slug)).toEqual(['landed']);
	});

	it('renders each job with slug, repo, branch and started-at', async () => {
		seedJob(
			'github-com__wighawag__agent-runner__feat',
			record({
				slug: 'feat',
				repoKey: 'github-com/wighawag/agent-runner',
				branch: 'work/slice-feat',
				startedAt: '2026-06-04T07:00:00.000Z',
				state: 'running',
				harness: {adapter: 'stub', pid: 7},
			}),
		);
		const report = await status({
			workspacesDir: workspacesDir(),
			harness: stubHarness([7]),
		});
		const job = report.active[0];
		expect(job.slug).toBe('feat');
		expect(job.repo).toBe('github-com/wighawag/agent-runner');
		expect(job.branch).toBe('work/slice-feat');
		expect(job.startedAt).toBe('2026-06-04T07:00:00.000Z');
	});

	it('groups a mix of jobs correctly and sorts within group by slug', async () => {
		seedJob(
			'r__a',
			record({
				slug: 'alive-b',
				state: 'running',
				harness: {adapter: 'stub', pid: 1},
			}),
		);
		seedJob(
			'r__b',
			record({
				slug: 'alive-a',
				state: 'running',
				harness: {adapter: 'stub', pid: 2},
			}),
		);
		seedJob(
			'r__c',
			record({
				slug: 'stuck-z',
				state: 'needs-attention',
				reason: 'rebase conflict',
				harness: {adapter: 'stub', pid: 3},
			}),
		);
		seedJob(
			'r__d',
			record({
				slug: 'crashed',
				state: 'running',
				harness: {adapter: 'stub', pid: 4},
			}),
		);
		const report = await status({
			workspacesDir: workspacesDir(),
			harness: stubHarness([1, 2]), // crashed (pid 4) is dead
		});
		expect(report.active.map((j) => j.slug)).toEqual(['alive-a', 'alive-b']);
		expect(report.attention.map((j) => j.slug)).toEqual(['crashed', 'stuck-z']);
	});

	it('returns empty groups when no jobs exist', async () => {
		const report = await status({
			workspacesDir: workspacesDir(),
			harness: stubHarness([]),
		});
		expect(report.active).toEqual([]);
		expect(report.attention).toEqual([]);
	});

	it('liveness comes from the harness seam, NOT filesystem mtime', async () => {
		// Two running jobs with identical fresh records; only the harness allow-list
		// distinguishes them — proving mtime plays no part.
		seedJob(
			'r__a',
			record({
				slug: 'live',
				state: 'running',
				harness: {adapter: 'stub', pid: 10},
			}),
		);
		seedJob(
			'r__b',
			record({
				slug: 'dead',
				state: 'running',
				harness: {adapter: 'stub', pid: 20},
			}),
		);
		const report = await status({
			workspacesDir: workspacesDir(),
			harness: stubHarness([10]),
		});
		expect(report.active.map((j) => j.slug)).toEqual(['live']);
		expect(report.attention.map((j) => j.slug)).toEqual(['dead']);
	});
});

describe('status — pi job liveness via the adapter (no injected harness)', () => {
	it('a pi job is ACTIVE when its PID is alive (resolved via the pi adapter)', async () => {
		// No `harness` injected ⇒ status resolves each record to the adapter that
		// owns it. A pi record with our own (live) PID must read as active, proving
		// pi liveness flows through the pi adapter (PID), never mtime.
		seedJob(
			'github-com__wighawag__agent-runner__pi-live',
			record({
				slug: 'pi-live',
				state: 'running',
				harness: {adapter: 'pi', pid: process.pid, session: '/some/session'},
			}),
		);
		const report = await status({workspacesDir: workspacesDir()});
		expect(report.active.map((j) => j.slug)).toEqual(['pi-live']);
		expect(report.active[0].alive).toBe(true);
	});

	it('a hung/dead pi job is FAILED/RETAINED so watch rails can act', async () => {
		seedJob(
			'github-com__wighawag__agent-runner__pi-dead',
			record({
				slug: 'pi-dead',
				state: 'running',
				harness: {adapter: 'pi', pid: 2 ** 31 - 1, session: '/gone'},
			}),
		);
		const report = await status({workspacesDir: workspacesDir()});
		expect(report.active).toHaveLength(0);
		expect(report.attention.map((j) => j.slug)).toEqual(['pi-dead']);
		expect(report.attention[0].alive).toBe(false);
	});
});

describe('status — read-only', () => {
	it('does not move/delete the job worktree dir or its record', async () => {
		const dir = seedJob(
			'github-com__wighawag__agent-runner__feat',
			record({slug: 'feat', state: 'needs-attention', reason: 'x'}),
		);
		await status({workspacesDir: workspacesDir(), harness: stubHarness([])});
		// The record + dir are untouched (no claim/run/move/delete side effect).
		expect(existsSync(dir)).toBe(true);
		expect(existsSync(join(dir, JOB_RECORD_FILENAME))).toBe(true);
	});
});

describe('formatStatus — rendering', () => {
	it('renders an active and a failed/retained section, distinct from scan', async () => {
		const out = formatStatus({
			active: [
				{
					slug: 'feat',
					repo: 'github-com/wighawag/agent-runner',
					branch: 'work/slice-feat',
					startedAt: '2026-06-04T07:00:00.000Z',
					state: 'running',
					alive: true,
					dir: '/x',
				},
			],
			attention: [
				{
					slug: 'stuck',
					repo: 'github-com/wighawag/agent-runner',
					branch: 'work/slice-stuck',
					startedAt: '2026-06-04T06:00:00.000Z',
					state: 'needs-attention',
					alive: false,
					reason: 'acceptance gate failed',
					dir: '/y',
				},
			],
		});
		expect(out).toMatch(/Active/i);
		expect(out).toMatch(/feat/);
		expect(out).toMatch(/work\/slice-feat/);
		// The stuck job's reason is surfaced.
		expect(out).toMatch(/acceptance gate failed/);
		// Distinct from scan: it speaks of jobs, not the backlog queue.
		expect(out.toLowerCase()).toContain('job');
		expect(out.toLowerCase()).not.toContain('backlog');
	});

	it('shows a friendly empty message when there are no jobs', async () => {
		const out = formatStatus({active: [], attention: []});
		expect(out.toLowerCase()).toContain('no');
		expect(out.toLowerCase()).toContain('job');
	});

	it('marks a crashed (dead, running) job distinctly from a live one', async () => {
		const out = formatStatus({
			active: [],
			attention: [
				{
					slug: 'crashed',
					repo: 'r',
					branch: 'work/slice-crashed',
					startedAt: '2026-06-04T06:00:00.000Z',
					state: 'running',
					alive: false,
					dir: '/z',
				},
			],
		});
		expect(out).toMatch(/crashed/);
		// A running-but-dead job is flagged as not alive / crashed.
		expect(out.toLowerCase()).toMatch(/dead|crashed|not alive|no longer/);
	});
});

/**
 * Register a BARE hub mirror whose `main` ref carries a
 * `work/needs-attention/<slug>.md` with a reason block in the body (the shape
 * `routeToNeedsAttention` produces). `status` reads it from the mirror's bare
 * `main` ref through the read seam (mirrors have no working tree).
 */
function seedNeedsAttentionMirror(slug: string, reason: string): string {
	const content = [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		'---',
		'',
		'## What to build',
		'',
		'thing',
		'',
		'## Needs attention',
		'',
		reason,
		'',
	].join('\n');
	return registerMirrorWithWork(workspacesDir(), 'project', {
		needsAttention: {[`${slug}.md`]: content},
	}).mirrorPath;
}

describe('status — folder-native needs-attention surface (ADR §12)', () => {
	it("lists each mirror's work/needs-attention/ items (from the bare main ref) with their reason", async () => {
		const mirror = seedNeedsAttentionMirror(
			'stuck-slice',
			'rebase conflict against main',
		);
		const report = await status({
			workspacesDir: workspacesDir(),
			mirrorPaths: [mirror],
		});
		expect(report.needsAttention).toHaveLength(1);
		expect(report.needsAttention?.[0].repoPath).toBe(mirror);
		expect(report.needsAttention?.[0].items[0].slug).toBe('stuck-slice');
		expect(report.needsAttention?.[0].items[0].reason).toMatch(
			/rebase conflict against main/,
		);

		const out = formatStatus(report);
		expect(out.toLowerCase()).toContain('needs attention');
		expect(out).toMatch(/stuck-slice/);
		expect(out).toMatch(/rebase conflict against main/);
	});

	it('omits the surface entirely when no mirrorPaths are given', async () => {
		seedNeedsAttentionMirror('ignored', 'should not appear');
		const report = await status({workspacesDir: workspacesDir()});
		expect(report.needsAttention).toEqual([]);
	});
});

/** A needs-attention slice body (the shape `routeToNeedsAttention` produces). */
function needsAttentionBody(slug: string, reason: string): string {
	return [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		'---',
		'',
		'## Needs attention',
		'',
		reason,
		'',
	].join('\n');
}

describe('status — fetch-first (ADR §5/§6; offline-scan invariant retired)', () => {
	it('sees a needs-attention item pushed to the arbiter AFTER fetching', async () => {
		// A mirror with one needs-attention item; a SECOND is pushed onto its origin
		// only — the bare mirror's `main` is stale until status fetches.
		const mirror = registerMirrorWithWork(workspacesDir(), 'project', {
			needsAttention: {
				'first.md': needsAttentionBody('first', 'reason one'),
			},
		}).mirrorPath;
		pushWorkToMirrorOrigin(
			workspacesDir(),
			'project',
			'needs-attention',
			'second.md',
			needsAttentionBody('second', 'reason two'),
		);

		const report = await status({
			workspacesDir: workspacesDir(),
			mirrorPaths: [mirror],
		});
		const slugs = report.needsAttention?.[0].items.map((i) => i.slug).sort();
		expect(slugs).toEqual(['first', 'second']);
	});

	it('WARNS and falls back to last-known when the fetch FAILS (never errors)', async () => {
		const mirror = registerMirrorWithWork(workspacesDir(), 'project', {
			needsAttention: {
				'known.md': needsAttentionBody('known', 'known reason'),
			},
		}).mirrorPath;
		pushWorkToMirrorOrigin(
			workspacesDir(),
			'project',
			'needs-attention',
			'unseen.md',
			needsAttentionBody('unseen', 'never fetched'),
		);
		breakMirrorOrigin(mirror);

		const warnings: string[] = [];
		const report = await status({
			workspacesDir: workspacesDir(),
			mirrorPaths: [mirror],
			warn: (m) => warnings.push(m),
		});

		// Did NOT throw; still surfaces the last-known item (offline fall-back).
		expect(report.needsAttention?.[0].items.map((i) => i.slug)).toEqual([
			'known',
		]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].toLowerCase()).toMatch(/fetch|offline|last-known/);
	});
});

describe('status — arbiter fold-in (the old `arbiter status`, ADR §1/§7)', () => {
	it('renders the folded-in arbiter section when an arbiter report is given', async () => {
		const report = await status({
			workspacesDir: workspacesDir(),
			arbiter: {
				remote: 'arbiter',
				configured: true,
				url: 'file:///srv/git/o/r.git',
				path: '/srv/git/o/r.git',
				exists: true,
				bare: true,
				mainReachable: true,
				unsafe: false,
			},
		});
		expect(report.arbiter?.remote).toBe('arbiter');
		const out = formatStatus(report);
		expect(out).toMatch(/Arbiter remote: arbiter/);
		expect(out).toMatch(/file:\/\/\/srv\/git\/o\/r\.git/);
	});

	it('flags the unsafe non-bare-with-main arbiter in the dashboard', async () => {
		const report = await status({
			workspacesDir: workspacesDir(),
			arbiter: {
				remote: 'arbiter',
				configured: true,
				url: 'file:///srv/git/o/r',
				path: '/srv/git/o/r',
				exists: true,
				bare: false,
				mainReachable: true,
				unsafe: true,
			},
		});
		expect(formatStatus(report).toLowerCase()).toMatch(/unsafe|non-bare/);
	});
});
