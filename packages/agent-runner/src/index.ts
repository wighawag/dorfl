export type {Config, PartialConfig} from './config.js';
export {
	DEFAULT_CONFIG,
	mergeConfig,
	loadConfig,
	defaultConfigPath,
} from './config.js';

export type {Frontmatter} from './frontmatter.js';
export {parseFrontmatter} from './frontmatter.js';

export type {DetectOptions} from './detect.js';
export {detectRepos, isParticipatingRepo} from './detect.js';

export type {
	AfkGate,
	BlockedByResult,
	EligibilityInput,
	EligibilityResult,
} from './eligibility.js';
export {
	resolveAfkGate,
	resolveBlockedBy,
	resolveEligibility,
} from './eligibility.js';

export type {BacklogItem, ScannedItem, RepoReport, ScanReport} from './scan.js';
export {scan, readBacklogItems, readDoneSlugs} from './scan.js';

export {formatReport, afkLabel} from './format.js';

export type {
	Category,
	CategorisedItem,
	CategorisedGroups,
	CategorySummary,
} from './categorise.js';
export {
	categoriseAfk,
	categoriseItem,
	categoriseItems,
	sortReadyFirst,
	summariseGroups,
	CATEGORY_ORDER,
	CATEGORY_LABELS,
} from './categorise.js';
