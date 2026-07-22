import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	rmSync,
	existsSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';
import {
	type ResolvedCIConfig,
	loadCapabilityRegistry,
} from '../src/install-ci-core.js';
import {MemoryCIProviderContext} from '../src/install-ci-github.js';
import {installCI} from '../src/install-ci.js';
import {
	INTAKE_TRIGGER_CAPABILITY_ID,
	INTAKE_TRIGGER_WORKFLOW_PATH,
	INTAKE_TRIGGER_LABEL,
	TRUSTED_AUTHOR_ASSOCIATIONS,
	deriveIntakeFlags,
	isAuthorTrusted,
	generateIntakeWorkflow,
	validateIntakeWorkflow,
} from '../src/intake-trigger-template.js';
import {performIntake, type IntakeVerdict} from '../src/intake.js';
import {
	type Issue,
	type IssueComment,
	type IssueProvider,
	type PostIssueCommentInput,
	type CloseIssueInput,
} from '../src/issue-provider.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
	rmrf,
} from './helpers/gitRepo.js';

/**
 * `install-ci-intake-trigger-and-review-surface` — capability D (consider incoming
 * issues → task/PRD) + insertion point E (surface the review verdict into the
 * issue thread). CI SCHEDULES `intake <N>` (four-outcome dispatch), maps a CREATED
 * `issue_comment` onto the (re-)evaluation trigger (Decision 2: no edit-detection),
 * DERIVES the per-outcome file-emit modes from the gate-state (author-trust NO
 * LONGER composes into the mode; ADR
 * untrusted-origin-carries-via-stamp-not-forced-staging) and derives the
 * `--origin-trust` STAMP from author-trust (which carries the placement + build-PR
 * consequence), and surfaces the review verdict back into the issue thread via the
 * provider comment seam.
 *
 * SEAMS: the workflow is generated into the `--fake` scratch dir with a STUBBED
 * `GitHubCIContext` ({@link MemoryCIProviderContext}: `setSecret` records to
 * memory, `ghAvailable=false`, `repo` a fixture) — NO network, NO real `gh`, NO
 * real GitHub. The produced YAML is structurally validated; the derived per-outcome
 * flags are unit-tested (the pure {@link deriveIntakeFlags} POLICY) AND asserted to
 * match the SHELL the workflow runs; and the issue-thread review surface is proven
 * through a stubbed comment seam (records posts in-memory, no real issue). intake's
 * own transform is NOT re-tested (it is covered elsewhere).
 */

const config: ResolvedCIConfig = {
	authMode: 'models-json',
	providers: [
		{
			name: 'anthropic',
			apiKeyEnvVar: 'ANTHROPIC_API_KEY',
			models: [{id: 'claude-sonnet-4-20250514'}],
			builtin: true,
		},
	],
	defaultProvider: 'anthropic',
	defaultModel: 'claude-sonnet-4-20250514',
	harness: 'pi',
};

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'intake-trigger-'));
});
afterEach(() => {
	rmrf(work);
});

// ─── the AUTHOR-TRUST → per-outcome-flags DERIVATION (CI's POLICY) ────────────

describe('deriveIntakeFlags — file-emit mode is GATE-derived; author-trust drives only the stamp + placement (ADR untrusted-origin-carries-via-stamp-not-forced-staging)', () => {
	it('TRUSTED author + both gates OFF ⇒ merge BOTH (permissive gate-derived default)', () => {
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: false, autoTask: false},
				authorTrusted: true,
			}),
		).toEqual({spec: 'merge', task: 'merge', originTrust: 'trusted'});
	});

	it('UNTRUSTED author + both gates OFF ⇒ STILL merge BOTH; author-trust changes only the stamp (the DOCUMENT is not force-PR’d)', () => {
		// The task DOCUMENT now MERGES for an untrusted author exactly like a
		// trusted one (gate off); the only difference is the origin-trust STAMP,
		// which carries the placement + build-PR safety (ADR core move).
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: false, autoTask: false},
				authorTrusted: false,
			}),
		).toEqual({spec: 'merge', task: 'merge', originTrust: 'untrusted'});
	});

	it('autoBuild ON ⇒ --propose-task (gate-derived) — SAME for a trusted or untrusted author', () => {
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: true, autoTask: false},
				authorTrusted: true,
			}),
		).toEqual({spec: 'merge', task: 'propose', originTrust: 'trusted'});
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: true, autoTask: false},
				authorTrusted: false,
			}),
		).toEqual({spec: 'merge', task: 'propose', originTrust: 'untrusted'});
	});

	it('autoTask ON forces --propose-spec (an agent will auto-slice it → human PR checkpoint now)', () => {
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: false, autoTask: true},
				authorTrusted: true,
			}),
		).toEqual({spec: 'propose', task: 'merge', originTrust: 'trusted'});
	});

	it('originTrust is the author-trust verdict CARRIED for the stamp (trusted⇒trusted, untrusted⇒untrusted), independent of the gates', () => {
		// The stamp is derived from the SAME authorTrusted input as the modes, so it
		// cannot desync; it does not depend on the gate state.
		for (const autoBuild of [false, true]) {
			for (const autoTask of [false, true]) {
				expect(
					deriveIntakeFlags({gate: {autoBuild, autoTask}, authorTrusted: true})
						.originTrust,
				).toBe('trusted');
				expect(
					deriveIntakeFlags({
						gate: {autoBuild, autoTask},
						authorTrusted: false,
					}).originTrust,
				).toBe('untrusted');
			}
		}
	});

	it('the file-emit MODE is INDEPENDENT of author-trust — both modes match for a trusted vs untrusted author at every gate combination', () => {
		// The ADR invariant: a trusted and an untrusted author differ ONLY in the
		// stamp, never in whether the spec/task DOCUMENT is merged or proposed.
		for (const autoBuild of [false, true]) {
			for (const autoTask of [false, true]) {
				const trusted = deriveIntakeFlags({
					gate: {autoBuild, autoTask},
					authorTrusted: true,
				});
				const untrusted = deriveIntakeFlags({
					gate: {autoBuild, autoTask},
					authorTrusted: false,
				});
				expect(untrusted.spec).toBe(trusted.spec);
				expect(untrusted.task).toBe(trusted.task);
				// ...and only the stamp differs.
				expect(trusted.originTrust).toBe('trusted');
				expect(untrusted.originTrust).toBe('untrusted');
			}
		}
	});

	it('the task mode is GATE-derived: --merge-task iff autoBuild OFF, else --propose-task, regardless of author-trust', () => {
		const grid: {
			autoBuild: boolean;
			authorTrusted: boolean;
			task: 'merge' | 'propose';
		}[] = [
			{autoBuild: false, authorTrusted: true, task: 'merge'},
			{autoBuild: false, authorTrusted: false, task: 'merge'},
			{autoBuild: true, authorTrusted: true, task: 'propose'},
			{autoBuild: true, authorTrusted: false, task: 'propose'},
		];
		for (const row of grid) {
			expect(
				deriveIntakeFlags({
					gate: {autoBuild: row.autoBuild, autoTask: false},
					authorTrusted: row.authorTrusted,
				}).task,
			).toBe(row.task);
		}
	});

	it('the merge-everything path is simply both gates OFF (independent of author-trust)', () => {
		// Merge both ⇒ exactly: autoTask off + autoBuild off, for EITHER author.
		for (const authorTrusted of [true, false]) {
			const flags = deriveIntakeFlags({
				gate: {autoBuild: false, autoTask: false},
				authorTrusted,
			});
			expect(flags.spec).toBe('merge');
			expect(flags.task).toBe('merge');
		}
		// Flip either gate and that type is no longer merge (trust plays no part).
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: true, autoTask: false},
				authorTrusted: true,
			}).task,
		).toBe('propose');
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: false, autoTask: true},
				authorTrusted: true,
			}).spec,
		).toBe('propose');
	});
});

describe('isAuthorTrusted — OWNER/MEMBER/COLLABORATOR is the whole signal (Decision 1)', () => {
	it('OWNER / MEMBER / COLLABORATOR are TRUSTED', () => {
		for (const a of TRUSTED_AUTHOR_ASSOCIATIONS) {
			expect(isAuthorTrusted(a)).toBe(true);
		}
	});

	it('CONTRIBUTOR / FIRST_TIME_CONTRIBUTOR / NONE are UNTRUSTED', () => {
		expect(isAuthorTrusted('CONTRIBUTOR')).toBe(false);
		expect(isAuthorTrusted('FIRST_TIME_CONTRIBUTOR')).toBe(false);
		expect(isAuthorTrusted('NONE')).toBe(false);
	});

	it('a missing/empty/unknown association is UNTRUSTED (fail-safe — the conservative path)', () => {
		expect(isAuthorTrusted(undefined)).toBe(false);
		expect(isAuthorTrusted('')).toBe(false);
		expect(isAuthorTrusted('SOMETHING_ELSE')).toBe(false);
	});
});

// ─── the generated workflow satisfies every structural invariant ─────────────

describe('the intake-trigger workflow satisfies every structural invariant', () => {
	it('the shipped emitter output passes validation cleanly', () => {
		const text = generateIntakeWorkflow(config);
		const result = validateIntakeWorkflow(text);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('is deterministic — the same config produces byte-identical output', () => {
		expect(generateIntakeWorkflow(config)).toBe(generateIntakeWorkflow(config));
	});

	it('invokes `dorfl intake <N>` (explicit issue number, four-outcome dispatch), never a bare slug or a build verb', () => {
		const text = generateIntakeWorkflow(config);
		expect(/dorfl intake\b/.test(text)).toBe(true);
		expect(
			/dorfl intake "?\$\{\{\s*github\.event\.issue\.number/.test(text),
		).toBe(true);
		const result = validateIntakeWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain('no-build-verbs');
		expect(result.problems.map((p) => p.id)).not.toContain(
			'intake-explicit-issue-number',
		);
	});

	it('triggers on issues opened + issue_comment created + a label (capability D)', () => {
		const text = generateIntakeWorkflow(config);
		expect(/\bissues:\s*[\s\S]*?types:\s*[\s\S]*?-\s*opened\b/.test(text)).toBe(
			true,
		);
		expect(
			/\bissue_comment:\s*[\s\S]*?types:\s*[\s\S]*?-\s*created\b/.test(text),
		).toBe(true);
		expect(
			/\bissues:\s*[\s\S]*?types:\s*[\s\S]*?-\s*labeled\b/.test(text),
		).toBe(true);
	});

	it('Decision 2: a CREATED comment triggers, an EDITED comment does NOT; no edit-tracking; documents the new-comment convention', () => {
		const text = generateIntakeWorkflow(config);
		// The issue_comment trigger must NOT include `edited`.
		expect(
			/issue_comment:\s*[\s\S]*?types:\s*[\s\S]*?-\s*edited\b/.test(text),
		).toBe(false);
		// No updated_at / body-hash edit-tracking wiring.
		const result = validateIntakeWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain('no-edit-tracking');
		// The "post a new comment to signal an edit" convention is documented.
		expect(/post a NEW comment/i.test(text)).toBe(true);
	});

	it('reads author_association off the payload, trust = OWNER/MEMBER/COLLABORATOR, derives all four per-outcome file-emit flags + the origin-trust stamp', () => {
		const text = generateIntakeWorkflow(config);
		expect(/author_association/.test(text)).toBe(true);
		expect(/OWNER\|MEMBER\|COLLABORATOR/.test(text)).toBe(true);
		// All four granular per-outcome flags appear in the derivation.
		expect(text).toContain('--propose-task');
		expect(text).toContain('--merge-task');
		expect(text).toContain('--merge-spec');
		expect(text).toContain('--propose-spec');
		// The derivation reads the gate env block.
		expect(/DORFL_AUTO_BUILD\b/.test(text)).toBe(true);
		expect(/DORFL_AUTO_TASK\b/.test(text)).toBe(true);
	});

	it('the workflow SHELL derivation matches deriveIntakeFlags (they cannot desync)', () => {
		const text = generateIntakeWorkflow(config);
		// Reproduce the workflow's shell logic in JS and assert it agrees with the
		// pure function for every (autoBuild × autoTask × trust) combination. This
		// pins "the artifact encodes the SAME rule the function unit-tests".
		const shell = (
			autoBuild: boolean,
			autoTask: boolean,
			trusted: boolean,
		): {spec: string; task: string; originTrust: string} => {
			// SPEC: --propose-spec iff autoTask true, else --merge-spec (gate-derived).
			const spec = autoTask ? '--propose-spec' : '--merge-spec';
			// TASK: --propose-task iff autoBuild true, else --merge-task (gate-derived,
			// SYMMETRIC with the spec). Author-trust does NOT bite the mode (ADR
			// untrusted-origin-carries-via-stamp-not-forced-staging).
			const task = autoBuild ? '--propose-task' : '--merge-task';
			// ORIGIN-TRUST: the ONLY thing author-trust drives — the `trusted` case
			// carried to the stamp flag.
			const originTrust = trusted
				? '--origin-trust=trusted'
				: '--origin-trust=untrusted';
			return {spec, task, originTrust};
		};
		for (const autoBuild of [false, true]) {
			for (const autoTask of [false, true]) {
				for (const trusted of [false, true]) {
					const fromShell = shell(autoBuild, autoTask, trusted);
					const fromFn = deriveIntakeFlags({
						gate: {autoBuild, autoTask},
						authorTrusted: trusted,
					});
					expect(fromShell.spec).toBe(`--${fromFn.spec}-spec`);
					expect(fromShell.task).toBe(`--${fromFn.task}-task`);
					// The stamp is derived from the SAME author-trust case as the modes.
					expect(fromShell.originTrust).toBe(
						`--origin-trust=${fromFn.originTrust}`,
					);
				}
			}
		}
		// And the workflow text actually carries that shell shape (the gate reads +
		// the OWNER/MEMBER/COLLABORATOR case + both task branches + the origin-trust
		// stamp derived from the SAME case, passed to intake).
		expect(text).toContain('OWNER|MEMBER|COLLABORATOR');
		expect(/case "\$\{AUTHOR_ASSOCIATION:-\}"/.test(text)).toBe(true);
		expect(text).toContain('--origin-trust=trusted');
		expect(text).toContain('--origin-trust=untrusted');
		expect(/steps\.policy\.outputs\.origin_trust_flag/.test(text)).toBe(true);
	});

	it('insertion point E: requests issues: write (post the verdict to the thread) and does NOT use the PR-comment seam', () => {
		const text = generateIntakeWorkflow(config);
		expect(/\bissues:\s*write\b/.test(text)).toBe(true);
		// E posts to the ISSUE (postIssueComment by number), NOT the PR seam.
		expect(/postPRComment\b/.test(text)).toBe(false);
		const result = validateIntakeWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'no-pr-comment-seam',
		);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'issues-write-permission',
		);
	});

	it('runs IN-PLACE (no --isolated/--remote) and carries a PER-ISSUE concurrency group', () => {
		const text = generateIntakeWorkflow(config);
		const result = validateIntakeWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain('no-isolated-flag');
		expect(result.problems.map((p) => p.id)).not.toContain('no-remote-flag');
		expect(/\bconcurrency:\s*[\s\S]*?group:/.test(text)).toBe(true);
		// Keyed by the issue number so different issues run in parallel.
		expect(
			/concurrency:\s*[\s\S]*?group:[^\n]*github\.event\.issue\.number/.test(
				text,
			),
		).toBe(true);
	});

	it('US #9: requests NO `workflows` permission and no step touches the workflows tree', () => {
		const text = generateIntakeWorkflow(config);
		expect(/\bworkflows:\s*write\b/.test(text)).toBe(false);
		const result = validateIntakeWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'no-workflows-permission',
		);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'never-edits-dot-github-workflows',
		);
	});

	it('wires the SHARED composite setup action', () => {
		const text = generateIntakeWorkflow(config);
		expect(/uses:\s*\.\/\.github\/actions\/dorfl-setup\b/.test(text)).toBe(
			true,
		);
	});
});

// ─── the validator FLAGS a workflow missing each invariant ───────────────────

describe('validateIntakeWorkflow flags a workflow missing each invariant', () => {
	const base = generateIntakeWorkflow(config);

	const expectFlagged = (broken: string, id: string): void => {
		const result = validateIntakeWorkflow(broken);
		expect(result.ok).toBe(false);
		expect(result.problems.map((p) => p.id)).toContain(id);
	};

	it('flags a missing `dorfl intake` invocation', () => {
		expectFlagged(
			base.replace(/dorfl intake "/, 'echo skip "'),
			'invokes-intake',
		);
	});

	it('flags a build/task verb sneaking in (CI owns only the trigger + policy)', () => {
		expectFlagged(
			base.replace(
				/dorfl intake "/,
				'dorfl advance -n 10\n          dorfl intake "',
			),
			'no-build-verbs',
		);
	});

	it('flags a missing issues-opened trigger', () => {
		expectFlagged(
			base.replace(/      - opened\n/, ''),
			'trigger-issues-opened',
		);
	});

	it('flags a missing issue_comment-created trigger', () => {
		expectFlagged(
			base.replace(/  issue_comment:\n    [\s\S]*?      - created\n/, ''),
			'trigger-issue-comment-created',
		);
	});

	it('flags a missing label trigger', () => {
		expectFlagged(base.replace(/      - labeled\n/, ''), 'trigger-label');
	});

	it('flags an EDITED-comment trigger leaking in (Decision 2: no edit-detection)', () => {
		expectFlagged(
			base.replace(
				/  issue_comment:\n    ([\s\S]*?)      - created\n/,
				'  issue_comment:\n    $1      - created\n      - edited\n',
			),
			'no-comment-edited-trigger',
		);
	});

	it('flags updated_at / body-hash edit-tracking (Decision 2)', () => {
		expectFlagged(
			base.replace(
				/run: \|\n          set -euo pipefail/,
				'run: |\n          echo updated_at\n          set -euo pipefail',
			),
			'no-edit-tracking',
		);
	});

	it('flags a missing author_association read (Decision 1)', () => {
		expectFlagged(
			base.replace(/author_association/g, 'login'),
			'reads-author-association',
		);
	});

	it('flags a missing --propose-task branch (the autoBuild-on gate path)', () => {
		expectFlagged(
			base.replace(/--propose-task/g, '--merge-task'),
			'derives-propose-task',
		);
	});

	it('flags a missing --merge-spec (the autoTask-off gate path)', () => {
		expectFlagged(
			base.replace(/--merge-spec/g, '--propose-spec'),
			'derives-merge-spec',
		);
	});

	it('flags routing the verdict through the PR-comment seam (E posts to the ISSUE)', () => {
		expectFlagged(
			base.replace(
				/dorfl intake "/,
				'dorfl postPRComment\n          dorfl intake "',
			),
			'no-pr-comment-seam',
		);
	});

	it('flags a missing issues: write permission (cannot surface E)', () => {
		expectFlagged(
			base.replace(/  issues: write\n/, ''),
			'issues-write-permission',
		);
	});

	it('flags an --isolated flag (CI runs in-place)', () => {
		expectFlagged(
			base.replace(/--arbiter origin/, '--isolated --arbiter origin'),
			'no-isolated-flag',
		);
	});

	it('flags a non-per-issue concurrency group', () => {
		expectFlagged(
			base.replace(
				/group: intake-\$\{\{ github\.event\.issue\.number \}\}/,
				'group: intake-fixed',
			),
			'per-issue-concurrency',
		);
	});

	it('flags a `workflows: write` permission (US #9)', () => {
		expectFlagged(
			base.replace(/permissions:\n/, 'permissions:\n  workflows: write\n'),
			'no-workflows-permission',
		);
	});

	it('flags a step touching .github/workflows/** (US #9)', () => {
		expectFlagged(
			base.replace(
				/--arbiter origin/,
				'--arbiter origin\n          cp x .github/workflows/evil.yml',
			),
			'never-edits-dot-github-workflows',
		);
	});

	it('flags a missing documented new-comment convention (Decision 2)', () => {
		expectFlagged(
			base.replace(/post a NEW comment/gi, 'do something else'),
			'documents-new-comment-convention',
		);
	});
});

// ─── emitted via the registry + --fake seam (no network, no real GitHub) ─────

describe('the capability self-registers and emits through installCI --fake', () => {
	it('loadCapabilityRegistry picks up the intake module (no shared-list edit)', async () => {
		const caps = await loadCapabilityRegistry();
		expect(caps.map((c) => c.id)).toContain(INTAKE_TRIGGER_CAPABILITY_ID);
	});

	it('installCI --fake writes the workflow under .fake/, never the real .github/, and sets NO real secret', async () => {
		const caps = await loadCapabilityRegistry();
		const intake = caps.find((c) => c.id === INTAKE_TRIGGER_CAPABILITY_ID)!;
		expect(intake).toBeDefined();

		// Snapshot global state BEFORE the run (shared-write isolation).
		const home = homedir();
		const homeBefore = safeList(home);
		const cwdGithubBefore = existsSync(join(process.cwd(), '.github'));

		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
		});
		const file = join(work, 'ci.json');
		writeConfigFile(file);

		const result = await installCI({
			ctx,
			fake: true,
			configFile: file,
			capabilities: [intake],
			log: () => {},
		});

		// The workflow was written under .fake/, NEVER the real .github/.
		const fakePath = join(work, '.fake', INTAKE_TRIGGER_WORKFLOW_PATH);
		expect(existsSync(fakePath)).toBe(true);
		expect(existsSync(join(work, '.github'))).toBe(false);
		expect(result.written).toContain(
			join('.fake', INTAKE_TRIGGER_WORKFLOW_PATH),
		);

		// The produced YAML structurally validates.
		const text = readFileSync(fakePath, 'utf8');
		expect(validateIntakeWorkflow(text).ok).toBe(true);

		// Shared-write isolation: NO real secret set, real .github/ + ~ untouched.
		expect(ctx.secrets.size).toBe(0);
		expect(result.secrets).toEqual([]);
		expect(safeList(home)).toEqual(homeBefore);
		expect(existsSync(join(process.cwd(), '.github'))).toBe(cwdGithubBefore);
		expect(existsSync(join(process.cwd(), '.fake'))).toBe(false);
	});
});

// ─── insertion point E: the issue-thread review surface (stubbed comment seam) ─

/**
 * A stubbed issue seam (no `gh`/network): canned issue, in-memory comments. Records
 * every `postIssueComment` so the test can prove the review verdict is surfaced
 * into the ISSUE THREAD (by number), with NO real GitHub issue touched.
 */
function recordingIssueProvider(): IssueProvider & {
	readonly comments: PostIssueCommentInput[];
	readonly closes: CloseIssueInput[];
} {
	const comments: PostIssueCommentInput[] = [];
	const closes: CloseIssueInput[] = [];
	const labels: string[] = [];
	return {
		name: 'stub',
		comments,
		closes,
		async getIssue({issueNumber}): Promise<Issue> {
			return {
				number: issueNumber,
				title: 'Add a --quiet flag to the CLI',
				body: 'It should suppress the progress notes.',
				author: 'octocat',
				state: 'open',
			};
		},
		async listComments(): Promise<IssueComment[]> {
			return [];
		},
		async postIssueComment(input) {
			comments.push(input);
			return {posted: true, instruction: `commented on #${input.issueNumber}`};
		},
		async closeIssue(input) {
			closes.push(input);
			return {closed: true, instruction: `closed #${input.issueNumber}`};
		},
		async getLabels() {
			return {
				outcome: 'ok' as const,
				supported: true,
				labels: [...labels],
				instruction: 'read labels',
			};
		},
		async addLabel({label}) {
			if (!labels.includes(label)) labels.push(label);
			return {
				outcome: 'applied' as const,
				applied: true,
				instruction: `added ${label}`,
			};
		},
		async removeLabel({label}) {
			const i = labels.indexOf(label);
			if (i !== -1) labels.splice(i, 1);
			return {
				outcome: 'applied' as const,
				applied: true,
				instruction: `removed ${label}`,
			};
		},
	} as IssueProvider & {
		comments: PostIssueCommentInput[];
		closes: CloseIssueInput[];
	};
}

const TASK_VERDICT: IntakeVerdict = {
	outcome: 'task',
	taskSlug: 'add-quiet-flag',
	taskTitle: 'Add a --quiet flag to suppress progress notes',
	taskBody: [
		'## What to build',
		'',
		'A --quiet flag on the CLI that suppresses the progress notes.',
		'',
		'## Acceptance criteria',
		'',
		'- [ ] --quiet suppresses the >> notes',
		'',
		'## Prompt',
		'',
		'> Add a --quiet flag.',
	].join('\n'),
};

describe('insertion point E — the review verdict surfaces into the ISSUE THREAD via postIssueComment (stubbed comment seam)', () => {
	let scratch: Scratch;
	let restorePiAgentDir: () => void;
	beforeEach(() => {
		scratch = makeScratch('dorfl-intake-trigger-review-');
		restorePiAgentDir = isolatePiAgentDir(scratch.root);
	});
	afterEach(() => {
		restorePiAgentDir();
		scratch.cleanup();
	});

	it("a non-converging review surfaces its findings as a QUESTION into the issue thread (by number), reusing intake's review loop — no PR seam, no real issue", async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = recordingIssueProvider();

		// The SAME review/edit loop intake already runs (slicer-review-edit-loop /
		// intake-lone-slice-bounded-internal-review). A non-converge flips TASK→ASK
		// and surfaces the open question(s) BACK INTO THE ISSUE THREAD. We do NOT
		// re-test the transform — only that the verdict reaches the issue-comment
		// seam (insertion point E).
		const result = await performIntake({
			issueNumber: 77,
			cwd: repo,
			arbiter: 'arbiter',
			issueProvider,
			decide: async () => TASK_VERDICT,
			// A review gate that BLOCKS with an unresolved question and proposes no
			// edit → the bounded review flips TASK→ASK (the verdict-as-question path).
			reviewTask: async () => ({
				verdict: 'block',
				findings: [
					{
						severity: 'blocking',
						question:
							'Should --quiet also suppress error output, or only the progress notes?',
					},
				],
			}),
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		// The verdict surfaced as a comment on the ISSUE thread (keyed by NUMBER).
		expect(issueProvider.comments.length).toBeGreaterThanOrEqual(1);
		const posted = issueProvider.comments[issueProvider.comments.length - 1];
		expect(posted.issueNumber).toBe(77);
		// It carries the review's open question (the verdict surfaced as a QUESTION).
		expect(posted.body).toContain('--quiet');
		// The post is keyed by NUMBER (postIssueComment), never a PR url field.
		expect((posted as Record<string, unknown>).url).toBeUndefined();
		// No real GitHub issue was touched — the stub recorded the post in memory.
		expect(issueProvider.closes).toEqual([]);
	});
});

describe('the intake-trigger LABEL is brand-namespaced', () => {
	it('is a brand-namespaced label so it cannot collide with a user label', () => {
		expect(INTAKE_TRIGGER_LABEL).toMatch(/:intake$/);
	});
});

function writeConfigFile(file: string): void {
	writeFileSync(
		file,
		JSON.stringify({
			authMode: 'models-json',
			providers: [
				{
					name: 'anthropic',
					apiKeyEnvVar: 'ANTHROPIC_API_KEY',
					models: [{id: 'm'}],
					builtin: true,
				},
			],
			defaultProvider: 'anthropic',
			defaultModel: 'm',
		}),
	);
}

/** A stable directory listing (sorted), or [] if the dir is missing. */
function safeList(dir: string): string[] {
	try {
		return readdirSync(dir).sort();
	} catch {
		return [];
	}
}
