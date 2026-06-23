/**
 * The CLOSE-JOB capability emitter (PRD `runner-in-ci`, task
 * `install-ci-close-job-workflow`; capability E: close issues when their work
 * lands). A SELF-REGISTERING module: it calls {@link registerCapability} at import
 * time, so {@link loadCapabilityRegistry} picks it up WITHOUT any edit to a shared
 * central list/switch (the file-orthogonality contract — this task and the sibling
 * capability tasks stay mergeable in parallel).
 *
 * The workflow shape + its structural validator live in `close-job-template.ts`;
 * this file is the thin registry-wiring shim.
 */

import {registerCapability} from '../install-ci-core.js';
import {
	CLOSE_JOB_CAPABILITY_ID,
	CLOSE_JOB_CAPABILITY_LABEL,
	CLOSE_JOB_WORKFLOW_PATH,
	generateCloseJobWorkflow,
} from '../close-job-template.js';

registerCapability({
	id: CLOSE_JOB_CAPABILITY_ID,
	label: CLOSE_JOB_CAPABILITY_LABEL,
	emit(config) {
		return [
			{
				path: CLOSE_JOB_WORKFLOW_PATH,
				content: generateCloseJobWorkflow(config),
			},
		];
	},
});
