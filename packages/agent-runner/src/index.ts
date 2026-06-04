export type {
	Config,
	PartialConfig,
	IntegrationMode,
	VerifyConfig,
} from './config.js';
export {
	DEFAULT_CONFIG,
	mergeConfig,
	loadConfig,
	defaultConfigPath,
} from './config.js';

export type {
	RepoAllowedKey,
	RepoRejectedKey,
	LoadedRepoConfig,
	ResolveRepoConfigOptions,
	ResolvedRepoConfig,
} from './repo-config.js';
export {
	REPO_CONFIG_FILENAME,
	REPO_ALLOWED_KEYS,
	REPO_REJECTED_KEYS,
	repoConfigPath,
	loadRepoConfig,
	resolveRepoConfig,
} from './repo-config.js';

export type {Frontmatter} from './frontmatter.js';
export {parseFrontmatter} from './frontmatter.js';

export type {DetectOptions} from './detect.js';
export {detectRepos, isParticipatingRepo} from './detect.js';

export type {
	HumanOnlyGate,
	BlockedByResult,
	EligibilityInput,
	EligibilityResult,
} from './eligibility.js';
export {
	resolveGate,
	resolveBlockedBy,
	resolveEligibility,
} from './eligibility.js';

export type {BacklogItem, ScannedItem, RepoReport, ScanReport} from './scan.js';
export {scan, readBacklogItems, readDoneSlugs} from './scan.js';

export {formatReport, gateLabel} from './format.js';

export type {SliceFolder, ResolvedSlice, PromptOptions} from './prompt.js';
export {
	extractPromptSection,
	extractCanonicalWrapperTemplate,
	resolveClaimProtocolPath,
	wrapper,
	buildAgentPrompt,
	resolveSlice,
	inferSlugFromBranch,
	renderPrompt,
	PromptError,
} from './prompt.js';

export type {Candidate, SelectCaps} from './select.js';
export {selectCandidates} from './select.js';

export type {ClaimOutcome, ClaimOptions, ClaimResult} from './claim.js';
export {claimItem, claimItemAsync, defaultClaimScript} from './claim.js';

export type {
	ClaimExitCode,
	ClaimCasOutcome,
	ClaimCasOptions,
	ClaimCasResult,
} from './claim-cas.js';
export {performClaim} from './claim-cas.js';

export type {StartOutcome, StartOptions, StartResult} from './start.js';
export {performStart} from './start.js';

export type {
	CompleteOutcome,
	CompleteOptions,
	CompleteResult,
} from './complete.js';
export {performComplete} from './complete.js';

export type {
	IsolationMode,
	IsolationHandle,
	IsolateOptions,
} from './isolate.js';
export {isolate, workBranchName} from './isolate.js';

export type {IntegrateOptions, IntegrateResult} from './integrate.js';
export {integrate, arbiterMainContains} from './integrate.js';

export type {
	ItemStatus,
	ItemResult,
	RunOnceResult,
	RunOnceOptions,
	AgentRunner,
	TestGate,
} from './run.js';
export {runOnce} from './run.js';

export type {RunVerifyOptions, RunVerifyResult} from './verify.js';
export {
	runVerify,
	resolveVerifyCommands,
	DEFAULT_VERIFY_COMMAND,
} from './verify.js';

export type {
	Category,
	CategorisedItem,
	CategorisedGroups,
	CategorySummary,
} from './categorise.js';
export {
	categoriseItem,
	categoriseItems,
	sortReadyFirst,
	summariseGroups,
	CATEGORY_ORDER,
	CATEGORY_LABELS,
} from './categorise.js';
