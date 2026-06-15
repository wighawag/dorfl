import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCloseJob} from '../src/close-job.js';
import type {
	IssueProvider,
	CloseIssueInput,
	CloseIssueResult,
	GetIssueInput,
	Issue,
	ListCommentsInput,
	IssueComment,
	PostIssueCommentInput,
	PostIssueCommentResult,
	LabelInput,
	GetLabelsResult,
	AddLabelInput,
	RemoveLabelInput,
	LabelResult,
} from '../src/issue-provider.js';

/**
 * `install-ci-close-job-workflow` — the CI CLOSE-JOB driver (capability E). The
 * driver WIRES three UNCHANGED engine pieces (the resolution `resolveClosingIssue`,
 * the "PRD complete?" query `prd-complete-query`, and `IssueProvider.closeIssue`)
 * and re-implements NONE of them.
 *
 * SEAM: the `IssueProvider` is a STUB that records every `closeIssue` call IN
 * MEMORY — NO network, NO real `gh`, NO real GitHub issue touched (the slice's
 * shared-write isolation: the stubbed close seam records calls in-memory without
 * touching a real issue). The query/resolution behaviour itself is already covered
 * by `prd-complete-query` / `frontmatter` tests and is NOT re-tested here; these
 * tests cover the DRIVER's wiring + closure conditions only.
 */

/** A stub issue provider: records `closeIssue` calls in memory, closes none for real. */
class MemoryIssueProvider implements IssueProvider {
	readonly name = 'memory';
	/** Every `closeIssue` call, in order — the in-memory record (no real issue). */
	readonly closeCalls: CloseIssueInput[] = [];
	/** When false, `closeIssue` reports a degraded close (provider unavailable). */
	private readonly canClose: boolean;

	constructor(opts: {canClose?: boolean} = {}) {
		this.canClose = opts.canClose ?? true;
	}

	async closeIssue(input: CloseIssueInput): Promise<CloseIssueResult> {
		this.closeCalls.push(input);
		if (!this.canClose) {
			return {
				closed: false,
				reason: 'stub: provider unavailable',
				instruction: `could not close issue #${input.issueNumber}`,
			};
		}
		return {closed: true, instruction: `Closed issue #${input.issueNumber}.`};
	}

	// The rest of the seam is unused by the close-job driver — minimal stubs.
	async getIssue(input: GetIssueInput): Promise<Issue> {
		return {number: input.issueNumber, title: '', body: ''};
	}
	async listComments(_input: ListCommentsInput): Promise<IssueComment[]> {
		return [];
	}
	async postIssueComment(
		_input: PostIssueCommentInput,
	): Promise<PostIssueCommentResult> {
		return {posted: true, instruction: ''};
	}
	async getLabels(_input: LabelInput): Promise<GetLabelsResult> {
		return {outcome: 'ok', supported: true, labels: [], instruction: ''};
	}
	async addLabel(_input: AddLabelInput): Promise<LabelResult> {
		return {outcome: 'applied', applied: true, instruction: ''};
	}
	async removeLabel(_input: RemoveLabelInput): Promise<LabelResult> {
		return {outcome: 'applied', applied: true, instruction: ''};
	}
}

let root: string;

function repoPath(): string {
	return join(root, 'repo');
}

/** Seed one `work/<folder>/<file>.md` artifact with the given frontmatter. */
function write(
	folder: string,
	file: string,
	frontmatter: Record<string, string>,
): void {
	const dir = join(repoPath(), 'work', folder);
	mkdirSync(dir, {recursive: true});
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', 'body');
	writeFileSync(join(dir, file), lines.join('\n'));
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-close-job-'));
});
afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

describe('runCloseJob — the PRD case (consumes the "PRD complete?" query)', () => {
	it('closes the PRD issue when ALL its prd:<slug> slices are in work/done/', async () => {
		write('prd', 'my-prd.md', {slug: 'my-prd', issue: '42'});
		write('done', 'a.md', {slug: 'a', prd: 'my-prd'});
		write('done', 'b.md', {slug: 'b', prd: 'my-prd'});

		const provider = new MemoryIssueProvider();
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});

		expect(result.closed).toEqual([42]);
		expect(provider.closeCalls).toHaveLength(1);
		// The close went through the seam with reason `completed` + a comment riding
		// the SAME atomic call (never the PR comment seam).
		expect(provider.closeCalls[0]).toMatchObject({
			issueNumber: 42,
			reason: 'completed',
		});
		expect(provider.closeCalls[0].comment).toContain('my-prd');
		expect(result.candidates.find((c) => c.issueNumber === 42)?.decision).toBe(
			'closed',
		);
	});

	it('leaves the PRD issue OPEN when a prd:<slug> slice is NOT yet in work/done/', async () => {
		write('prd', 'my-prd.md', {slug: 'my-prd', issue: '42'});
		write('done', 'a.md', {slug: 'a', prd: 'my-prd'});
		write('backlog', 'b.md', {slug: 'b', prd: 'my-prd'}); // not landed

		const provider = new MemoryIssueProvider();
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});

		expect(result.closed).toEqual([]);
		expect(provider.closeCalls).toHaveLength(0);
		expect(result.candidates.find((c) => c.issueNumber === 42)?.decision).toBe(
			'not-complete',
		);
	});

	it('finds the PRD issue from work/prd-sliced/ too (a PRD that has been sliced)', async () => {
		write('prd-sliced', 'my-prd.md', {slug: 'my-prd', issue: '7'});
		write('done', 'a.md', {slug: 'a', prd: 'my-prd'});

		const provider = new MemoryIssueProvider();
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});

		expect(result.closed).toEqual([7]);
	});
});

describe('runCloseJob — the lone-slice case (closes its own issue:)', () => {
	it('closes a lone slice (issue:, no prd:) once it lands in work/done/', async () => {
		write('done', 'lone.md', {slug: 'lone', issue: '13'});

		const provider = new MemoryIssueProvider();
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});

		expect(result.closed).toEqual([13]);
		expect(provider.closeCalls[0]).toMatchObject({
			issueNumber: 13,
			reason: 'completed',
		});
		expect(provider.closeCalls[0].comment).toContain('lone');
	});

	it('leaves a lone slice OPEN while it is still outside work/done/', async () => {
		write('backlog', 'lone.md', {slug: 'lone', issue: '13'});

		const provider = new MemoryIssueProvider();
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});

		expect(result.closed).toEqual([]);
		expect(provider.closeCalls).toHaveLength(0);
		expect(result.candidates.find((c) => c.issueNumber === 13)?.decision).toBe(
			'not-landed',
		);
	});
});

describe('runCloseJob — resolution precedence + linkage (resolveClosingIssue)', () => {
	it('a fanned slice carries prd: (NOT issue:) and reaches the number via the PRD only', async () => {
		// The PRD carries the issue number; the fanned slice carries `prd:` only.
		write('prd', 'my-prd.md', {slug: 'my-prd', issue: '42'});
		write('done', 'a.md', {slug: 'a', prd: 'my-prd'});

		const provider = new MemoryIssueProvider();
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});

		// Closed exactly ONCE, via the PRD candidate — the slice never resolves its
		// own issue (it has none); the number lives only on the PRD.
		expect(result.closed).toEqual([42]);
		expect(result.candidates.filter((c) => c.issueNumber === 42)).toHaveLength(
			1,
		);
		expect(result.candidates.find((c) => c.issueNumber === 42)?.via).toBe(
			'prd',
		);
	});

	it('on a hand-edited slice carrying BOTH prd: and issue:, prd: WINS (issue: ignored)', async () => {
		// A contradiction only a human hand-edit could produce; resolveClosingIssue
		// makes `prd:` win, so the slice is NOT a lone-slice candidate for issue 99.
		write('prd', 'my-prd.md', {slug: 'my-prd', issue: '42'});
		write('done', 'a.md', {slug: 'a', prd: 'my-prd', issue: '99'});

		const provider = new MemoryIssueProvider();
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});

		// Only the PRD's issue 42 is closed; the slice's stray `issue: 99` is ignored.
		expect(result.closed).toEqual([42]);
		expect(result.candidates.some((c) => c.issueNumber === 99)).toBe(false);
	});

	it('considers each PRD issue ONCE even with many slices pointing at it (dedup)', async () => {
		write('prd', 'my-prd.md', {slug: 'my-prd', issue: '42'});
		write('done', 'a.md', {slug: 'a', prd: 'my-prd'});
		write('done', 'b.md', {slug: 'b', prd: 'my-prd'});
		write('done', 'c.md', {slug: 'c', prd: 'my-prd'});

		const provider = new MemoryIssueProvider();
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});

		expect(provider.closeCalls).toHaveLength(1);
		expect(result.closed).toEqual([42]);
	});

	it('ignores artifacts with NO closure link (no issue:, no prd:)', async () => {
		write('done', 'plain.md', {slug: 'plain'});
		write('prd', 'no-issue-prd.md', {slug: 'no-issue-prd'});

		const provider = new MemoryIssueProvider();
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});

		expect(result.candidates).toEqual([]);
		expect(result.closed).toEqual([]);
		expect(provider.closeCalls).toHaveLength(0);
	});
});

describe('runCloseJob — DEGRADES, never throws (terminal CI tick)', () => {
	it('reports close-failed (not a crash) when the provider close degrades', async () => {
		write('done', 'lone.md', {slug: 'lone', issue: '13'});

		const provider = new MemoryIssueProvider({canClose: false});
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});

		// The closure condition held, but the provider could not close — reported,
		// not thrown; the issue is NOT counted as closed.
		expect(result.closed).toEqual([]);
		expect(provider.closeCalls).toHaveLength(1);
		const cand = result.candidates.find((c) => c.issueNumber === 13);
		expect(cand?.decision).toBe('close-failed');
		expect(cand?.reason).toBeDefined();
	});

	it('an absent work/ tree closes nothing (no crash)', async () => {
		const provider = new MemoryIssueProvider();
		const result = await runCloseJob({
			repoPath: repoPath(),
			issueProvider: provider,
		});
		expect(result.candidates).toEqual([]);
		expect(result.closed).toEqual([]);
	});
});
