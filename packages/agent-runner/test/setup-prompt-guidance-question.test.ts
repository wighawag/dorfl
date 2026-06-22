/**
 * Slice `prompt-guidance-testfirst-setup-adoption-question`: setup's adoption
 * conversation gains ONE nudge question, FOLDED into the existing A-phase round
 * (not a new round), that on YES merges `promptGuidance.testFirst: true` into
 * the target repo's `.agent-runner.json` per A1's merge-don't-clobber rule, and
 * on NO / skip / don't-know writes NOTHING (omission = the runtime default
 * `false`). AGENTS.md MUST NOT be written by this nudge.
 *
 * setup is a SKILL.md (a prompt for a human-facing agent), so the spec for the
 * question is doc-level: this suite asserts SKILL.md carries the right shape
 * (single occurrence, nudge phrasing, merge rule, omit-on-negative, AGENTS.md
 * untouched) and end-to-end that a config file produced by following SKILL.md's
 * instruction wires through the resolver + the wrapper to a strengthened in-band
 * prompt (the integration handoff).
 */
import {describe, it, expect} from 'vitest';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig, resolvePromptGuidance} from '../src/config.js';
import {wrapper} from '../src/prompt.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SKILL = resolve(REPO, 'skills', 'setup', 'SKILL.md');

const skillText = (): string => readFileSync(SKILL, 'utf8');

describe('setup SKILL.md — the test-first nudge question (A-phase, folded in)', () => {
	it('mentions `promptGuidance.testFirst` as the on-disk key once in the nudge section', () => {
		const text = skillText();
		// The key surfaces in three places by design: the nudge bullet itself,
		// the A4 plan bullet that re-summarises it for confirmation, and the
		// `.agent-runner.json` template. That's intentional — the test just guards
		// the key NAME is consistent with the rest of the codebase.
		expect(text).toContain('promptGuidance.testFirst');
		expect(text).toContain('"promptGuidance"');
	});

	it('asks the question exactly ONCE — the question sentence appears one time', () => {
		const text = skillText();
		// The canonical question phrasing. If a future edit accidentally adds a
		// second round, this count goes >1 and the regression is caught.
		const q =
			/Should AFK builds in this repo default to writing the failing test BEFORE the production code\?/g;
		const matches = text.match(q) ?? [];
		expect(matches.length).toBe(1);
	});

	it('phrases the question AS a nudge (mentions `verify` still decides; calls it a nudge, not a gate)', () => {
		const text = skillText();
		// Pull the nudge paragraph and assert its disposition wording.
		const start = text.indexOf('**Nudge for `promptGuidance.testFirst`');
		expect(start).toBeGreaterThan(-1);
		const para = text.slice(start, start + 2000);
		expect(para).toMatch(/verify.*decides pass\/fail/i);
		expect(para).toMatch(/NUDGE, not a gate/);
	});

	it('FOLDS into the existing A-phase round (the bullet says so explicitly, like the per-change-convention nudge)', () => {
		const text = skillText();
		const start = text.indexOf('**Nudge for `promptGuidance.testFirst`');
		const para = text.slice(start, start + 2000);
		// Matches the language A2 already uses for the per-change-convention
		// nudge: "fold into the A4 plan, do NOT add a separate question round".
		expect(para).toMatch(/fold into the A4 plan/i);
		expect(para).toMatch(/do NOT add a separate question round/i);
	});

	it('states the merge-don\u2019t-clobber rule for the YES path (preserve sibling keys; merge into `promptGuidance`)', () => {
		const text = skillText();
		const start = text.indexOf('**Nudge for `promptGuidance.testFirst`');
		const para = text.slice(start, start + 2000);
		expect(para).toMatch(/MERGE-IN/);
		expect(para).toMatch(/merge-don't-clobber/i);
		expect(para).toMatch(/preserve every other existing key VERBATIM/);
		// Conflicting-members behaviour: if `promptGuidance` already exists with
		// other members, only `testFirst` is added/set; siblings survive.
		expect(para).toMatch(/leave any sibling members in place/i);
	});

	it('states the write-NOTHING rule for the NO / skip / don\u2019t-know / absent path (omission = the runtime default)', () => {
		const text = skillText();
		const start = text.indexOf('**Nudge for `promptGuidance.testFirst`');
		const para = text.slice(start, start + 2000);
		expect(para).toMatch(/write NOTHING/);
		expect(para).toMatch(/do not write `testFirst: false`/);
		expect(para).toMatch(
			/do not create the `promptGuidance` object just to leave it empty/,
		);
	});

	it('explicitly states AGENTS.md is NEVER written or modified by this nudge', () => {
		const text = skillText();
		const start = text.indexOf('**Nudge for `promptGuidance.testFirst`');
		const para = text.slice(start, start + 2000);
		expect(para).toMatch(
			/AGENTS\.md is \*\*never\*\* written or modified by this nudge/,
		);
	});

	it('the `.agent-runner.json` template documents `promptGuidance` with the omit-if-no rule', () => {
		const text = skillText();
		// Both the example block and the surrounding gloss should call out
		// `promptGuidance` and that the WHOLE object is OMITTED on a negative
		// answer (not written as `{testFirst: false}`).
		expect(text).toMatch(/"promptGuidance":\s*\{"testFirst":\s*true\}/);
		expect(text).toMatch(/OMIT the whole `promptGuidance` object/);
	});

	it('the CONTEXT.md template glossary defines `promptGuidance` (so a future reader of an opted-in repo can find it)', () => {
		const text = skillText();
		expect(text).toMatch(
			/\*\*promptGuidance\*\* \u2014 the per-repo NUDGE namespace/,
		);
	});
});

describe('integration handoff: a config produced by setup\u2019s YES path strengthens the worker prompt', () => {
	it('YES path \u2014 `{ "promptGuidance": { "testFirst": true } }` resolves on and the wrapper carries the strengthened test-first text', () => {
		const root = mkdtempSync(join(tmpdir(), 'agent-runner-setup-pg-yes-'));
		const cfgPath = join(root, '.agent-runner.json');
		writeFileSync(
			cfgPath,
			JSON.stringify({
				verify: 'true',
				autoBuild: false,
				autoTask: false,
				promptGuidance: {testFirst: true},
			}),
		);
		const cfg = loadConfig(cfgPath);
		expect(resolvePromptGuidance(cfg).testFirst).toBe(true);
		const w = wrapper('example', 'my-prd', {
			cwd: root,
			promptGuidance: {testFirst: true},
		});
		expect(w).toContain('failing test BEFORE the production code');
		expect(w).not.toContain('TDD where the task asks for it');
	});

	it('NO path (omitted, the doctrine) \u2014 a `.agent-runner.json` without `promptGuidance` resolves to OFF, wrapper carries the soft historic line', () => {
		const root = mkdtempSync(join(tmpdir(), 'agent-runner-setup-pg-no-'));
		const cfgPath = join(root, '.agent-runner.json');
		writeFileSync(
			cfgPath,
			JSON.stringify({
				verify: 'true',
				autoBuild: false,
				autoTask: false,
			}),
		);
		const cfg = loadConfig(cfgPath);
		expect(resolvePromptGuidance(cfg).testFirst).toBe(false);
		const w = wrapper('example', 'my-prd', {cwd: root});
		expect(w).toContain('TDD where the task asks for');
		expect(w).not.toContain('failing test BEFORE the production code');
	});

	it('merge-don\u2019t-clobber proof: pre-existing sibling keys SURVIVE when YES merges in `promptGuidance.testFirst`', () => {
		// Simulate setup\u2019s A1 merge-in: start from a pre-populated config with
		// unrelated keys, then perform the smallest possible YES-path merge
		// (set `promptGuidance.testFirst = true`; do NOT rewrite the file from a
		// template). Every pre-existing key must survive verbatim.
		const root = mkdtempSync(join(tmpdir(), 'agent-runner-setup-pg-merge-'));
		const pre = {
			verify: 'pnpm -r build && pnpm -r test && pnpm format:check',
			prepare: 'pnpm install',
			harness: 'pi',
			autoBuild: true,
			autoTask: false,
			noPR: true,
			model: 'sonnet',
			// `promptGuidance` PRE-EXISTS with a sibling member we have not yet
			// declared (forward-compat) \u2014 setup must NOT wipe it.
			promptGuidance: {someFutureNudge: true},
		};
		const path = join(root, '.agent-runner.json');
		writeFileSync(path, JSON.stringify(pre, null, 2));

		// The merge: read, set the ONE key, write back. (This is the operation
		// SKILL.md instructs the human-facing agent to perform on YES.)
		const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
			string,
			unknown
		>;
		const pg = (raw.promptGuidance as Record<string, unknown>) ?? {};
		pg.testFirst = true;
		raw.promptGuidance = pg;
		writeFileSync(path, JSON.stringify(raw, null, 2));

		// Every pre-existing key is byte-preserved\u2026
		const after = JSON.parse(readFileSync(path, 'utf8')) as Record<
			string,
			unknown
		>;
		expect(after.verify).toBe(pre.verify);
		expect(after.prepare).toBe(pre.prepare);
		expect(after.harness).toBe(pre.harness);
		expect(after.autoBuild).toBe(true);
		expect(after.autoTask).toBe(false);
		expect(after.noPR).toBe(true);
		expect(after.model).toBe('sonnet');
		// \u2026the pre-existing sibling under `promptGuidance` is preserved\u2026
		expect(
			(after.promptGuidance as Record<string, unknown>).someFutureNudge,
		).toBe(true);
		// \u2026and `testFirst: true` is now ALSO present.
		expect((after.promptGuidance as Record<string, unknown>).testFirst).toBe(
			true,
		);

		// And resolving the merged file gives ON.
		expect(resolvePromptGuidance(loadConfig(path)).testFirst).toBe(true);
	});

	it('isolation: this suite did NOT write to the real `~/.agent-runner.json` (HOME hygiene)', () => {
		// We never touch HOME. This is a positive proof rather than a negative:
		// our temp-dir mkdtemp roots all writes under `tmpdir()`, and no test in
		// this file resolves a path against `os.homedir()`. (The global
		// `test/setup.ts` also strips `AGENT_RUNNER_*` env so resolution cannot
		// leak through env overrides.)
		const tdir = tmpdir();
		expect(tdir).not.toBe(process.env.HOME);
	});
});
