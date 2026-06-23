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
} from './helpers/gitRepo.js';

/**
 * `install-ci-intake-trigger-and-review-surface` — capability D (consider incoming
 * issues → task/PRD) + insertion point E (surface the review verdict into the
 * issue thread). CI SCHEDULES `intake <N>` (four-outcome dispatch), maps a CREATED
 * `issue_comment` onto the (re-)evaluation trigger (Decision 2: no edit-detection),
 * DERIVES the per-outcome merge-vs-propose flags from gate-state COMPOSED with
 * author-trust (Decision 1: untrusted ⇒ `--propose-task`, PRDs still mergeable),
 * and surfaces the review verdict back into the issue thread via the provider
 * comment seam.
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
	rmSync(work, {recursive: true, force: true});
});

// ─── the AUTHOR-TRUST → per-outcome-flags DERIVATION (CI's POLICY) ────────────

describe('deriveIntakeFlags — gate-state COMPOSED with author-trust (Decision 1)', () => {
	it('TRUSTED author + both gates OFF ⇒ merge BOTH (the human acts next; permissive)', () => {
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: false, autoTask: false},
				authorTrusted: true,
			}),
		).toEqual({brief: 'merge', task: 'merge', originTrust: 'trusted'});
	});

	it('UNTRUSTED author forces --propose-task REGARDLESS of autoBuild, but --merge-brief STAYS allowed', () => {
		// Both gates off: a trusted author would merge both; an untrusted author
		// must still PROPOSE the task, while the PRD stays mergeable (a human
		// tasks it before anything autonomous acts — the checkpoint is intact).
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: false, autoTask: false},
				authorTrusted: false,
			}),
		).toEqual({brief: 'merge', task: 'propose', originTrust: 'untrusted'});
	});

	it('autoBuild ON forces --propose-task even for a TRUSTED author (an agent will auto-build it)', () => {
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: true, autoTask: false},
				authorTrusted: true,
			}),
		).toEqual({brief: 'merge', task: 'propose', originTrust: 'trusted'});
	});

	it('autoTask ON forces --propose-brief (an agent will auto-slice it → human PR checkpoint now)', () => {
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: false, autoTask: true},
				authorTrusted: true,
			}),
		).toEqual({brief: 'propose', task: 'merge', originTrust: 'trusted'});
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

	it('the BRIEF flag is gate-derived ONLY — author-trust does NOT bite a brief', () => {
		// autoTask off ⇒ --merge-brief for BOTH a trusted and an untrusted author.
		const trusted = deriveIntakeFlags({
			gate: {autoBuild: true, autoTask: false},
			authorTrusted: true,
		});
		const untrusted = deriveIntakeFlags({
			gate: {autoBuild: true, autoTask: false},
			authorTrusted: false,
		});
		expect(trusted.brief).toBe('merge');
		expect(untrusted.brief).toBe('merge');
	});

	it('the only way to --merge-task is a TRUSTED author with autoBuild OFF (the conservative default keeps a human in the loop)', () => {
		const grid: {
			autoBuild: boolean;
			authorTrusted: boolean;
			task: 'merge' | 'propose';
		}[] = [
			{autoBuild: false, authorTrusted: true, task: 'merge'},
			{autoBuild: false, authorTrusted: false, task: 'propose'},
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

	it('the FULLY-GATELESS merge-everything path needs both gates off AND a trusted author (a loud, non-default combination)', () => {
		// Merge both ⇒ exactly: autoTask off + autoBuild off + trusted author.
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: false, autoTask: false},
				authorTrusted: true,
			}),
		).toEqual({brief: 'merge', task: 'merge', originTrust: 'trusted'});
		// Flip ANY one of the three and it is no longer merge-everything.
		expect(
			deriveIntakeFlags({
				gate: {autoBuild: false, autoTask: false},
				authorTrusted: false,
			}).task,
		).toBe('propose');
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
			}).brief,
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

	it('invokes `agent-runner intake <N>` (explicit issue number, four-outcome dispatch), never a bare slug or a build verb', () => {
		const text = generateIntakeWorkflow(config);
		expect(/agent-runner intake\b/.test(text)).toBe(true);
		expect(
			/agent-runner intake "?\$\{\{\s*github\.event\.issue\.number/.test(text),
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

	it('Decision 1: reads author_association off the payload, trust = OWNER/MEMBER/COLLABORATOR, derives all four per-outcome flags', () => {
		const text = generateIntakeWorkflow(config);
		expect(/author_association/.test(text)).toBe(true);
		expect(/OWNER\|MEMBER\|COLLABORATOR/.test(text)).toBe(true);
		// All four granular per-outcome flags appear in the derivation.
		expect(text).toContain('--propose-task');
		expect(text).toContain('--merge-task');
		expect(text).toContain('--merge-brief');
		expect(text).toContain('--propose-brief');
		// The derivation reads the gate env block.
		expect(/AGENT_RUNNER_AUTO_BUILD\b/.test(text)).toBe(true);
		expect(/AGENT_RUNNER_AUTO_TASK\b/.test(text)).toBe(true);
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
		): {brief: string; task: string; originTrust: string} => {
			// BRIEF: --propose-brief iff autoTask true, else --merge-brief.
			const brief = autoTask ? '--propose-brief' : '--merge-brief';
			// TASK: --propose-task iff autoBuild true OR not trusted.
			const task = autoBuild || !trusted ? '--propose-task' : '--merge-task';
			// ORIGIN-TRUST: the same `trusted` case, carried to the stamp flag.
			const originTrust = trusted
				? '--origin-trust=trusted'
				: '--origin-trust=untrusted';
			return {brief, task, originTrust};
		};
		for (const autoBuild of [false, true]) {
			for (const autoTask of [false, true]) {
				for (const trusted of [false, true]) {
					const fromShell = shell(autoBuild, autoTask, trusted);
					const fromFn = deriveIntakeFlags({
						gate: {autoBuild, autoTask},
						authorTrusted: trusted,
					});
					expect(fromShell.brief).toBe(`--${fromFn.brief}-brief`);
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
		expect(
			/uses:\s*\.\/\.github\/actions\/agent-runner-setup\b/.test(text),
		).toBe(true);
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

	it('flags a missing `agent-runner intake` invocation', () => {
		expectFlagged(
			base.replace(/agent-runner intake "/, 'echo skip "'),
			'invokes-intake',
		);
	});

	it('flags a build/task verb sneaking in (CI owns only the trigger + policy)', () => {
		expectFlagged(
			base.replace(
				/agent-runner intake "/,
				'agent-runner advance -n 10\n          agent-runner intake "',
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

	it('flags a missing --propose-task fallback (untrusted-author path)', () => {
		expectFlagged(
			base.replace(/--propose-task/g, '--merge-task'),
			'derives-propose-task',
		);
	});

	it('flags a missing --merge-brief (a PRD must stay mergeable for an untrusted author)', () => {
		expectFlagged(
			base.replace(/--merge-brief/g, '--propose-brief'),
			'derives-merge-brief',
		);
	});

	it('flags routing the verdict through the PR-comment seam (E posts to the ISSUE)', () => {
		expectFlagged(
			base.replace(
				/agent-runner intake "/,
				'agent-runner postPRComment\n          agent-runner intake "',
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
		scratch = makeScratch('agent-runner-intake-trigger-review-');
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
