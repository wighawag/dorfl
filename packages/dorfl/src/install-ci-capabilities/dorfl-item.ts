/**
 * The SPLIT CI ITEM capability emitter (spec `ci-agent-job-without-write-token`,
 * task `ci-split-generate-workflows`). A SELF-REGISTERING module (see
 * `example-noop.ts`): it emits `dorfl-item.yml` (the lock, agent and apply jobs
 * of ONE item) and `dorfl-item-dispatch.yml` (the per-item dispatch wrapper the
 * advance tick starts), which the advance-lifecycle and intake workflows call.
 *
 * The workflow text lives in `dorfl-item-template.ts`; this file is the thin
 * registry-wiring shim.
 */

import {registerCapability} from '../install-ci-core.js';
import {
	ITEM_DISPATCH_WORKFLOW_PATH,
	ITEM_WORKFLOW_PATH,
	generateItemDispatchWorkflow,
	generateItemWorkflow,
} from '../dorfl-item-template.js';

registerCapability({
	id: 'dorfl-item',
	label:
		'Run each CI item as lock, agent and apply jobs (the per-item workflow the advance tick and intake call)',
	emit(config) {
		return [
			{path: ITEM_WORKFLOW_PATH, content: generateItemWorkflow(config)},
			{
				path: ITEM_DISPATCH_WORKFLOW_PATH,
				content: generateItemDispatchWorkflow(config),
			},
		];
	},
});
