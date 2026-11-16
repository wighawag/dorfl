import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	DEFAULT_MASS_DELETION_GUARD,
	MASS_DELETION_NOTE_HEADING,
	detectMassDeletions,
	isMassDeletion,
	massDeletionFollowUpPrompt,
	massDeletionGuardForTask,
	massDeletionReviewNote,
	parseNumstatZ,
	runWithMassDeletionGuard,
	withMassDeletionNote,
	type MassDeletion,
} from '../src/mass-deletion-guard.js';
import {DEFAULT_CONFIG, mergeConfig} from '../src/config.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {validateMassDeletionConfig} from '../src/config.js';
import {envOverrides} from '../src/env-config.js';
import {REPO_ALLOWED_KEYS} from '../src/repo-config.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';

/**
 * The mass-deletion guard (ADR
 * `mass-deletion-guard-asks-the-agent-once-then-tells-the-reviewer`): flag a
 * pre-existing file the build gutted, give the agent ONE follow-up turn, and
 * report what is still flagged for the PR body. These tests use a plain local
 * repo with a fake `arbiter/main` ref (no bare arbiter, nothing pushed).
 */

const lines = (n: number, tag = 'line') =>
	Array.from({length: n}, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n';

describe('parseNumstatZ', () => {
	it('parses plain, renamed and binary entries', () => {
		const out =
			'3\t313\tCONTEXT.md\0' +
			'1\t200\t\0old/a.md\0new/a.md\0' +
			'-\t-\tlogo.png\0' +
			'0\t5\tsp ace.txt\0';
		expect(parseNumstatZ(out)).toEqual([
			{path: 'CONTEXT.md', added: 3, deleted: 313},
			{path: 'new/a.md', oldPath: 'old/a.md', added: 1, deleted: 200},
			{path: 'sp ace.txt', added: 0, deleted: 5},
		]);
	});

	it('returns nothing for empty output', () => {
		expect(parseNumstatZ('')).toEqual([]);
	});
});

describe('isMassDeletion (the threshold rule)', () => {
	const guard = DEFAULT_MASS_DELETION_GUARD;
	it('flags the motivating incident (313 deleted, 3 added, of ~780)', () => {
		expect(isMassDeletion({baseLines: 780, lost: 310}, guard)).toBe(true);
	});
	it('flags a loss of more than `lines`, however big the file', () => {
		expect(isMassDeletion({baseLines: 100_000, lost: 151}, guard)).toBe(true);
		expect(isMassDeletion({baseLines: 100_000, lost: 150}, guard)).toBe(false);
	});
	it('flags a loss of more than `ratio` of the file', () => {
		expect(isMassDeletion({baseLines: 100, lost: 41}, guard)).toBe(true);
		expect(isMassDeletion({baseLines: 100, lost: 40}, guard)).toBe(false);
	});
	it('never flags a tiny loss on a tiny file (the 20-line floor)', () => {
		expect(isMassDeletion({baseLines: 10, lost: 9}, guard)).toBe(false);
		expect(isMassDeletion({baseLines: 30, lost: 20}, guard)).toBe(true);
	});
	it('never flags a net growth or an even rewrite', () => {
		expect(isMassDeletion({baseLines: 780, lost: 0}, guard)).toBe(false);
		expect(isMassDeletion({baseLines: 780, lost: -50}, guard)).toBe(false);
	});
	it('honours custom thresholds', () => {
		const strict = {enabled: true, lines: 10, ratio: 0.9};
		expect(isMassDeletion({baseLines: 1000, lost: 11}, strict)).toBe(true);
		expect(isMassDeletion({baseLines: 100, lost: 50}, strict)).toBe(true);
	});
});

describe('the prompt and the PR-body note', () => {
	const flagged: MassDeletion[] = [
		{
			path: 'CONTEXT.md',
			baseLines: 780,
			added: 3,
			deleted: 313,
			lost: 310,
			removed: false,
		},
		{
			path: 'docs/old.md',
			baseLines: 120,
			added: 0,
			deleted: 120,
			lost: 120,
			removed: true,
		},
	];

	it('the follow-up prompt names every file, the base, and both ways out', () => {
		const prompt = massDeletionFollowUpPrompt({
			slug: 'alpha',
			base: 'abc123',
			flagged,
		});
		expect(prompt).toContain("'alpha'");
		expect(prompt).toContain('`CONTEXT.md`: 310 of its 780 lines removed');
		expect(prompt).toContain('`docs/old.md`: file deleted (it had 120 lines)');
		expect(prompt).toContain('git show abc123:<path>');
		expect(prompt).toMatch(/part of what this task asked for/);
		expect(prompt).not.toContain('\u2014');
	});

	it('the follow-up prompt protects deliberately MOVED content (a split refactor)', () => {
		const prompt = massDeletionFollowUpPrompt({
			slug: 'alpha',
			base: 'abc123',
			flagged,
		});
		expect(prompt).toMatch(/MOVED elsewhere/);
		expect(prompt).toMatch(/file split/);
		expect(prompt).toMatch(/do NOT restore it/);
		expect(prompt).toMatch(/Only if the content was lost by accident/);
		expect(prompt).toMatch(/restoring moved code\s+duplicates it/);
	});

	it('the note carries the heading and says how the follow-up went', () => {
		const confirmed = massDeletionReviewNote({flagged, followUp: 'confirmed'});
		expect(confirmed.startsWith(MASS_DELETION_NOTE_HEADING)).toBe(true);
		expect(confirmed).toContain('kept them as intended');
		const failed = massDeletionReviewNote({flagged, followUp: 'failed'});
		expect(failed).toContain('follow-up turn');
		expect(failed).toContain('failed');
	});

	it('withMassDeletionNote appends under the summary, or stands alone', () => {
		expect(withMassDeletionNote('Summary.', undefined)).toBe('Summary.');
		expect(withMassDeletionNote(undefined, undefined)).toBeUndefined();
		expect(withMassDeletionNote('Summary.\n', 'NOTE')).toBe('Summary.\n\nNOTE');
		expect(withMassDeletionNote(undefined, 'NOTE')).toBe('NOTE');
	});
});

describe('per-task override: `massDeletionGuard:` in the task frontmatter', () => {
	const task = (line: string) =>
		[
			'---',
			'title: t',
			'slug: t',
			line,
			'blockedBy: []',
			'---',
			'',
			'body',
		].join('\n');
	it('parses true / false / omitted / malformed', () => {
		expect(
			parseFrontmatter(task('massDeletionGuard: false')).massDeletionGuard,
		).toBe(false);
		expect(
			parseFrontmatter(task('massDeletionGuard: true')).massDeletionGuard,
		).toBe(true);
		expect(
			parseFrontmatter(task('# nothing')).massDeletionGuard,
		).toBeUndefined();
		expect(
			parseFrontmatter(task('massDeletionGuard: maybe')).massDeletionGuard,
		).toBeUndefined();
	});
	it('a task opts out of (or into) the repo policy, keeping its thresholds', () => {
		const repo = {enabled: true, lines: 300, ratio: 0.5};
		expect(
			massDeletionGuardForTask(repo, task('massDeletionGuard: false')),
		).toEqual({
			...repo,
			enabled: false,
		});
		expect(
			massDeletionGuardForTask(
				{...repo, enabled: false},
				task('massDeletionGuard: true'),
			),
		).toEqual(repo);
		expect(massDeletionGuardForTask(repo, task('# nothing'))).toBe(repo);
		expect(massDeletionGuardForTask(undefined, task('# nothing'))).toEqual(
			DEFAULT_MASS_DELETION_GUARD,
		);
	});
});

describe('config: massDeletionGuard / massDeletionLines / massDeletionRatio', () => {
	it('defaults ON at 150 lines / 40%', () => {
		expect(DEFAULT_CONFIG.massDeletionGuard).toBe(true);
		expect(DEFAULT_CONFIG.massDeletionLines).toBe(150);
		expect(DEFAULT_CONFIG.massDeletionRatio).toBe(0.4);
	});
	it('is repo-settable and env-overridable', () => {
		expect(REPO_ALLOWED_KEYS).toContain('massDeletionGuard');
		expect(REPO_ALLOWED_KEYS).toContain('massDeletionLines');
		expect(REPO_ALLOWED_KEYS).toContain('massDeletionRatio');
		expect(
			envOverrides({
				DORFL_MASS_DELETION_GUARD: 'false',
				DORFL_MASS_DELETION_LINES: '300',
				DORFL_MASS_DELETION_RATIO: '0.5',
			}),
		).toMatchObject({
			massDeletionGuard: false,
			massDeletionLines: 300,
			massDeletionRatio: 0.5,
		});
	});
	it('rejects out-of-range thresholds loudly', () => {
		expect(() =>
			validateMassDeletionConfig(mergeConfig({massDeletionLines: 0})),
		).toThrow(/massDeletionLines/);
		expect(() =>
			validateMassDeletionConfig(mergeConfig({massDeletionRatio: 1.5})),
		).toThrow(/massDeletionRatio/);
		expect(() =>
			validateMassDeletionConfig(mergeConfig({massDeletionRatio: 0})),
		).toThrow(/massDeletionRatio/);
		expect(() => validateMassDeletionConfig(mergeConfig({}))).not.toThrow();
	});
});

describe('detectMassDeletions + runWithMassDeletionGuard (real git)', () => {
	let scratch: Scratch;
	let repo: string;
	const env = gitEnv();

	beforeEach(() => {
		scratch = makeScratch('dorfl-mass-deletion-');
		repo = join(scratch.root, 'repo');
		mkdirSync(join(repo, 'docs'), {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		writeFileSync(join(repo, 'CONTEXT.md'), lines(780, 'context'));
		writeFileSync(join(repo, 'docs', 'old.md'), lines(120, 'old'));
		writeFileSync(join(repo, 'small.md'), lines(10, 'small'));
		writeFileSync(join(repo, 'moved.md'), lines(300, 'moved'));
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'base'], repo);
		// Stand in for the fetched arbiter main the build started from.
		gitIn(['update-ref', 'refs/remotes/arbiter/main', 'HEAD'], repo);
		gitIn(['checkout', '-q', '-b', 'work/task-alpha'], repo);
	});
	afterEach(() => scratch.cleanup());

	const gut = () => {
		// The incident: a whole-file "rewrite" that came out truncated.
		writeFileSync(
			join(repo, 'CONTEXT.md'),
			lines(467, 'context') + 'new a\nnew b\nnew c\n',
		);
	};
	const detect = () =>
		detectMassDeletions({cwd: repo, arbiter: 'arbiter', env});

	it('flags a gutted file (uncommitted) and a deleted file, not a small trim', () => {
		gut();
		rmSync(join(repo, 'docs', 'old.md'));
		writeFileSync(join(repo, 'small.md'), lines(2, 'small'));
		const flagged = detect();
		expect(flagged.map((d) => d.path).sort()).toEqual([
			'CONTEXT.md',
			'docs/old.md',
		]);
		const ctx = flagged.find((d) => d.path === 'CONTEXT.md')!;
		expect(ctx).toMatchObject({baseLines: 780, deleted: 313, added: 3});
		expect(ctx.removed).toBe(false);
		expect(flagged.find((d) => d.path === 'docs/old.md')!.removed).toBe(true);
	});

	it('sees committed work on the branch too', () => {
		gut();
		gitIn(['commit', '-q', '-am', 'wip'], repo);
		expect(detect().map((d) => d.path)).toEqual(['CONTEXT.md']);
	});

	it('does not flag a pure rename, a brand-new file, or a disabled guard', () => {
		gitIn(['mv', 'moved.md', 'docs/moved.md'], repo);
		writeFileSync(join(repo, 'brand-new.md'), lines(500));
		expect(detect()).toEqual([]);
		gut();
		expect(
			detectMassDeletions({
				cwd: repo,
				arbiter: 'arbiter',
				env,
				guard: {...DEFAULT_MASS_DELETION_GUARD, enabled: false},
			}),
		).toEqual([]);
	});

	it('flags nothing when the base cannot be resolved (best-effort)', () => {
		gut();
		expect(detectMassDeletions({cwd: repo, arbiter: 'nope', env})).toEqual([]);
	});

	it('a clean build that deleted nothing launches the agent exactly once', async () => {
		const prompts: string[] = [];
		const result = await runWithMassDeletionGuard({
			launch: (p) => {
				prompts.push(p);
				writeFileSync(join(repo, 'feature.ts'), 'export {};\n');
				return {ok: true, output: 'Built it.'};
			},
			prompt: 'BUILD',
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env,
		});
		expect(prompts).toEqual(['BUILD']);
		expect(result.massDeletionNote).toBeUndefined();
		expect(result.output).toBe('Built it.');
	});

	it('asks once; a restored file leaves no note and keeps the build summary', async () => {
		const prompts: string[] = [];
		const sessions: (string | undefined)[] = [];
		const result = await runWithMassDeletionGuard({
			launch: (p, session) => {
				prompts.push(p);
				sessions.push(session);
				if (prompts.length === 1) {
					gut();
					return {
						ok: true,
						output: 'Built it.',
						record: {session: '/s/build.jsonl'},
					};
				}
				writeFileSync(
					join(repo, 'CONTEXT.md'),
					lines(780, 'context') + 'new a\n',
				);
				return {ok: true, output: 'Restored CONTEXT.md.'};
			},
			prompt: 'BUILD',
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env,
		});
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain('`CONTEXT.md`: 310 of its 780 lines removed');
		// The follow-up resumes the build's own session.
		expect(sessions).toEqual([undefined, '/s/build.jsonl']);
		expect(result.massDeletionNote).toBeUndefined();
		expect(result.output).toBe('Built it.');
		expect(readFileSync(join(repo, 'CONTEXT.md'), 'utf8')).toContain(
			'context 780',
		);
	});

	it('a deletion the agent confirms is still reported for the reviewer', async () => {
		let calls = 0;
		const result = await runWithMassDeletionGuard({
			launch: () => {
				calls++;
				if (calls === 1) {
					gut();
					return {ok: true, output: 'Built it.'};
				}
				return {ok: true, output: 'CONTEXT.md: the task asked for this.'};
			},
			prompt: 'BUILD',
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env,
		});
		expect(calls).toBe(2);
		expect(result.ok).toBe(true);
		expect(result.output).toBe('Built it.');
		expect(result.massDeletionNote).toContain(MASS_DELETION_NOTE_HEADING);
		expect(result.massDeletionNote).toContain('CONTEXT.md');
		expect(result.massDeletionNote).toContain('kept them as intended');
	});

	it('a failed follow-up keeps the first (ok) result and says so in the note', async () => {
		let calls = 0;
		const result = await runWithMassDeletionGuard({
			launch: () => {
				calls++;
				if (calls === 1) {
					gut();
					return {ok: true, output: 'Built it.'};
				}
				return {ok: false, detail: 'model outage'};
			},
			prompt: 'BUILD',
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env,
		});
		expect(result.ok).toBe(true);
		expect(result.massDeletionNote).toMatch(/follow-up turn[\s\S]*failed/);
	});

	it('a follow-up that hits the deadline hands back timedOut for the checkpoint', async () => {
		let calls = 0;
		const result = await runWithMassDeletionGuard<{
			ok: boolean;
			output?: string;
			timedOut?: boolean;
		}>({
			launch: () => {
				calls++;
				if (calls === 1) {
					gut();
					return {ok: true, output: 'Built it.'};
				}
				return {ok: false, timedOut: true};
			},
			prompt: 'BUILD',
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env,
		});
		expect(result.timedOut).toBe(true);
		expect(result.output).toBe('Built it.');
	});

	it('skips the guard on a failed, cut-off or TASK-STOP first turn', async () => {
		for (const first of [
			{ok: false},
			{ok: true, cutOffTurn: {stopReason: 'length'}},
			{
				ok: true,
				output: '=== TASK-STOP ===\ndrifted\n=== END TASK-STOP ===',
			},
		]) {
			let calls = 0;
			await runWithMassDeletionGuard({
				launch: () => {
					calls++;
					gut();
					return first;
				},
				prompt: 'BUILD',
				slug: 'alpha',
				cwd: repo,
				arbiter: 'arbiter',
				env,
			});
			expect(calls).toBe(1);
		}
	});
});
