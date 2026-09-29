import {describe, it, expect} from 'vitest';
import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

/**
 * The GUARD for task `ci-split-route-direct-writes-through-seams` (spec
 * `ci-agent-job-without-write-token`, ADR `ci-agent-job-holds-no-write-token`):
 * every network write a CI path can reach must go through a write seam
 * (`ledgerWrite`, `refWrite`, the review provider, the issue provider or the
 * integrator), so the CI phase mode can record it in the agent job and perform
 * it in the apply job. A new direct `git push` or `gh` write anywhere else in
 * `src/` fails this test.
 *
 * It parses every non-test source with the TypeScript compiler and finds the
 * WRITE SITES: an array literal holding the string `'push'` (a git push argument
 * list), or holding two adjacent strings that name a `gh` write verb (`pr
 * create|edit|reopen|close|comment|merge`, `issue comment|close|edit|create|
 * reopen|delete`, `label create|edit|delete`, `api -X <write method>`). Each site
 * is keyed by `<file>::<enclosing function>` and must be in {@link ALLOWED}:
 * either a seam implementation or a documented exempt site. A second check
 * makes sure the seam-implementation helpers that still hold their own push are
 * only referenced from their seam.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * Every allowed write site, `<file>::<enclosing function>` to the reason. The
 * enclosing function is the nearest NAMED function, method or variable-bound
 * function (class methods are `Class.method`, object-literal methods are
 * `object.method`).
 */
const ALLOWED: Record<string, string> = {
	// --- the ledger-transition write seam ---
	'ledger-write.ts::currentLedgerWrite.applyTransition':
		'the ledger seam itself (CAS push to main)',
	// --- the ref-write seam (task ci-split-route-direct-writes-through-seams) ---
	'ref-write.ts::currentRefWrite.createLockRef': 'the ref-write seam itself',
	'ref-write.ts::currentRefWrite.deleteLockRef': 'the ref-write seam itself',
	'ref-write.ts::currentRefWrite.replaceLockRef': 'the ref-write seam itself',
	'ref-write.ts::currentRefWrite.pushTaskingCandidatesBranch':
		'the ref-write seam itself',
	'ref-write.ts::currentRefWrite.pushLeasedWorkBranch':
		'the ref-write seam itself',
	'ref-write.ts::currentRefWrite.pushLfsObjects': 'the ref-write seam itself',
	'continue-branch.ts::pushContinuedBranchWithStaleLeaseRetry':
		'implementation of refWrite.pushContinuedBranch (callers checked below)',
	'needs-attention.ts::routeToNeedsAttention':
		'implementation of ledgerWrite.applyNeedsAttentionTransition and refWrite.saveWorkBranch (callers checked below)',
	'needs-attention.ts::deleteRemoteWorkBranchIfPresent':
		'implementation of refWrite.deleteRemoteWorkBranch (callers checked below)',
	'advance-treeless-publish.ts::pushTreelessResult':
		'implementation of refWrite.publishTreelessResult (callers checked below)',
	// --- the integrator seam (reached through ledgerWrite.applyCompleteTransition) ---
	'integrator.ts::mergePushOnce': 'the integrator seam',
	'integrator.ts::pushBranch': 'the integrator seam',
	'integrator.ts::deleteMergedHeadBranch': 'the integrator seam',
	'continue-branch.ts::pushProposeBranchWithStaleLeaseRetry':
		'inside the integrator seam (callers checked below)',
	// --- the review provider seam ---
	'github.ts::GitHubProvider.openRequest': 'the review provider seam',
	'github.ts::GitHubProvider.updateExistingRequest': 'the review provider seam',
	'github.ts::GitHubProvider.reopenExistingRequest': 'the review provider seam',
	'github.ts::GitHubProvider.closeRequestOnBranch': 'the review provider seam',
	'github.ts::GitHubProvider.postPRComment': 'the review provider seam',
	// --- the issue provider seam ---
	'issue-provider.ts::GitHubIssueProvider.postIssueComment':
		'the issue provider seam',
	'issue-provider.ts::GitHubIssueProvider.closeIssue':
		'the issue provider seam',
	'issue-provider.ts::GitHubIssueProvider.mutateLabel':
		'the issue provider seam',
	'issue-provider.ts::GitHubIssueProvider.createLabel':
		'the issue provider seam',
	// --- WRITE-SEAM EXEMPT: never run in a CI agent job ---
	'needs-attention.ts::attemptReconcile':
		'exempt: human-only `requeue --reconcile`',
	'reap-branches.ts::sweepRemoteMergedBranches':
		'exempt: `gc --remote-branches`, a no-agent job',
	'install-ci-github.ts::GitHubCIContext.setRepoSetting':
		'exempt: human-run `install-ci`',
	'install-ci-github.ts::GitHubCIContext.setSecret':
		'exempt: human-run `install-ci`',
	'install-ci-github.ts::GitHubCIContext.setBranchRuleset':
		'exempt: human-run `install-ci`',
	'install-ci-github.ts::GitHubCIContext.setBranchProtection':
		'exempt: human-run `install-ci`',
	'install-ci-github.ts::GitHubCIContext.setActionsWorkflowPermissions':
		'exempt: human-run `install-ci`',
};

/**
 * Seam-implementation helpers that still hold their own push: each may be
 * referenced ONLY from the listed files (its seam), plus its own declaration.
 * A new direct caller elsewhere would bypass the seam, so it fails here.
 */
const SEAM_ONLY_CALLERS: Record<string, string[]> = {
	pushContinuedBranchWithStaleLeaseRetry: ['ref-write.ts'],
	routeToNeedsAttention: ['ledger-write.ts', 'ref-write.ts'],
	// `returnToBacklog` (needs-attention.ts) is itself reached only through
	// `ledgerWrite.applyReturnToBacklogTransition`.
	deleteRemoteWorkBranchIfPresent: ['ref-write.ts', 'needs-attention.ts'],
	pushTreelessResult: ['ref-write.ts'],
	pushProposeBranchWithStaleLeaseRetry: ['integrator.ts'],
};

const GH_WRITE_VERBS: Record<string, ReadonlySet<string>> = {
	pr: new Set(['create', 'edit', 'reopen', 'close', 'comment', 'merge']),
	issue: new Set(['comment', 'close', 'edit', 'create', 'reopen', 'delete']),
	label: new Set(['create', 'edit', 'delete']),
	secret: new Set(['set', 'delete']),
	variable: new Set(['set', 'delete']),
	release: new Set(['create', 'edit', 'delete', 'upload']),
	workflow: new Set(['run', 'enable', 'disable']),
};
const GH_API_WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function sourceFiles(): string[] {
	return readdirSync(SRC, {recursive: true, encoding: 'utf8'})
		.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
		.map((f) => f.split('\\').join('/'))
		.sort();
}

function parse(rel: string): ts.SourceFile {
	return ts.createSourceFile(
		rel,
		readFileSync(join(SRC, rel), 'utf8'),
		ts.ScriptTarget.Latest,
		true,
	);
}

function stringValue(node: ts.Node | undefined): string | undefined {
	if (
		node &&
		(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
	) {
		return node.text;
	}
	return undefined;
}

/** Why an array literal is a write argument list, or undefined when it is not. */
function writeKind(node: ts.ArrayLiteralExpression): string | undefined {
	const values = node.elements.map((e) => stringValue(e));
	if (values.includes('push')) {
		return 'git push';
	}
	for (let i = 0; i + 1 < values.length; i++) {
		const a = values[i];
		const b = values[i + 1];
		if (a && b && GH_WRITE_VERBS[a]?.has(b)) {
			return `gh ${a} ${b}`;
		}
		if (
			(a === '-X' || a === '--method') &&
			b &&
			GH_API_WRITE_METHODS.has(b.toUpperCase()) &&
			values.includes('api')
		) {
			return `gh api -X ${b}`;
		}
	}
	return undefined;
}

function nameOf(name: ts.PropertyName | ts.BindingName | undefined): string {
	if (!name) return '<anonymous>';
	if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
	return name.getText();
}

/** The nearest NAMED enclosing function, as `name`, `Class.method` or `object.method`. */
function enclosingFunction(node: ts.Node): string {
	for (let cur = node.parent; cur; cur = cur.parent) {
		if (ts.isFunctionDeclaration(cur) && cur.name) {
			return cur.name.text;
		}
		if (
			ts.isMethodDeclaration(cur) ||
			ts.isGetAccessorDeclaration(cur) ||
			ts.isSetAccessorDeclaration(cur) ||
			ts.isConstructorDeclaration(cur)
		) {
			const method = ts.isConstructorDeclaration(cur)
				? 'constructor'
				: nameOf(cur.name);
			const owner = cur.parent;
			if (ts.isClassLike(owner) && owner.name) {
				return `${owner.name.text}.${method}`;
			}
			if (
				ts.isObjectLiteralExpression(owner) &&
				ts.isVariableDeclaration(owner.parent)
			) {
				return `${nameOf(owner.parent.name)}.${method}`;
			}
			return method;
		}
		if (
			(ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
			ts.isVariableDeclaration(cur.parent)
		) {
			return nameOf(cur.parent.name);
		}
	}
	return '<module>';
}

interface WriteSite {
	key: string;
	kind: string;
	line: number;
}

function writeSites(): WriteSite[] {
	const sites: WriteSite[] = [];
	for (const rel of sourceFiles()) {
		const sf = parse(rel);
		const visit = (node: ts.Node): void => {
			if (ts.isArrayLiteralExpression(node)) {
				const kind = writeKind(node);
				if (kind) {
					sites.push({
						key: `${rel}::${enclosingFunction(node)}`,
						kind,
						line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
					});
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sf);
	}
	return sites;
}

/**
 * True when the identifier is a DECLARED name (the function's own declaration,
 * a property / option key, a `.member` access), not a reference to the helper.
 */
function isNameNotReference(node: ts.Identifier): boolean {
	const parent = node.parent;
	return (
		((ts.isFunctionDeclaration(parent) ||
			ts.isPropertySignature(parent) ||
			ts.isPropertyAssignment(parent) ||
			ts.isPropertyDeclaration(parent) ||
			ts.isMethodDeclaration(parent) ||
			(ts.isPropertyAccessExpression(parent) &&
				// `mod.helper(...)` IS a call of the helper; `opts.helper` is a key.
				!(
					ts.isCallExpression(parent.parent) &&
					parent.parent.expression === parent
				))) &&
			parent.name === node) ||
		(ts.isBindingElement(parent) && parent.propertyName === node)
	);
}

describe('every CI-reachable network write goes through a write seam', () => {
	it('finds no `git push` / `gh` write outside the seams and the documented exempt sites', () => {
		const sites = writeSites();
		// Sanity: the scan really sees the known sites (a broken parser would pass vacuously).
		expect(sites.length).toBeGreaterThan(20);
		const unexpected = sites
			.filter((s) => !Object.hasOwn(ALLOWED, s.key))
			.map((s) => `${s.key} (line ${s.line}): ${s.kind}`);
		expect(
			unexpected,
			'a direct network write outside the write seams: route it through ' +
				'`refWrite` / `ledgerWrite` / a provider (src/ref-write.ts), or, when ' +
				'it can never run in a CI agent job, add a WRITE-SEAM EXEMPT comment ' +
				'and an ALLOWED entry here',
		).toEqual([]);
	});

	it('has no stale ALLOWED entry (each names a write site that still exists)', () => {
		const keys = new Set(writeSites().map((s) => s.key));
		const stale = Object.keys(ALLOWED).filter((k) => !keys.has(k));
		expect(stale).toEqual([]);
	});

	it('the documented exempt sites carry a WRITE-SEAM EXEMPT comment', () => {
		const exemptFiles = new Set(
			Object.entries(ALLOWED)
				.filter(([, reason]) => reason.startsWith('exempt:'))
				.map(([key]) => key.split('::')[0]),
		);
		const missing = [...exemptFiles].filter(
			(rel) =>
				!readFileSync(join(SRC, rel), 'utf8').includes('WRITE-SEAM EXEMPT'),
		);
		expect(missing).toEqual([]);
	});

	it('the seam-implementation helpers are referenced only from their seam', () => {
		const offenders: string[] = [];
		for (const rel of sourceFiles()) {
			const sf = parse(rel);
			const visit = (node: ts.Node): void => {
				// Import/export specifiers are wiring, not a call; skip them.
				if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
					return;
				}
				if (
					ts.isIdentifier(node) &&
					Object.hasOwn(SEAM_ONLY_CALLERS, node.text)
				) {
					if (
						!isNameNotReference(node) &&
						!SEAM_ONLY_CALLERS[node.text].includes(rel)
					) {
						const line =
							sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
						offenders.push(`${rel}:${line} references ${node.text}`);
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(sf);
		}
		expect(offenders).toEqual([]);
	});
});
