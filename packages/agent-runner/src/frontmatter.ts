/**
 * Minimal, dependency-free parser for the small slice of YAML frontmatter the
 * `work/` contract uses: top-level scalar keys and string lists (inline `[a, b]`
 * or block `- a` form). It deliberately does NOT implement general YAML — only
 * what `work/` slice frontmatter needs (slug, afk, blocked_by, ...).
 */

export interface Frontmatter {
	/** Content-derived slug id (frontmatter `slug:`). */
	slug: string | undefined;
	/** Source PRD slug (frontmatter `prd:`); the PRD lives at `work/prd/<prd>.md`. */
	prd: string | undefined;
	/**
	 * The AFK gate. `true` / `false` when explicit, `undefined` when omitted
	 * (unspecified — runner policy decides).
	 */
	afk: boolean | undefined;
	/** Slugs this item is blocked by; `[]` when omitted or empty. */
	blockedBy: string[];
}

/**
 * Extract the raw frontmatter block (the lines between the leading `---` and the
 * next `---`). Returns `undefined` when the document does not start with a
 * frontmatter fence.
 */
function extractBlock(content: string): string | undefined {
	const normalized = content.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
	if (!normalized.startsWith('---\n') && normalized !== '---') {
		return undefined;
	}
	const lines = normalized.split('\n');
	// First line is the opening fence.
	const closing = lines.indexOf('---', 1);
	if (closing === -1) {
		return undefined;
	}
	return lines.slice(1, closing).join('\n');
}

/** Strip surrounding single or double quotes from a scalar token. */
function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' || first === "'") && last === first) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

function parseInlineList(value: string): string[] {
	const inner = value.trim().slice(1, -1).trim();
	if (inner === '') {
		return [];
	}
	return inner
		.split(',')
		.map((item) => unquote(item))
		.filter((item) => item !== '');
}

function toBoolean(value: string): boolean | undefined {
	const v = unquote(value).toLowerCase();
	if (v === 'true') {
		return true;
	}
	if (v === 'false') {
		return false;
	}
	return undefined;
}

export function parseFrontmatter(content: string): Frontmatter {
	const block = extractBlock(content);
	const result: Frontmatter = {
		slug: undefined,
		prd: undefined,
		afk: undefined,
		blockedBy: [],
	};
	if (block === undefined) {
		return result;
	}

	const lines = block.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Skip blank lines and comments and non top-level (indented) lines; block
		// list items are consumed inline below.
		if (line.trim() === '' || line.trimStart().startsWith('#')) {
			continue;
		}
		const match = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
		if (!match) {
			continue;
		}
		const key = match[1];
		const rawValue = match[2].trim();

		if (key === 'slug') {
			result.slug = rawValue === '' ? undefined : unquote(rawValue);
		} else if (key === 'prd') {
			result.prd = rawValue === '' ? undefined : unquote(rawValue);
		} else if (key === 'afk') {
			result.afk = rawValue === '' ? undefined : toBoolean(rawValue);
		} else if (key === 'blocked_by') {
			if (rawValue.startsWith('[')) {
				result.blockedBy = parseInlineList(rawValue);
			} else if (rawValue === '') {
				// Block-style list: consume following indented `- item` lines.
				const items: string[] = [];
				let j = i + 1;
				while (j < lines.length) {
					const itemMatch = /^\s+-\s*(.+)$/.exec(lines[j]);
					if (!itemMatch) {
						break;
					}
					const item = unquote(itemMatch[1]);
					if (item !== '') {
						items.push(item);
					}
					j++;
				}
				result.blockedBy = items;
				i = j - 1;
			}
		}
	}

	return result;
}
