import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, dirname} from 'node:path';
import {
	harnessApplyDecider,
	APPLY_ALLOWED_OUTCOMES,
} from '../src/apply-decide.js';
import type {SidecarModel} from '../src/sidecar.js';

/**
 * Gate-2 regression guard for task `agentic-apply-retire-disposition-vocabulary`.
 *
 * The agentic apply rung is reachable in PRODUCTION only if `cli.ts` wires a REAL
 * harness-backed apply decider into the `AdvanceContext` it builds. The unit
 * suite (`advance-triage.test.ts`) injects a STUBBED `applyDecide`, so a missing
 * cli.ts wiring would NOT show up there — the apply rung would silently fall back
 * to `harnessApplyDecider()` (a `NullHarness` + empty agentCmd), which THROWS, and
 * an answered observation could never mint/delete/ask.
 *
 * This guard pins both halves of the contract the way the surface/triage gate
 * wiring is verified (a non-null decider at every advance entry point):
 *
 *  1. the BEHAVIOURAL fact that the unwired default decider throws (so a missing
 *     wiring is a hard failure, not a silent no-op);
 *  2. a SOURCE-TEXT assertion that EVERY cli.ts context-building site that wires
 *     `triageGate:` ALSO wires `applyDecide:` + `applyModel:` (the three advance
 *     entry points: treeless registry context, isolated, in-place).
 */

const here = dirname(fileURLToPath(import.meta.url));
const cliSrc = readFileSync(join(here, '..', 'src', 'cli.ts'), 'utf8');

describe('cli.ts wires a real apply decider at every advance entry point', () => {
	it('the unwired default apply decider THROWS (NullHarness + empty agentCmd)', async () => {
		// This is WHY cli.ts must wire a real decider: the fallback is not a benign
		// no-op, it is a hard config error. (Mirrors NullHarness.launch refusing an
		// empty command.)
		const decider = harnessApplyDecider();
		const sidecar: SidecarModel = {
			item: 'observation:x',
			type: 'observation',
			slug: 'x',
			entries: [{id: 'q1', question: 'do it?', context: '', answer: 'yes'}],
		};
		await expect(
			decider({
				item: 'observation:x',
				type: 'observation',
				itemBody: 'body',
				sidecar,
				cwd: process.cwd(),
			}),
		).rejects.toThrow();
	});

	it('every context-building site that wires triageGate ALSO wires a real applyDecide + applyModel', () => {
		// Each advance entry point builds an AdvanceContext that sets `triageGate:`;
		// the same site MUST set `applyDecide:` so the apply rung is reachable. We
		// count occurrences so a new entry point that forgets the decider is caught.
		const triageSites =
			cliSrc.match(/triageGate:\s*harnessTriageGate\(/g) ?? [];
		const applySites =
			cliSrc.match(/applyDecide:\s*harnessApplyDecider\(/g) ?? [];
		expect(triageSites.length).toBeGreaterThanOrEqual(3);
		expect(applySites.length).toBe(triageSites.length);

		// And the model is threaded alongside (de-correlated like surfaceModel).
		const applyModelSites = cliSrc.match(/applyModel:\s*\w/g) ?? [];
		expect(applyModelSites.length).toBe(triageSites.length);
	});

	it('the apply rung permits the full subset including adr (mint-adr is now WIRED)', () => {
		// `adr` was DEFERRED at the keystone launch and is now WIRED by task
		// `agentic-apply-mint-adr-route` (which added the mintAdr route). The reachable
		// rung now PERMITS an `adr` verdict (routed to docs/adr/), so the allowed set
		// is the full `{task | prd | adr | delete | ask}`.
		expect([...APPLY_ALLOWED_OUTCOMES].sort()).toEqual([
			'adr',
			'ask',
			'delete',
			'prd',
			'task',
		]);
		expect(APPLY_ALLOWED_OUTCOMES).toContain('adr');
	});
});
